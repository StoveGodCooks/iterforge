import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { ITERFORGE_HOME } from '../env/reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.join(__dirname, '..', '..', 'comfyui-workflows');
const CHECKPOINTS_DIR = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'checkpoints');

const BASE_URL = 'http://127.0.0.1:8188';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 300_000; // 5 min max

// ── helpers ──────────────────────────────────────────────────────────────────

function injectTokens(workflow, tokens) {
  let json = JSON.stringify(workflow);
  for (const [key, value] of Object.entries(tokens)) {
    const quotedPattern = new RegExp(`"${key}"`, 'g');
    const plainPattern  = new RegExp(key, 'g');
    if (typeof value === 'number') {
      json = json.replace(quotedPattern, String(value));
    } else {
      json = json.replace(plainPattern, String(value));
    }
  }
  return JSON.parse(json);
}

async function get(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  if (!res.ok) throw new Error(`ComfyUI ${endpoint} → ${res.status}`);
  return res.json();
}

async function post(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`ComfyUI ${endpoint} → ${res.status}`);
  return res.json();
}

/** Detect the first installed checkpoint file (.safetensors or .ckpt). */
async function detectCheckpoint() {
  try {
    const files = await fs.readdir(CHECKPOINTS_DIR);
    const model = files.find(f => f.endsWith('.safetensors') || f.endsWith('.ckpt'));
    if (model) return model;
  } catch { /* dir may not exist yet */ }
  throw new Error(
    '[ERR_MODEL_NOT_FOUND] No model found in checkpoints folder.\n' +
    `Fix: place a .safetensors model in ${CHECKPOINTS_DIR}`
  );
}

/**
 * Upload a local image file to ComfyUI's input folder.
 * Returns the filename ComfyUI assigned to it.
 */
async function uploadImage(localPath) {
  if (!(await fs.pathExists(localPath))) {
    throw new Error(`[ERR_FILE_NOT_FOUND] Reference image not found: ${localPath}`);
  }
  const filename = path.basename(localPath);
  const buffer = await fs.readFile(localPath);
  const blob = new Blob([buffer], { type: 'image/png' });

  const formData = new FormData();
  formData.append('image', blob, filename);
  formData.append('overwrite', 'true');

  const res = await fetch(`${BASE_URL}/upload/image`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload reference image: ${res.status}`);
  const data = await res.json();
  return data.name; // ComfyUI returns { name, subfolder, type }
}

/** Poll until the prompt completes and return the output image. */
async function pollAndSave(promptId, outputDir) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const history = await get(`/history/${promptId}`);
    const entry = history[promptId];
    if (!entry) continue;

    if (entry.status?.completed) {
      const outputs = entry.outputs ?? {};
      for (const node of Object.values(outputs)) {
        for (const img of (node.images ?? [])) {
          const url = `${BASE_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=output`;
          const imgRes = await fetch(url);
          if (!imgRes.ok) throw new Error(`Failed to fetch output image: ${imgRes.status}`);
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          await fs.ensureDir(outputDir);
          const imagePath = path.join(outputDir, img.filename);
          await fs.writeFile(imagePath, buffer);
          return imagePath;
        }
      }
      throw new Error('[ERR_NO_OUTPUT] ComfyUI completed but returned no images.');
    }

    if (entry.status?.status_str === 'error') {
      throw new Error(`[ERR_COMFYUI_GENERATION] ComfyUI reported an error for prompt ${promptId}.`);
    }
  }
  throw new Error('[ERR_COMFYUI_TIMEOUT] Generation timed out after 5 minutes.');
}

// ── public API ────────────────────────────────────────────────────────────────

export async function healthCheck() {
  try {
    await get('/system_stats');
    return { ok: true };
  } catch {
    return { ok: false, code: 'ERR_COMFYUI_NOT_RUNNING', fix: 'iterforge start comfyui' };
  }
}

/** Verify at least one model checkpoint is installed. */
export async function verifyModel() {
  await detectCheckpoint(); // throws if none found
  return true;
}

/**
 * Generate an image via ComfyUI.
 *
 * @param {object} opts
 * @param {string}  opts.type          - workflow type ('arena'|'card'|'custom')
 * @param {string}  opts.positive      - positive prompt
 * @param {string}  opts.negative      - negative prompt
 * @param {number}  opts.steps         - inference steps (default 30)
 * @param {number}  opts.cfg           - CFG scale (default 7.0)
 * @param {number}  opts.seed          - seed (default random)
 * @param {number}  opts.width         - output width (default 1024)
 * @param {number}  opts.height        - output height (default 1024)
 * @param {string}  opts.outputDir     - where to save the PNG
 * @param {string}  [opts.model]       - checkpoint filename (auto-detected if omitted)
 * @param {string}  [opts.referencePath] - local path to reference image (enables img2img)
 * @param {number}  [opts.strength]    - img2img denoise strength 0-1 (default 0.75)
 * @param {string}  [opts.sampler]     - sampler override
 * @returns {{ imagePath: string, seed: number, backend: string }}
 */
export async function generate(opts) {
  const {
    type = 'custom',
    positive,
    negative,
    steps = 30,
    cfg = 7.0,
    seed = Math.floor(Math.random() * 2 ** 32),
    width = 1024,
    height = 1024,
    outputDir,
    model = null,
    referencePath = null,
    strength = 0.75,
    sampler = null,
  } = opts;

  // Resolve checkpoint
  const ckptName = model ?? await detectCheckpoint();

  // Determine workflow file
  let workflowFile;
  if (referencePath) {
    workflowFile = path.join(WORKFLOWS_DIR, 'img2img-sdxl.json');
  } else {
    const typeWorkflow    = path.join(WORKFLOWS_DIR, `${type}-txt2img-sdxl.json`);
    const genericWorkflow = path.join(WORKFLOWS_DIR, 'txt2img-sdxl.json');
    workflowFile = (await fs.pathExists(typeWorkflow)) ? typeWorkflow : genericWorkflow;
  }

  if (!(await fs.pathExists(workflowFile))) {
    throw new Error(`[ERR_WORKFLOW_NOT_FOUND] Workflow not found: ${workflowFile}`);
  }
  const template = await fs.readJson(workflowFile);

  // Build token map
  const tokens = {
    __CKPT_NAME__:       ckptName,
    __PROMPT_POSITIVE__: positive,
    __PROMPT_NEGATIVE__: negative,
    __STEPS__:  steps,
    __CFG__:    cfg,
    __SEED__:   seed,
    __WIDTH__:  width,
    __HEIGHT__: height,
  };

  if (referencePath) {
    const refFilename = await uploadImage(referencePath);
    tokens.__REFERENCE_IMAGE__ = refFilename;
    tokens.__STRENGTH__ = strength;
  }

  // Apply sampler override if provided
  let workflow = injectTokens(template, tokens);
  if (sampler) {
    const json = JSON.stringify(workflow);
    workflow = JSON.parse(json.replace(/"sampler_name":"[^"]+"/g, `"sampler_name":"${sampler}"`));
  }

  // Submit
  const { prompt_id: promptId } = await post('/prompt', { prompt: workflow });

  // Poll and save
  const imagePath = await pollAndSave(promptId, outputDir);
  return { imagePath, seed, backend: 'comfyui' };
}
