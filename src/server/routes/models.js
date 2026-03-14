import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../env/reader.js';

const router = express.Router();
const CHECKPOINTS_DIR = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'checkpoints');

router.get('/', async (_req, res) => {
  try {
    await fs.ensureDir(CHECKPOINTS_DIR);
    const files = await fs.readdir(CHECKPOINTS_DIR);
    const models = files.filter(f => f.endsWith('.safetensors') || f.endsWith('.ckpt'));
    res.json({ available: models, default: models[0] ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
