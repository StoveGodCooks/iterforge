/**
 * Integration test: ComfyUI connectivity, workflow files, and model utilities.
 */
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fetch from 'node-fetch';

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

export default async function test() {
  const comfyPath = path.resolve(__dirname, '../../src/backends/comfyui.js');
  const {
    healthCheck,
    isIPAdapterAvailable,
    isLightningModel,
    modelDefaults,
  } = await import(pathToFileURL(comfyPath).href);

  const WORKFLOWS_DIR = path.resolve(__dirname, '../../comfyui-workflows');

  // ── All workflow files exist on disk ─────────────────────────────────────
  const expectedWorkflows = [
    'txt2img-sdxl.json',
    'img2img-sdxl.json',
    'sprite-ipadapter-sdxl.json',
  ];
  for (const wf of expectedWorkflows) {
    const wfPath = path.join(WORKFLOWS_DIR, wf);
    if (!(await fs.pathExists(wfPath))) {
      throw new Error(`Required workflow file missing: ${wfPath}`);
    }
  }
  console.log(`All ${expectedWorkflows.length} expected workflow files exist`);

  // ── isLightningModel() ───────────────────────────────────────────────────
  if (!isLightningModel('DreamShaper_XL_Lightning.safetensors')) {
    throw new Error('isLightningModel should return true for DreamShaper_XL_Lightning.safetensors');
  }
  if (isLightningModel('Juggernaut-XL_v9.safetensors')) {
    throw new Error('isLightningModel should return false for Juggernaut-XL_v9.safetensors');
  }
  if (!isLightningModel('SDXL_Turbo_v1.safetensors')) {
    throw new Error('isLightningModel should return true for turbo model');
  }
  if (!isLightningModel('animagine_xl_flash.safetensors')) {
    throw new Error('isLightningModel should return true for flash model');
  }
  if (!isLightningModel('some_hyper_model.safetensors')) {
    throw new Error('isLightningModel should return true for hyper model');
  }
  if (!isLightningModel('anything_lcm.safetensors')) {
    throw new Error('isLightningModel should return true for lcm model');
  }
  console.log('isLightningModel() returns correct results for known model names');

  // ── modelDefaults() ──────────────────────────────────────────────────────
  const lightningDefaults = modelDefaults('DreamShaper_XL_Lightning.safetensors');
  if (typeof lightningDefaults.steps !== 'number') {
    throw new Error('modelDefaults: steps must be a number');
  }
  if (typeof lightningDefaults.cfg !== 'number') {
    throw new Error('modelDefaults: cfg must be a number');
  }
  if (typeof lightningDefaults.sampler !== 'string') {
    throw new Error('modelDefaults: sampler must be a string');
  }
  if (lightningDefaults.steps > 10) {
    throw new Error(`modelDefaults: Lightning model steps should be ≤10, got ${lightningDefaults.steps}`);
  }
  if (lightningDefaults.cfg > 3) {
    throw new Error(`modelDefaults: Lightning model CFG should be ≤3, got ${lightningDefaults.cfg}`);
  }

  const standardDefaults = modelDefaults('Juggernaut-XL_v9.safetensors');
  if (standardDefaults.steps < 15) {
    throw new Error(`modelDefaults: standard model steps should be ≥15, got ${standardDefaults.steps}`);
  }
  console.log(`Lightning defaults: steps=${lightningDefaults.steps} cfg=${lightningDefaults.cfg} sampler=${lightningDefaults.sampler}`);
  console.log(`Standard defaults:  steps=${standardDefaults.steps}  cfg=${standardDefaults.cfg}  sampler=${standardDefaults.sampler}`);

  // ── healthCheck() returns { ok: boolean } ────────────────────────────────
  const health = await healthCheck();
  if (typeof health !== 'object' || health === null) {
    throw new Error('healthCheck() must return an object');
  }
  if (typeof health.ok !== 'boolean') {
    throw new Error('healthCheck() result must have .ok as boolean');
  }
  console.log(`ComfyUI health: ok=${health.ok}`);

  if (!health.ok) {
    console.log('ComfyUI is not running — skipping live endpoint tests');
    // Verify error fields are present
    if (!health.code) throw new Error('healthCheck: failed result missing .code');
    if (!health.fix)  throw new Error('healthCheck: failed result missing .fix');
    console.log(`  code=${health.code}  fix="${health.fix}"`);
    return;
  }

  // ── ComfyUI is running: verify /api/queue responds ───────────────────────
  const COMFYUI_URL = 'http://127.0.0.1:8188';
  try {
    const res = await fetch(`${COMFYUI_URL}/queue`);
    if (!res.ok) throw new Error(`/queue returned ${res.status}`);
    const data = await res.json();
    if (typeof data !== 'object') throw new Error('/queue did not return JSON object');
    console.log('/api/queue endpoint is responsive');
  } catch (e) {
    throw new Error(`ComfyUI /queue check failed: ${e.message}`);
  }

  // ── isIPAdapterAvailable() returns boolean ───────────────────────────────
  const ipAvailable = await isIPAdapterAvailable();
  if (typeof ipAvailable !== 'boolean') {
    throw new Error('isIPAdapterAvailable() must return a boolean');
  }
  console.log(`isIPAdapterAvailable = ${ipAvailable}`);
}
