import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import { ITERFORGE_HOME } from '../../env/reader.js';

const router = express.Router();
const ENV_JSON_PATH = path.join(ITERFORGE_HOME, 'env.json');

// GET /api/settings/comfy-mode  → { mode: 'local'|'cloud', localUrl, cloudUrl }
router.get('/comfy-mode', async (_req, res) => {
  try {
    const env = await fs.readJson(ENV_JSON_PATH);
    const currentUrl  = env?.tools?.comfyui?.url ?? 'http://127.0.0.1:8188';
    const cloudUrl    = env?.tools?.comfyui?.remoteUrl ?? '';
    const isLocal     = currentUrl === 'http://127.0.0.1:8188';
    res.json({ mode: isLocal ? 'local' : 'cloud', localUrl: 'http://127.0.0.1:8188', cloudUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/comfy-mode  body: { mode: 'local'|'cloud', cloudUrl?: string }
router.post('/comfy-mode', async (req, res) => {
  try {
    const { mode, cloudUrl } = req.body;
    const env = await fs.readJson(ENV_JSON_PATH);

    if (!env.tools) env.tools = {};
    if (!env.tools.comfyui) env.tools.comfyui = {};

    if (mode === 'cloud') {
      if (!cloudUrl) return res.status(400).json({ error: 'cloudUrl required for cloud mode' });
      // Store the cloud URL and save as active URL
      env.tools.comfyui.remoteUrl = cloudUrl;
      env.tools.comfyui.url       = cloudUrl;
    } else {
      // Save cloud URL for later, switch active to local
      if (cloudUrl) env.tools.comfyui.remoteUrl = cloudUrl;
      env.tools.comfyui.url = 'http://127.0.0.1:8188';
    }

    await fs.writeJson(ENV_JSON_PATH, env, { spaces: 2 });
    res.json({ ok: true, activeUrl: env.tools.comfyui.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
