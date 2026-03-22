/**
 * masterforge.js — Inter-Forge backend adapter for the MasterForge Python pipeline.
 *
 * Mirrors the blender.js pattern:
 *   findPython()     — locate python-base python.exe
 *   generateMesh()   — headless subprocess: PNG → STL + GLB + DXF + LODs
 *
 * No Blender required — entirely headless Python 3.11 pipeline.
 */

import { spawn }        from 'child_process';
import path             from 'path';
import fs               from 'fs-extra';
import os               from 'os';
import { fileURLToPath } from 'url';
import { ITERFORGE_HOME } from '../env/reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// When packaged by Electron, scripts must be read from app.asar.unpacked
function unpackedPath(p) {
  return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
}

// Absolute path to masterforge entry point
export const RUN_PY = unpackedPath(
  path.join(__dirname, '..', '3d', 'masterforge', 'run.py')
);

// Asset types that masterforge handles (maps to assets/<type>.json configs)
export const MASTERFORGE_ASSET_TYPES = ['sword', 'axe', 'dagger', 'staff'];

/**
 * Locate the Inter-Forge python-base python.exe.
 * Priority: managed install → roaming profile → PATH fallback.
 */
export function findPython() {
  const candidates = [
    path.join(ITERFORGE_HOME, 'python-base', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Inter-Forge', 'python-base', 'python.exe'),
  ];

  for (const c of candidates) {
    if (fs.pathExistsSync(c)) return c;
  }

  // PATH fallback — used in dev / non-Windows environments
  return 'python';
}

/**
 * Run the MasterForge pipeline headlessly.
 * Awaited — not detached.
 *
 * @param {object}   opts
 * @param {string}   opts.imagePath   — absolute path to input PNG
 * @param {string}   [opts.assetType] — 'sword' | 'axe' | 'dagger' | 'staff' (default: 'sword')
 * @param {string}   opts.outputDir   — directory to write all output files
 * @param {boolean}  [opts.useMidas]  — enable MiDaS neural depth (needs timm, default: false)
 * @param {boolean}  [opts.noLod]     — skip LOD generation (default: false)
 * @param {boolean}  [opts.noDxf]     — skip DXF export (default: false)
 * @param {string}   [opts.leftImagePath]  — optional left side view
 * @param {string}   [opts.rightImagePath] — optional right side view
 * @param {string}   [opts.backImagePath]  — optional back view
 * @param {function} [opts.onLog]     — optional callback for stdout lines
 *
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, exitCode: number }>}
 */
export async function generateMesh({
  imagePath,
  assetType = 'sword',
  outputDir,
  useMidas  = false,
  noLod     = false,
  noDxf     = false,
  leftImagePath  = null,
  rightImagePath = null,
  backImagePath  = null,
  onLog,
}) {
  const pythonExe = findPython();

  const args = [
    RUN_PY,
    imagePath,
    '--type',   assetType,
    '--output', outputDir,
  ];

  if (useMidas) {
    args.push('--midas');
  } else {
    args.push('--no-midas');
  }

  if (noLod)    args.push('--no-lod');
  if (noDxf)    args.push('--no-dxf');

  if (leftImagePath)  args.push('--left-image',  leftImagePath);
  if (rightImagePath) args.push('--right-image', rightImagePath);
  if (backImagePath)  args.push('--back-image',  backImagePath);

  return new Promise((resolve) => {
    const child = spawn(pythonExe, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';

    // 10-minute timeout for complex lofts
    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        success:  false,
        stdout,
        stderr:   stderr + '\n[Error] Process timed out after 10 minutes',
        exitCode: -1,
      });
    }, 10 * 60 * 1000);

    child.stdout?.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      if (onLog) {
        const lines = text.split('\n');
        lines.forEach(l => { if (l.trim()) onLog(l.trim()); });
      }
    });

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ success: code === 0, stdout, stderr, exitCode: code });
    });

    child.on('error', err => {
      clearTimeout(timeout);
      resolve({
        success:  false,
        stdout,
        stderr:   stderr + '\n' + err.message,
        exitCode: -1,
      });
    });
  });
}
