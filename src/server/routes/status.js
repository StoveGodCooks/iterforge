import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { healthCheck, isIPAdapterAvailable, getControlNetStatus, isUpscalerAvailable } from '../../backends/comfyui.js';
import { readEnv, ITERFORGE_HOME } from '../../env/reader.js';
import { isComfyStarting, isComfyInstalled } from '../comfyui-manager.js';
import { getSetupState } from './setup.js';

const MANAGED_BLENDER_EXE  = path.join(ITERFORGE_HOME, 'blender', 'blender.exe');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const [comfyHealth, env, comfyInstalled, blenderInstalled, ipAdapterReady, controlNet, upscalerReady] = await Promise.all([
      healthCheck(),
      readEnv(),
      isComfyInstalled(),
      fs.pathExists(MANAGED_BLENDER_EXE),
      isIPAdapterAvailable(),
      getControlNetStatus(),
      isUpscalerAvailable(),
    ]);

    res.json({
      server:            'ok',
      comfyui:           comfyHealth.ok ? 'ok' : 'error',
      comfyStarting:     isComfyStarting(),
      comfyInstalled,
      blenderInstalled,
      blenderVersion:    env.tools?.blender?.version ?? null,
      setup:             getSetupState(),
      tier:              env.tier ?? 'local',
      version:           '1.0.0',
      ipAdapterReady,
      controlNet,        // { openpose, canny, depth } booleans
      upscalerReady,
    });
  } catch (err) {
    res.status(500).json({ server: 'error', error: err.message });
  }
});

export default router;
