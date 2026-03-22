/**
 * editor.js — Inline canvas editor API
 *
 * POST /api/editor/paint-apply  — save a painted canvas PNG over the source asset
 */

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ASSETS_DIR, readHistory, writeHistory } from './history.js';

const router = express.Router();

// POST /api/editor/paint-apply
// Body: { imageData: 'data:image/png;base64,...', filename: 'foo.png', historyId: '...' }
router.post('/paint-apply', async (req, res) => {
  try {
    const { imageData, filename, historyId } = req.body;
    if (!imageData || !filename) {
      return res.status(400).json({ error: 'imageData and filename required' });
    }

    // Strip data URL prefix
    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');

    const destPath = path.join(ASSETS_DIR, path.basename(filename));
    await fs.ensureDir(ASSETS_DIR);
    await fs.writeFile(destPath, buf);

    // Update history entry timestamp so preview refreshes
    if (historyId) {
      try {
        const history = await readHistory();
        const entry = history.find(h => h.id === historyId);
        if (entry) {
          entry.updatedAt = Date.now();
          await writeHistory(history);
        }
      } catch { /* non-fatal */ }
    }

    res.json({ ok: true, filename: path.basename(destPath) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
