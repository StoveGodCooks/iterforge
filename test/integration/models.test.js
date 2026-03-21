/**
 * Integration test: Model files on disk
 * Checks ITERFORGE_HOME model directories for required files.
 */
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function test() {
  const readerPath = path.resolve(__dirname, '../../src/env/reader.js');
  const { ITERFORGE_HOME } = await import(pathToFileURL(readerPath).href);

  // ── ITERFORGE_HOME is defined ────────────────────────────────────────────
  if (!ITERFORGE_HOME || typeof ITERFORGE_HOME !== 'string') {
    throw new Error('ITERFORGE_HOME is not defined in src/env/reader.js');
  }
  console.log(`ITERFORGE_HOME = ${ITERFORGE_HOME}`);

  const checkpointsDir = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'checkpoints');
  const lorasDir       = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'loras');
  const ipadapterDir   = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'ipadapter');
  const clipVisionDir  = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'clip_vision');
  const customNodesDir = path.join(ITERFORGE_HOME, 'comfyui', 'custom_nodes');

  // ── checkpoints: at least one .safetensors or .ckpt ─────────────────────
  if (!(await fs.pathExists(checkpointsDir))) {
    throw new Error(`checkpoints directory not found: ${checkpointsDir}`);
  }
  const ckptFiles = (await fs.readdir(checkpointsDir))
    .filter(f => f.endsWith('.safetensors') || f.endsWith('.ckpt'));

  if (ckptFiles.length === 0) {
    throw new Error(`No .safetensors or .ckpt files found in ${checkpointsDir}`);
  }
  console.log(`Found ${ckptFiles.length} checkpoint(s):`);
  for (const f of ckptFiles) {
    const fullPath = path.join(checkpointsDir, f);
    const stat = await fs.stat(fullPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`  ${f} — ${sizeMB} MB`);
  }

  // ── loras: at least one .safetensors ────────────────────────────────────
  if (!(await fs.pathExists(lorasDir))) {
    throw new Error(`loras directory not found: ${lorasDir}`);
  }
  const loraFiles = (await fs.readdir(lorasDir))
    .filter(f => f.endsWith('.safetensors'));

  if (loraFiles.length === 0) {
    throw new Error(`No .safetensors files found in ${lorasDir}`);
  }
  console.log(`Found ${loraFiles.length} LoRA(s): ${loraFiles.join(', ')}`);

  // ── ip-adapter model (warn if missing, don't fail) ───────────────────────
  const ipadapterModel = path.join(ipadapterDir, 'ip-adapter_sdxl_vit-h.safetensors');
  if (await fs.pathExists(ipadapterModel)) {
    const stat = await fs.stat(ipadapterModel);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`ip-adapter_sdxl_vit-h.safetensors found — ${sizeMB} MB`);
  } else {
    console.log(`WARNING: ip-adapter_sdxl_vit-h.safetensors not found at ${ipadapterModel}`);
    console.log('  → IP-Adapter sprite workflow will not be available');
  }

  // ── CLIP vision model (warn if missing) ──────────────────────────────────
  const clipModel = path.join(clipVisionDir, 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors');
  if (await fs.pathExists(clipModel)) {
    const stat = await fs.stat(clipModel);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`CLIP-ViT-H-14 found — ${sizeMB} MB`);
  } else {
    console.log(`WARNING: CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors not found at ${clipModel}`);
    console.log('  → IP-Adapter sprite workflow will not be available');
  }

  // ── ComfyUI_IPAdapter_plus custom node (warn if missing) ─────────────────
  const ipadapterInit = path.join(customNodesDir, 'ComfyUI_IPAdapter_plus', '__init__.py');
  if (await fs.pathExists(ipadapterInit)) {
    console.log('ComfyUI_IPAdapter_plus custom node found');
  } else {
    console.log(`WARNING: ComfyUI_IPAdapter_plus not found at ${ipadapterInit}`);
    console.log('  → IP-Adapter sprite workflow will not be available');
  }
}
