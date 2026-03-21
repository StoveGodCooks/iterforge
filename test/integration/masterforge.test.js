/**
 * Integration test: MasterForge 3D pipeline prerequisites
 * Tests Python availability, run.py, asset configs, and stdlib imports.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let SkipError;
try {
  const runnerPath = path.resolve(__dirname, '../runner.js');
  const { SkipError: SE } = await import(pathToFileURL(runnerPath).href);
  SkipError = SE;
} catch {
  SkipError = class SkipError extends Error {
    constructor(msg) { super(msg); this.name = 'SkipError'; }
  };
}

async function checkPython(exe) {
  try {
    const { stdout } = await execFileAsync(exe, ['--version']);
    return (stdout || '').trim();
  } catch {
    return null;
  }
}

export default async function test() {
  // ── Load masterforge backend to get findPython / RUN_PY ──────────────────
  const backendPath = path.resolve(__dirname, '../../src/backends/masterforge.js');
  const { findPython, RUN_PY, MASTERFORGE_ASSET_TYPES } =
    await import(pathToFileURL(backendPath).href);

  // ── Python executable found ──────────────────────────────────────────────
  const pythonExe  = findPython();
  const pyVersion  = await checkPython(pythonExe);

  // Also try plain 'python' if the managed one wasn't found
  const fallbackVersion = pyVersion ?? await checkPython('python');

  if (!fallbackVersion) {
    throw new SkipError('Python not available (checked managed path and PATH)');
  }
  console.log(`Python found: ${pythonExe} — ${fallbackVersion}`);

  // ── run.py exists ────────────────────────────────────────────────────────
  if (!(await fs.pathExists(RUN_PY))) {
    throw new Error(`MasterForge run.py not found at ${RUN_PY}`);
  }
  console.log(`run.py found: ${RUN_PY}`);

  // ── Asset config JSONs exist in src/3d/masterforge/assets/ ───────────────
  const assetsDir = path.resolve(__dirname, '../../src/3d/masterforge/assets');
  if (!(await fs.pathExists(assetsDir))) {
    throw new Error(`MasterForge assets dir not found: ${assetsDir}`);
  }
  const assetFiles = (await fs.readdir(assetsDir)).filter(f => f.endsWith('.json'));
  if (assetFiles.length === 0) {
    throw new Error(`No asset config JSONs found in ${assetsDir}`);
  }
  console.log(`Asset configs found (${assetFiles.length}): ${assetFiles.join(', ')}`);

  // All expected MASTERFORGE_ASSET_TYPES have a config file
  for (const assetType of MASTERFORGE_ASSET_TYPES) {
    const configFile = path.join(assetsDir, `${assetType}.json`);
    if (!(await fs.pathExists(configFile))) {
      throw new Error(`Missing asset config for type "${assetType}": ${configFile}`);
    }
    // Config is valid JSON
    try {
      const raw = await fs.readFile(configFile, 'utf-8');
      JSON.parse(raw);
    } catch (e) {
      throw new Error(`Asset config ${assetType}.json is not valid JSON: ${e.message}`);
    }
  }
  console.log(`All MASTERFORGE_ASSET_TYPES have valid JSON configs: ${MASTERFORGE_ASSET_TYPES.join(', ')}`);

  // ── Python stdlib imports (basic sanity check) ────────────────────────────
  const pythonToUse = pythonExe !== 'python' && (await checkPython(pythonExe)) ? pythonExe : 'python';
  try {
    await execFileAsync(pythonToUse, [
      '-c',
      'import sys, os, pathlib, argparse; print("stdlib ok")',
    ], { timeout: 10_000 });
    console.log('Python stdlib (sys, os, pathlib, argparse) importable');
  } catch (e) {
    throw new Error(`Python stdlib check failed: ${e.message}`);
  }

  // ── MasterForge does NOT require Blender ─────────────────────────────────
  // This is a design guarantee: run.py is pure Python, no bpy.
  const runPyContent = await fs.readFile(RUN_PY, 'utf-8');
  if (runPyContent.includes('import bpy') || runPyContent.includes('from bpy')) {
    throw new Error('run.py imports bpy — MasterForge should be Blender-free');
  }
  console.log('Confirmed: run.py does not import Blender (bpy)');
}
