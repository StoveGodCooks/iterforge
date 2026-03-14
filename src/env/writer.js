import fs from 'fs-extra';
import { ENV_PATH, ITERFORGE_HOME, readEnv } from './reader.js';

export async function writeEnv(data) {
  await fs.ensureDir(ITERFORGE_HOME);
  const tmpPath = ENV_PATH + '.tmp';
  await fs.writeJson(tmpPath, data, { spaces: 2 });
  await fs.move(tmpPath, ENV_PATH, { overwrite: true });
}

export async function updateEnv(updates) {
  const current = await readEnv();
  const merged = deepMerge(current, updates);
  await writeEnv(merged);
  return merged;
}

/**
 * Register a tool in env.json.
 * @param {string} name  - tool key (e.g. 'comfyui')
 * @param {object} entry - { path, version, url?, managed, authenticated? }
 */
export async function registerTool(name, entry) {
  return updateEnv({ tools: { [name]: entry } });
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
