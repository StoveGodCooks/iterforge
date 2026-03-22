/**
 * triposr.js — Inter-Forge TripoSR 3D reconstruction backend
 *
 * Mirrors the blender.js pattern:
 *   findComfyPython()    — locate the ComfyUI embedded Python (torch already there)
 *   generate3dAsset()    — subprocess: run triposr_infer.py, parse progress, resolve with paths
 *
 * Job management (in-memory store + polling) is handled by the route layer
 * (src/server/routes/triposr.js), same as blender routes.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { ITERFORGE_HOME } from '../env/reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the inference script — unpacked from asar if packaged
function unpackedPath(p) {
  return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
}

const INFER_SCRIPT = unpackedPath(
  path.join(__dirname, '..', '3d', 'inference', 'triposr_infer.py')
);

// Where TripoSR output is stored
const OUTPUT_DIR = path.join(ITERFORGE_HOME, '3d', 'triposr-out');

// Python candidates — checked in priority order
// python-base is Inter-Forge's own managed Python (torch already installed)
const COMFYUI_PYTHON_CANDIDATES = [
  path.join(ITERFORGE_HOME, 'python-base', 'python.exe'),           // Inter-Forge managed (preferred)
  path.join(ITERFORGE_HOME, 'comfyui', 'python_embeded', 'python.exe'),
  path.join(ITERFORGE_HOME, 'comfyui', 'python_embedded', 'python.exe'),
  path.join(process.env.USERPROFILE ?? 'C:\\Users\\Default', 'ComfyUI', 'python_embeded', 'python.exe'),
  'C:\\ComfyUI\\python_embeded\\python.exe',
];

// ── Python detection ──────────────────────────────────────────────────────────

/**
 * Find the best available Python executable for running TripoSR.
 * Priority: ComfyUI embedded (torch already installed) → system python3 → python
 */
export async function findComfyPython(overridePath = null) {
  if (overridePath && await fs.pathExists(overridePath)) {
    return overridePath;
  }

  // Read env.json for user-configured ComfyUI path
  try {
    const { readEnv } = await import('../env/reader.js');
    const env = await readEnv();
    const comfyDir = env.tools?.comfyui?.path ?? null;
    if (comfyDir) {
      for (const sub of ['python_embeded', 'python_embedded']) {
        const candidate = path.join(comfyDir, sub, 'python.exe');
        if (await fs.pathExists(candidate)) return candidate;
      }
    }
  } catch { /* ignore */ }

  // Fall back to known locations
  for (const candidate of COMFYUI_PYTHON_CANDIDATES) {
    if (await fs.pathExists(candidate)) return candidate;
  }

  // System Python as last resort
  return 'python3';
}

// ── Core inference runner ─────────────────────────────────────────────────────

/**
 * Run the TripoSR inference script as a subprocess.
 *
 * @param {object} opts
 * @param {string}   opts.imagePath     - absolute path to source PNG
 * @param {string}  [opts.maskPath]     - optional foreground mask PNG
 * @param {number}  [opts.resolution]   - marching cubes resolution (default 256)
 * @param {string}  [opts.stem]         - output filename stem
 * @param {string}  [opts.pythonExe]    - override Python executable
 * @param {function}[opts.onProgress]   - callback(n, total, msg) for progress events
 * @returns {Promise<{ glbPath, previewPath, resolution, device }>}
 */
export async function generate3dAsset({
  imagePath,
  maskPath = null,
  resolution = 256,
  stem = null,
  pythonExe = null,
  onProgress = null,
}) {
  const pyExe     = pythonExe ?? await findComfyPython();
  const outputDir = OUTPUT_DIR;
  await fs.ensureDir(outputDir);

  const scriptArgs = [
    INFER_SCRIPT,
    '--image',      imagePath,
    '--output',     outputDir,
    '--resolution', String(resolution),
  ];
  if (maskPath) scriptArgs.push('--mask', maskPath);
  if (stem)     scriptArgs.push('--stem', stem);

  return new Promise((resolve, reject) => {
    const child = spawn(pyExe, scriptArgs, {
      windowsHide: true,
      env: {
        ...process.env,
        // Pass ITERFORGE_HOME so the Python script can resolve weight/package dirs
        ITERFORGE_HOME: ITERFORGE_HOME,
        // Suppress Python output buffering
        PYTHONUNBUFFERED: '1',
      },
    });

    let result = null;
    let lastError = null;
    const lines = [];

    function handleLine(line) {
      line = line.trim();
      if (!line) return;
      lines.push(line);

      if (line.startsWith('[TripoSR] PROGRESS:')) {
        // "[TripoSR] PROGRESS: 3/10 Loading model…"
        const m = line.match(/PROGRESS:\s*(\d+)\/(\d+)\s*(.*)/);
        if (m && onProgress) onProgress(Number(m[1]), Number(m[2]), m[3]);
        return;
      }

      if (line.startsWith('[TripoSR] DONE:')) {
        const jsonStr = line.slice('[TripoSR] DONE:'.length).trim();
        try { result = JSON.parse(jsonStr); } catch { /* malformed */ }
        return;
      }

      if (line.startsWith('[TripoSR] ERROR:')) {
        lastError = line.slice('[TripoSR] ERROR:'.length).trim();
      }
    }

    let stdoutBuf = '';
    child.stdout?.on('data', chunk => {
      stdoutBuf += chunk.toString();
      const parts = stdoutBuf.split('\n');
      stdoutBuf = parts.pop();
      parts.forEach(handleLine);
    });

    let stderrBuf = '';
    child.stderr?.on('data', chunk => {
      stderrBuf += chunk.toString();
      const parts = stderrBuf.split('\n');
      stderrBuf = parts.pop();
      parts.forEach(l => lines.push(`[stderr] ${l}`));
    });

    child.on('close', code => {
      // Flush remaining buffered output
      if (stdoutBuf.trim()) handleLine(stdoutBuf);

      if (result) {
        resolve(result);
      } else if (lastError) {
        reject(new Error(lastError));
      } else {
        const tail = lines.slice(-20).join('\n');
        reject(new Error(
          `TripoSR process exited with code ${code}.\n${tail}`
        ));
      }
    });

    child.on('error', err => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}
