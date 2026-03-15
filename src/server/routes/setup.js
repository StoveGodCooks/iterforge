import express from 'express';
import { EnvManager } from '../../env/manager.js';

const router = express.Router();

// Shared state — broadcast setup progress to the frontend
let _setupState = 'idle'; // idle | running | done | error
let _setupMessage = '';
let _setupError = '';

export const getSetupState = () => ({ state: _setupState, message: _setupMessage, error: _setupError });

// GET /api/setup — current install state
router.get('/', (_req, res) => {
  res.json(getSetupState());
});

// POST /api/setup/install — trigger full environment setup (Python + ComfyUI + deps)
router.post('/install', async (_req, res) => {
  if (_setupState === 'running') {
    return res.json({ state: 'running', message: _setupMessage });
  }

  _setupState   = 'running';
  _setupMessage = 'Starting setup…';
  _setupError   = '';
  res.json({ state: 'running', message: _setupMessage });

  // Run in background — frontend polls GET /api/setup for progress
  ;(async () => {
    try {
      // Monkey-patch ora so spinner.text updates our message
      const origSetup = EnvManager.setup.bind(EnvManager);
      await origSetup({
        onProgress: (msg) => { _setupMessage = msg; },
      });
      _setupState   = 'done';
      _setupMessage = 'Setup complete — restarting ComfyUI…';
    } catch (err) {
      _setupState   = 'error';
      _setupError   = err.message;
      _setupMessage = '';
    }
  })();
});

export default router;
