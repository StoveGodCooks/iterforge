/**
 * quality.js — Inter-Forge backend adapter for the quality.py diagnostic tool.
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

export const QUALITY_PY = unpackedPath(
  path.join(__dirname, '..', '3d', 'masterforge', 'quality.py')
);

/**
 * Check consistency between reference and generated images.
 * Uses a temporary JSON file for arguments to prevent path injection.
 */
export async function checkConsistency({ refPath, genPath, assetType = 'sword', mode = 'smelting' }) {
  const pythonExe = findPython();
  
  // Write args to temp JSON — no injection possible
  const argsPath = path.join(tmpdir(), `quality_args_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.json`);
  
  try {
    await writeFile(argsPath, JSON.stringify({ 
      ref_path: refPath, 
      gen_path: genPath, 
      asset_type: assetType, 
      mode 
    }));

    return new Promise((resolve) => {
      const child = spawn(pythonExe, [QUALITY_PY, '--args', argsPath], {
        cwd: path.dirname(QUALITY_PY),
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', async (code) => {
        // Cleanup temp file
        await unlink(argsPath).catch(() => {});

        try {
          if (code !== 0) {
            return resolve({ success: false, error: stderr || `Python exited ${code}` });
          }
          const result = JSON.parse(stdout.trim());
          resolve({ success: true, ...result });
        } catch (err) {
          resolve({ success: false, error: 'Failed to parse quality output: ' + err.message, raw: stdout });
        }
      });
    });
  } catch (err) {
    return { success: false, error: 'Failed to initiate consistency check: ' + err.message };
  }
}
