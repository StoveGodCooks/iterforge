/**
 * blender.js — Inter-Forge Blender backend adapter
 *
 * Mirrors the comfyui.js pattern:
 *   detectBlender()    — find blender.exe on this machine
 *   applyTexture()     — headless subprocess: apply texture to mesh, export GLB
 *   exportFromBlend()  — headless subprocess: re-export GLB from saved .blend
 *   openGui()          — spawn full Blender GUI window (detached, user-controlled)
 *   watchBlend()       — fs.watch wrapper with 1s debounce for live sync
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { fileURLToPath } from 'url';
import { ITERFORGE_HOME } from '../env/reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Inter-Forge-managed Blender install path (set by EnvManager.ensureBlender)
const MANAGED_BLENDER_EXE = path.join(ITERFORGE_HOME, 'blender', 'blender.exe');

// When packaged by Electron, scripts live inside app.asar but external processes
// (like Blender) can only read from app.asar.unpacked. Replace the path segment.
function unpackedPath(p) {
  return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
}

// Absolute path to the Python bpy scripts (unpacked so Blender can read them)
const APPLY_SCRIPT  = unpackedPath(path.join(__dirname, '..', '3d', 'templates', 'apply_texture.py'));
const EXPORT_SCRIPT = unpackedPath(path.join(__dirname, '..', '3d', 'templates', 'export_blend.py'));

// ── Blender detection ────────────────────────────────────────────────────────

/**
 * Locate blender.exe on Windows.
 * Priority: settingsPath → Program Files glob → PATH
 * Returns { found, path, version } — version is null if not retrieved yet.
 */
export async function detectBlender(settingsPath = null) {
  // 0. Inter-Forge-managed install (downloaded by EnvManager.ensureBlender during setup)
  if (await fs.pathExists(MANAGED_BLENDER_EXE)) {
    const version = await getBlenderVersion(MANAGED_BLENDER_EXE).catch(() => null);
    return { found: true, path: MANAGED_BLENDER_EXE, version, managed: true };
  }

  // 1. User-specified path from Settings panel
  if (settingsPath) {
    const exists = await fs.pathExists(settingsPath);
    if (exists) {
      const version = await getBlenderVersion(settingsPath);
      return { found: true, path: settingsPath, version };
    }
  }

  // 2. Glob Program Files for any installed Blender 3.x / 4.x
  const programDirs = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean);

  for (const dir of programDirs) {
    const blenderRoot = path.join(dir, 'Blender Foundation');
    if (!(await fs.pathExists(blenderRoot))) continue;
    try {
      const entries = await fs.readdir(blenderRoot);
      // Sort descending so we pick the newest version first
      const blenderDirs = entries
        .filter(e => e.toLowerCase().startsWith('blender'))
        .sort()
        .reverse();
      for (const sub of blenderDirs) {
        const candidate = path.join(blenderRoot, sub, 'blender.exe');
        if (await fs.pathExists(candidate)) {
          const version = await getBlenderVersion(candidate);
          return { found: true, path: candidate, version };
        }
      }
    } catch { /* readdir failed, keep searching */ }
  }

  // 3. Blender on PATH
  try {
    const version = await getBlenderVersion('blender');
    return { found: true, path: 'blender', version };
  } catch { /* not on PATH */ }

  return { found: false, path: null, version: null };
}

/** Run `blender --version` and return the version string, or throw on failure. */
async function getBlenderVersion(blenderExe) {
  return new Promise((resolve, reject) => {
    const child = spawn(blenderExe, ['--version'], { windowsHide: true });
    let out = '';
    child.stdout?.on('data', d => { out += d.toString(); });
    child.stderr?.on('data', d => { out += d.toString(); });
    child.on('close', code => {
      const match = out.match(/Blender\s+([\d.]+)/i);
      if (match) resolve(match[1]);
      else if (code === 0) resolve('unknown');
      else reject(new Error(`blender --version exit ${code}`));
    });
    child.on('error', reject);
    // Timeout after 5 seconds
    setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 5000);
  });
}

