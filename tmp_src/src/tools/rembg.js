/**
 * Node.js wrapper around remove_bg.py (rembg).
 * Returns the same path on success, throws on failure.
 * If rembg/Python is unavailable, resolves silently (non-blocking).
 */
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'remove_bg.py');

// Prefer the managed Inter-Forge Python (has rembg installed) over any system Python.
const ITERFORGE_HOME = path.join(os.homedir(), 'AppData', 'Roaming', 'IterForge');
const MANAGED_PYTHON = path.join(ITERFORGE_HOME, 'python-base', 'python.exe');

async function resolvePython() {
  if (await fs.pathExists(MANAGED_PYTHON)) return MANAGED_PYTHON;
  return 'python'; // fallback to system Python
}

/**
 * Remove the background from an image file (in-place).
 * @param {string} imagePath   - absolute path to the PNG
 * @param {object} opts
 * @param {boolean} opts.white - true = white bg, false = transparent
 * @returns {Promise<string>}  - resolves to imagePath
 */
export async function removeBackground(imagePath, { white = true } = {}) {
  if (!(await fs.pathExists(SCRIPT))) {
    console.warn('[rembg] remove_bg.py not found — skipping background removal');
    return imagePath;
  }

  const tmp = imagePath + '.rembg.png';
  const args = [SCRIPT, imagePath, tmp];
  if (white) args.push('--white');

  const pythonExe = await resolvePython();
  return new Promise((resolve) => {
    const py = spawn(pythonExe, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    py.on('close', async (code) => {
      if (code === 0 && await fs.pathExists(tmp)) {
        await fs.move(tmp, imagePath, { overwrite: true });
        console.log(`[rembg] background removed: ${path.basename(imagePath)}`);
      } else {
        // rembg failed — keep original, don't crash the pipeline
        await fs.remove(tmp).catch(() => {});
        console.warn(`[rembg] failed (exit ${code}) — using original image`);
      }
      resolve(imagePath);
    });

    py.on('error', async () => {
      await fs.remove(tmp).catch(() => {});
      console.warn('[rembg] python not found — skipping background removal');
      resolve(imagePath);
    });
  });
}
