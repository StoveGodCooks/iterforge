/**
 * sprite_post.js — Inter-Forge backend adapter for sprite_post.py.
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

export const SPRITE_POST_PY = unpackedPath(
  path.join(__dirname, '..', '3d', 'masterforge', 'sprite_post.py')
);

/**
 * Normalize a sprite frame (center and scale).
 */
export async function normalizeFrame(imagePath, outputPath, size = 512) {
  return _runWithArgs({ action: 'normalize', image_path: imagePath, output_path: outputPath, size });
}

/**
 * Pack frames into a grid sheet.
 */
export async function packSheet(framePaths, outputPath, cols = 2) {
  return _runWithArgs({ action: 'pack', frame_paths: framePaths, output_path: outputPath, cols });
}

/**
 * Write Godot .tres metadata.
 */
export async function writeGodotMetadata(outputPath, sheetName, frameCount, cols, size) {
  return _runWithArgs({ action: 'metadata', output_path: outputPath, sheet_name: sheetName, frame_count: frameCount, cols, size });
}

async function _runWithArgs(args) {
  const pythonExe = findPython();
  const argsPath = path.join(tmpdir(), `sp_args_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.json`);
  
  try {
    await writeFile(argsPath, JSON.stringify(args));

    return new Promise((resolve, reject) => {
      const child = spawn(pythonExe, [SPRITE_POST_PY, '--args', argsPath], {
        cwd: path.dirname(SPRITE_POST_PY),
        windowsHide: true
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', async (code) => {
        await unlink(argsPath).catch(() => {});
        if (code === 0) resolve();
        else reject(new Error(stderr || `Python exited ${code}`));
      });
    });
  } catch (err) {
    throw new Error('Failed to initiate sprite post-processing: ' + err.message);
  }
}
