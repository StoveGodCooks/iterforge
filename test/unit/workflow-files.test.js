/**
 * Unit tests for all ComfyUI workflow JSON files in comfyui-workflows/
 */
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, '../../comfyui-workflows');

// Tokens that every text-to-image workflow must contain
const BASE_TOKENS = [
  '__CKPT_NAME__',
  '__PROMPT_POSITIVE__',
  '__PROMPT_NEGATIVE__',
  '__SEED__',
  '__STEPS__',
  '__CFG__',
  '__WIDTH__',
  '__HEIGHT__',
];

function countDoubleUnderscores(str) {
  // Find all __SOMETHING__ tokens — each must be a matched pair (exactly 2 __)
  const tokens = str.match(/__[A-Z0-9_]+__/g) ?? [];
  for (const token of tokens) {
    // Each token must start and end with exactly __  (no triple underscores)
    if (!token.startsWith('__') || !token.endsWith('__')) return false;
    // Must have non-empty content between the underscores
    const inner = token.slice(2, -2);
    if (inner.length === 0) return false;
  }
  return true;
}

function hasSaveImageNode(parsed) {
  return Object.values(parsed).some(
    node => node?.class_type === 'SaveImage'
  );
}

export default async function test() {
  if (!(await fs.pathExists(WORKFLOWS_DIR))) {
    throw new Error(`comfyui-workflows/ directory not found at ${WORKFLOWS_DIR}`);
  }

  const files = (await fs.readdir(WORKFLOWS_DIR)).filter(f => f.endsWith('.json'));
  if (files.length === 0) throw new Error('No .json files found in comfyui-workflows/');
  console.log(`Found ${files.length} workflow files: ${files.join(', ')}`);

  // ── Each file is valid JSON ──────────────────────────────────────────────
  const parsed = {};
  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const raw = await fs.readFile(filePath, 'utf-8');
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${e.message}`);
    }
    parsed[file] = { obj, raw };
    console.log(`  ${file} — valid JSON (${raw.length} bytes)`);
  }

  // ── txt2img-sdxl.json required tokens ────────────────────────────────────
  const txt2imgFile = 'txt2img-sdxl.json';
  if (!parsed[txt2imgFile]) throw new Error(`${txt2imgFile} not found`);
  const txt2imgRaw = parsed[txt2imgFile].raw;
  for (const token of BASE_TOKENS) {
    if (!txt2imgRaw.includes(token)) {
      throw new Error(`${txt2imgFile} missing required token: ${token}`);
    }
  }
  console.log(`${txt2imgFile} contains all required base tokens`);

  // ── img2img-sdxl.json required tokens ────────────────────────────────────
  // img2img uses the reference image's own dimensions, so __WIDTH__/__HEIGHT__
  // are not present — it shares the remaining base tokens with txt2img.
  const img2imgFile = 'img2img-sdxl.json';
  if (!parsed[img2imgFile]) throw new Error(`${img2imgFile} not found`);
  const img2imgRaw = parsed[img2imgFile].raw;
  const img2imgTokens = BASE_TOKENS.filter(t => t !== '__WIDTH__' && t !== '__HEIGHT__');
  for (const token of img2imgTokens) {
    if (!img2imgRaw.includes(token)) {
      throw new Error(`${img2imgFile} missing required token: ${token}`);
    }
  }
  if (!img2imgRaw.includes('__REFERENCE_IMAGE__')) {
    throw new Error(`${img2imgFile} missing required token: __REFERENCE_IMAGE__`);
  }
  if (!img2imgRaw.includes('__STRENGTH__')) {
    throw new Error(`${img2imgFile} missing required token: __STRENGTH__`);
  }
  console.log(`${img2imgFile} contains all required tokens including __REFERENCE_IMAGE__ and __STRENGTH__`);

  // ── sprite-ipadapter-sdxl.json required tokens ───────────────────────────
  const spriteFile = 'sprite-ipadapter-sdxl.json';
  if (!parsed[spriteFile]) throw new Error(`${spriteFile} not found`);
  const spriteRaw = parsed[spriteFile].raw;
  if (!spriteRaw.includes('__IPADAPTER_WEIGHT__')) {
    throw new Error(`${spriteFile} missing required token: __IPADAPTER_WEIGHT__`);
  }
  if (!spriteRaw.includes('__REFERENCE_IMAGE__')) {
    throw new Error(`${spriteFile} missing required token: __REFERENCE_IMAGE__`);
  }
  console.log(`${spriteFile} contains __IPADAPTER_WEIGHT__ and __REFERENCE_IMAGE__`);

  // ── No unmatched double underscores ──────────────────────────────────────
  for (const file of files) {
    const raw = parsed[file].raw;
    if (!countDoubleUnderscores(raw)) {
      throw new Error(`${file} contains malformed __TOKEN__ (unmatched or empty)`);
    }
  }
  console.log('All workflow files have well-formed __TOKEN__ placeholders');

  // ── Each file has a SaveImage node ────────────────────────────────────────
  for (const file of files) {
    const obj = parsed[file].obj;
    if (!hasSaveImageNode(obj)) {
      throw new Error(`${file} has no SaveImage node`);
    }
  }
  console.log('All workflow files contain a SaveImage node');
}
