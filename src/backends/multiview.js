/**
 * multiview.js — Inter-Forge backend adapter for multiview.py.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { findPython } from './masterforge.js';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function unpackedPath(p) {
  return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
}

export const MULTIVIEW_PY = unpackedPath(
  path.join(__dirname, '..', '3d', 'masterforge', 'multiview.py')
);

/**
 * Validate that a set of views (front, left, right) is complete.
 * Uses a temporary JSON file for arguments to prevent path injection.
 */
export async function validateViewSet(views) {
  const pythonExe = findPython();
  const argsPath = path.join(tmpdir(), `mv_args_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.json`);
  
  try {
    await writeFile(argsPath, JSON.stringify({ views }));

    return new Promise((resolve) => {
      const child = spawn(pythonExe, [MULTIVIEW_PY, '--args', argsPath], {
        cwd: path.dirname(MULTIVIEW_PY),
        windowsHide: true
      });

      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });

      child.on('close', async () => {
        await unlink(argsPath).catch(() => {});
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result.valid);
        } catch {
          resolve(false);
        }
      });
    });
  } catch (err) {
    console.error('[Multiview] Failed to initiate validation:', err.message);
    return false;
  }
}
