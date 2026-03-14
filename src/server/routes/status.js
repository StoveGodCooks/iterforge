import express from 'express';
import { healthCheck } from '../../backends/comfyui.js';
import { readEnv } from '../../env/reader.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const [comfyHealth, env] = await Promise.all([
      healthCheck(),
      readEnv(),
    ]);

    res.json({
      server:  'ok',
      comfyui: comfyHealth.ok ? 'ok' : 'error',
      tier:    env.tier ?? 'free',
      version: '1.0.0',
    });
  } catch (err) {
    res.status(500).json({ server: 'error', error: err.message });
  }
});

export default router;
