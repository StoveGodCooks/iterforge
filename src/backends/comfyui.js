import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.join(__dirname, '..', '..', 'comfyui-workflows');

const BASE_URL = 'http://127.0.0.1:8188';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 300_000; // 5 min max

let _modelVerified = false; // session-scoped cache

// ── helpers ──────────────────────────────────────────────────────────────────

function injectTokens(workflow, tokens) {
  let json = JSON.stringify(workflow);
  for (const [key, value] of Object.entries(tokens)) {
    // Numeric tokens must replace the quoted string form "\"__TOKEN__\"" → raw number
    const quotedPattern = new RegExp(`"${key}"`, 'g');
    const plainPattern  = new RegExp(key, 'g');
    if (typeof value === 'number') {
      json = json.replace(quotedPattern, String(value));
    } else {
      json = json.replace(plainPattern, value);
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

// ── public API ────────────────────────────────────────────────────────────────

export async function healthCheck() {
  try {
    await get('/system_stats');
    return { ok: true };
  } catch {
    return { ok: false, code: 'ERR_COMFYUI_NOT_RUNNING', fix: 'iterforge start comfyui' };
  }
}

/** Verify SDXL model is loaded — call once per session before first generate. */
export async function verifyModel() {
  if (_modelVerified) return true;
  const info = await get('/object_info');
  const loaderNode = Object.values(info).find(n => n.input?.required?.ckpt_name);
  if (!loaderNode) return false;
  const [models] = loaderNode.input.required.ckpt_name;
  const hasSDXL = Array.isArray(models) && models.some(m =>
    m.toLowerCase().includes('xl') || m.toLowerCase().includes('sdxl')
  );
  if (!hasSDXL) {
    throw new Error(
      '[ERR_MODEL_NOT_FOUND] No SDXL model found in ComfyUI.\n' +
      'Fix: iterforge install --model now   (downloads sd_xl_base_1.0.safetensors)'
    );
  }
  _modelVerified = true;
  return true;
}

/**
 * Generate an image via ComfyUI.
 * @param {object} opts
 * @param {string} opts.type        - 'arena' | 'card'
 * @param {string} opts.positive    - positive prompt
 * @param {string} opts.negative    - negative prompt
 * @param {number} opts.steps       - default 30
 * @param {number} opts.cfg         - default 7.0
 * @param {number} opts.seed        - default random
 * @param {number} opts.width       - default 1024
 * @param {number} opts.height      - default 1024
 * @param {string} opts.outputDir   - where to save the PNG
 * @returns {{ imagePath: string, seed: number, backend: string }}
 */
export async function generate(opts) {
  const {
    type = 'arena',
    positive,
    negative,
    steps = 30,
    cfg = 7.0,
    seed = Math.floor(Math.random() * 2 ** 32),
    width = 1024,
    height = 1024,
    outputDir
  } = opts;

  // Load workflow template
  const workflowFile = path.join(WORKFLOWS_DIR, `${type}-txt2img-sdxl.json`);
  if (!(await fs.pathExists(workflowFile))) {
    throw new Error(`[ERR_WORKFLOW_NOT_FOUND] No workflow for type "${type}". Expected: ${workflowFile}`);
  }
  const template = await fs.readJson(workflowFile);

  // Inject tokens
  const workflow = injectTokens(template, {
    __PROMPT_POSITIVE__: positive,
    __PROMPT_NEGATIVE__:  negative,
    __STEPS__:  steps,
    __CFG__:    cfg,
    __SEED__:   seed,
    __WIDTH__:  width,
    __HEIGHT__: height
  });

  // Submit
  const { prompt_id: promptId } = await post('/prompt', { prompt: workflow });

  // Poll until done
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const history = await get(`/history/${promptId}`);
    const entry = history[promptId];
    if (!entry) continue;

    if (entry.status?.completed) {
      // Find the output image
      const outputs = entry.outputs ?? {};
      for (const node of Object.values(outputs)) {
        for (const img of (node.images ?? [])) {
          // Fetch binary
          const url = `${BASE_URL}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=output`;
          const imgRes = await fetch(url);
          if (!imgRes.ok) throw new Error(`Failed to fetch output image: ${imgRes.status}`);
          const buffer = Buffer.from(await imgRes.arrayBuffer());

          await fs.ensureDir(outputDir);
          const imagePath = path.join(outputDir, img.filename);
          await fs.writeFile(imagePath, buffer);

          return { imagePath, seed, backend: 'comfyui' };
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
