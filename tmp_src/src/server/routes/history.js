import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../env/reader.js';

const router = express.Router();
const HISTORY_FILE = path.join(ITERFORGE_HOME, 'history.json');
const ASSETS_DIR   = path.join(ITERFORGE_HOME, 'assets', 'generated');

// Write-lock to prevent concurrent writes corrupting the JSON
let historyWriteQueue = Promise.resolve();

// Read the history array (creates empty if missing)
async function readHistory() {
  if (!(await fs.pathExists(HISTORY_FILE))) return [];
  try { return await fs.readJson(HISTORY_FILE); } catch { return []; }
}

// Write history safely — serialises concurrent writes via queue
async function writeHistory(updater) {
  historyWriteQueue = historyWriteQueue.then(async () => {
    const history = await readHistory();
    const updated = updater(history);
    await fs.writeJson(HISTORY_FILE, updated.slice(0, 200), { spaces: 2 });
    return updated;
  }).catch(() => {});
  return historyWriteQueue;
}

// GET /api/history
router.get('/', async (_req, res) => {
  try {
    const history = await readHistory();
    res.json({ generations: history, total: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history/:id/image  — stream the PNG
router.get('/:id/image', async (req, res) => {
  try {
    const history = await readHistory();
    const entry = history.find(h => h.id === req.params.id);
    if (!entry || !(await fs.pathExists(entry.imagePath))) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.sendFile(entry.imagePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/history/all  — wipe everything
router.delete('/all', async (_req, res) => {
  try {
    const history = await readHistory();
    await Promise.all(history.map(e => e.imagePath ? fs.remove(e.imagePath).catch(() => {}) : Promise.resolve()));
    await writeHistory(() => []);
    res.json({ success: true, deleted: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/history/:id
router.delete('/:id', async (req, res) => {
  try {
    const history = await readHistory();
    const entry = history.find(h => h.id === req.params.id);
    if (entry?.imagePath) {
      await fs.remove(entry.imagePath).catch(() => {});
    }
    await writeHistory(h => h.filter(e => e.id !== req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { readHistory, writeHistory, HISTORY_FILE, ASSETS_DIR };
export default router;
