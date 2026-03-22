import express from 'express';
import { isPortOpen, startComfyUIBackground } from '../comfyui-manager.js';

const router = express.Router();

// POST /api/comfyui/start — trigger ComfyUI startup from the web UI
router.post('/start', async (_req, res) => {
  try {
    const already = await isPortOpen('127.0.0.1', 8188);
    if (already) {
      return res.json({ status: 'already_running' });
    }
    await startComfyUIBackground();
    res.json({ status: 'starting' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
