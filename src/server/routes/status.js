import express from 'express';
import { healthCheck } from '../../backends/comfyui.js';
import { readEnv } from '../../env/reader.js';
import { isComfyStarting, isComfyInstalled } from '../comfyui-manager.js';
import { getSetupState } from './setup.js';

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const [comfyHealth, env, comfyInstalled] = await Promise.all([
      healthCheck(),
      readEnv(),
      isComfyInstalled(),
    ]);

    res.json({
      server:        'ok',
      comfyui:       comfyHealth.ok ? 'ok' : 'error',
      comfyStarting: isComfyStarting(),
      comfyInstalled,
      setup:         getSetupState(),
      tier:          env.tier ?? 'free',
      version:       '1.0.0',
    });
  } catch (err) {
    res.status(500).json({ server: 'error', error: err.message });
  }
});

export default router;
