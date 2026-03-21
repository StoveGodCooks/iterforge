import path from 'path';
import os from 'os';
import fs from 'fs-extra';

export const ITERFORGE_HOME     = path.join(os.homedir(), 'AppData', 'Roaming', 'IterForge');
export const ENV_PATH           = path.join(ITERFORGE_HOME, 'env.json');
export const BLENDER_ASSETS_DIR = path.join(ITERFORGE_HOME, '3d');

// ComfyUI's embedded Python — torch/transformers already installed here.
// Used by TripoSR inference to avoid a separate Python install.
export const COMFYUI_PYTHON     = path.join(ITERFORGE_HOME, 'comfyui', 'python_embeded', 'python.exe');

const DEFAULT_ENV = {
  version: '1.0',
  iterforge_version: '1.0.0',
  tools: {},
  runpod: { endpoint_url: '', enabled: false },
  tier: 'free'
};

export async function readEnv() {
  if (!(await fs.pathExists(ENV_PATH))) return structuredClone(DEFAULT_ENV);
  try {
    return await fs.readJson(ENV_PATH);
  } catch {
    return structuredClone(DEFAULT_ENV);
  }
}
