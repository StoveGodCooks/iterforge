import express from 'express';
import { EnvManager } from '../../env/manager.js';
import { startComfyUIBackground } from '../comfyui-manager.js';

const router = express.Router();

// Shared state — broadcast setup progress to the frontend
let _setupState = 'idle'; // idle | running | done | error
let _setupMessage = '';
let _setupError = '';

export const getSetupState = () => ({ state: _setupState, message: _setupMessage, error: _setupError });

// Shared setup runner — used by both the HTTP route and electron-main.js
export function triggerSetup() {
  if (_setupState === 'running') return;
  _setupState   = 'running';
  _setupMessage = 'Starting setup…';
  _setupError   = '';
  ;(async () => {
    try {
      await EnvManager.setup({ onProgress: (msg) => { _setupMessage = msg; } });
      _setupState   = 'done';
      _setupMessage = 'Setup complete — starting ComfyUI…';
      startComfyUIBackground();
    } catch (err) {
      _setupState   = 'error';
      _setupError   = err.message;
      _setupMessage = '';
    }
  })();
}

// GET /api/setup — current install state
router.get('/', (_req, res) => {
  res.json(getSetupState());
});

// POST /api/setup/install — trigger full environment setup (Python + ComfyUI + deps)
router.post('/install', (_req, res) => {
  triggerSetup();
  res.json(getSetupState());
});

export default router;
