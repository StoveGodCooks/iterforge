/**
 * inkscape.js — Inter-Forge Inkscape backend adapter
 *
 *   detectInkscape()  — find inkscape.exe (managed install → Program Files → PATH)
 *   openGui()         — open a file in the full Inkscape GUI (detached)
 *   exportToPng()     — headless: export SVG/PNG to PNG
 *   makeSvgWrapper()  — create a working SVG that embeds a PNG for drawing on top
 *   watchFile()       — fs.watch with 1s debounce for live sync
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { ITERFORGE_HOME } from '../env/reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MANAGED_INKSCAPE_DIR = path.join(ITERFORGE_HOME, 'inkscape');
export const MANAGED_INKSCAPE_EXE = path.join(MANAGED_INKSCAPE_DIR, 'bin', 'inkscape.exe');

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectInkscape(settingsPath = null) {
  // 0. Managed install
  if (await fs.pathExists(MANAGED_INKSCAPE_EXE)) {
    const version = await getVersion(MANAGED_INKSCAPE_EXE).catch(() => null);
    return { found: true, path: MANAGED_INKSCAPE_EXE, version, managed: true };
  }

  // 1. User-specified path
  if (settingsPath && await fs.pathExists(settingsPath)) {
    const version = await getVersion(settingsPath).catch(() => null);
    return { found: true, path: settingsPath, version };
  }

  // 2. Program Files
  const programDirs = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    'C:\\Program Files',
  ].filter(Boolean);

  for (const dir of programDirs) {
    const candidate = path.join(dir, 'Inkscape', 'bin', 'inkscape.exe');
    if (await fs.pathExists(candidate)) {
      const version = await getVersion(candidate).catch(() => null);
      return { found: true, path: candidate, version };
    }
  }

  // 3. PATH
  try {
    const version = await getVersion('inkscape');
    return { found: true, path: 'inkscape', version };
  } catch { /* not on PATH */ }

  return { found: false, path: null, version: null };
}

async function getVersion(exe) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['--version'], { windowsHide: true });
    let out = '';
    child.stdout?.on('data', d => { out += d.toString(); });
    child.stderr?.on('data', d => { out += d.toString(); });
    child.on('close', code => {
      const match = out.match(/Inkscape\s+([\d.]+)/i);
      if (match) resolve(match[1]);
      else if (code === 0) resolve('unknown');
      else reject(new Error(`exit ${code}`));
    });
    child.on('error', reject);
    setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 5000);
  });
}

// ── SVG wrapper ───────────────────────────────────────────────────────────────

/**
 * Create a working SVG that embeds the source PNG as a base layer.
 * The user draws on top with Inkscape's vector tools.
 * On save, export back to PNG.
 *
 * @param {string} pngPath    - absolute path to the source PNG
 * @param {string} svgPath    - absolute path for the output SVG
 * @param {{ width, height }} dims - image dimensions (defaults to 1024×1024)
 */
export async function makeSvgWrapper(pngPath, svgPath, dims = { width: 1024, height: 1024 }) {
  const { width, height } = dims;

  // Windows absolute path → proper file:/// URI
  // e.g. C:\Users\... → file:///C:/Users/...
  const forwardSlash = pngPath.replace(/\\/g, '/');
  const pngUri = forwardSlash.startsWith('/')
    ? `file://${forwardSlash}`           // already has leading slash (UNC or Unix)
    : `file:///${forwardSlash}`;         // Windows drive letter: C:/...

  // Also embed the PNG as a base64 data URI as fallback for Inkscape file resolution
  let base64Src = pngUri;
  try {
    const raw = await fs.readFile(pngPath);
    base64Src = `data:image/png;base64,${raw.toString('base64')}`;
  } catch { /* fall back to file URI */ }

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}">
  <sodipodi:namedview inkscape:current-layer="draw-layer" />
  <!-- Base raster layer — the generated image -->
  <g id="base-layer"
     inkscape:label="Base Image"
     inkscape:groupmode="layer"
     inkscape:lock="true">
    <image
      id="base-image"
      xlink:href="${base64Src}"
      x="0" y="0"
      width="${width}" height="${height}"
      preserveAspectRatio="none"
      style="image-rendering:optimizeQuality" />
  </g>
  <!-- Drawing layer — add vectors/paint here -->
  <g id="draw-layer"
     inkscape:label="Drawing"
     inkscape:groupmode="layer">
  </g>
</svg>`;
  await fs.outputFile(svgPath, svgContent, 'utf8');
}

// ── Headless export ───────────────────────────────────────────────────────────

/**
 * Export an SVG (or PNG) to a PNG using Inkscape headless.
 * @returns {Promise<{ success, stdout, stderr }>}
 */
export function exportToPng({ inkscapeExe, inputPath, outputPng, width, height }) {
  return new Promise(resolve => {
    const args = [
      '--export-type=png',
      `--export-filename=${outputPng}`,
    ];
    if (width)  args.push(`--export-width=${width}`);
    if (height) args.push(`--export-height=${height}`);
    args.push(inputPath);

    const child = spawn(inkscapeExe, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('close', code => resolve({ success: code === 0, stdout, stderr, exitCode: code }));
    child.on('error', err => resolve({ success: false, stdout, stderr: err.message, exitCode: -1 }));
    setTimeout(() => { child.kill(); resolve({ success: false, stdout, stderr: 'TIMEOUT', exitCode: -1 }); }, 60_000);
  });
}

// ── GUI spawn ─────────────────────────────────────────────────────────────────

/**
 * Open a file in the full Inkscape GUI. Detached + unref'd.
 * Returns { pid }.
 */
export function openGui({ inkscapeExe, filePath }) {
  const child = spawn(inkscapeExe, [filePath], {
    detached:    true,
    windowsHide: false,
    stdio:       'ignore',
  });
  child.unref();
  return { pid: child.pid };
}

// ── File watcher ──────────────────────────────────────────────────────────────

/**
 * Watch a file for changes with 1s debounce. Returns { stop() }.
 */
export function watchFile(filePath, onChange) {
  let debounceTimer = null;

  const watcher = fs.watch(filePath, eventType => {
    if (eventType !== 'change') return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 1000);
  });

  watcher.on('error', err => console.warn('[Inter-Forge] inkscape watchFile error:', err.message));

  return {
    stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      try { watcher.close(); } catch { /* already closed */ }
    },
  };
}