// ── Headless operations ───────────────────────────────────────────────────────

/**
 * Apply a texture to a mesh and export as GLB.
 * Runs Blender headless — awaited, not detached.
 *
 * @param {object} opts
 * @param {string} opts.blenderExe   - path to blender.exe
 * @param {string} opts.meshType     - 'plane'|'cube'|'cylinder'|'sphere'|'custom:/path/to/mesh.glb'
 * @param {string} opts.texturePath  - absolute path to the source PNG
 * @param {string} opts.outputGlb    - absolute path for the output GLB
 * @param {string} opts.outputBlend  - absolute path for the saved .blend
 * @param {function} [opts.onLog]    - optional callback for stdout/stderr lines
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string }>}
 */
export async function applyTexture({ blenderExe, meshType, texturePath, outputGlb, outputBlend, subdivisionLevel = 1, rotationDeg = 0, onLog }) {
  return runHeadlessScript({
    blenderExe,
    scriptPath: APPLY_SCRIPT,
    args:       [meshType, texturePath, outputGlb, outputBlend, String(subdivisionLevel ?? 1), String(rotationDeg ?? 0)],
    onLog,
  });
}

/**
 * Re-export a GLB from an existing .blend file.
 * Called automatically when the file watcher detects a save in Blender GUI.
 */
export async function exportFromBlend({ blenderExe, blendFile, outputGlb, onLog }) {
  return runHeadlessScript({
    blenderExe,
    blendFile,      // passed as a positional arg to blender before --python
    scriptPath: EXPORT_SCRIPT,
    args:       [outputGlb],
    onLog,
  });
}

/** Internal: run any headless Blender script and collect output. */
function runHeadlessScript({ blenderExe, blendFile = null, scriptPath, args, onLog }) {
  return new Promise((resolve) => {
    const blenderArgs = ['--background'];
    if (blendFile) blenderArgs.push(blendFile);
    blenderArgs.push('--python', scriptPath, '--', ...args);

    const child = spawn(blenderExe, blenderArgs, {
      windowsHide: true,
      // Do NOT detach — we need to await this process
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => {
      const line = chunk.toString();
      stdout += line;
      onLog?.(line.trim());
    });
    child.stderr?.on('data', chunk => {
      const line = chunk.toString();
      stderr += line;
      onLog?.(line.trim());
    });

    child.on('close', code => {
      resolve({ success: code === 0, stdout, stderr, exitCode: code });
    });

    child.on('error', err => {
      resolve({ success: false, stdout, stderr: stderr + '\n' + err.message, exitCode: -1 });
    });
  });
}

// ── Full GUI spawn ────────────────────────────────────────────────────────────

/**
 * Open the full Blender GUI with a .blend file.
 * Detached and unref'd — the user controls when they close Blender.
 * Returns { pid } for reference.
 */
export function openGui({ blenderExe, blendFile }) {
  const child = spawn(blenderExe, [blendFile], {
    detached:    true,
    windowsHide: false,  // show the Blender window!
    stdio:       'ignore',
  });
  child.unref();
  return { pid: child.pid };
}

// ── File watcher for live sync ────────────────────────────────────────────────

/**
 * Watch a .blend file for changes. When Blender saves the file, calls onChange().
 * Uses a 1-second debounce to avoid double-triggers (Blender writes the file twice on save).
 *
 * Returns { stop() } — call stop() to clean up the watcher.
 */
export function watchBlend(blendFile, onChange) {
  let debounceTimer = null;

  const watcher = fs.watch(blendFile, (eventType) => {
    if (eventType !== 'change') return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 1000);
  });

  watcher.on('error', err => {
    console.warn('[Inter-Forge] watchBlend error:', err.message);
  });

  return {
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      try { watcher.close(); } catch { /* already closed */ }
    },
  };
}
