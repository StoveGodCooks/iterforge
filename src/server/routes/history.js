import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../env/reader.js';

const router = express.Router();
const HISTORY_FILE = path.join(ITERFORGE_HOME, 'history.json');
const ASSETS_DIR   = path.join(ITERFORGE_HOME, 'assets', 'generated');

// Read the history array (creates empty if missing)
async function readHistory() {
  if (!(await fs.pathExists(HISTORY_FILE))) return [];
  try { return await fs.readJson(HISTORY_FILE); } catch { return []; }
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

// DELETE /api/history/:id
router.delete('/:id', async (req, res) => {
  try {
    let history = await readHistory();
    const entry = history.find(h => h.id === req.params.id);
    if (entry?.imagePath) {
      await fs.remove(entry.imagePath).catch(() => {});
    }
    history = history.filter(h => h.id !== req.params.id);
    await fs.writeJson(HISTORY_FILE, history, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { readHistory, HISTORY_FILE, ASSETS_DIR };
export default router;
