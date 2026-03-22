import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { ITERFORGE_HOME } from '../env/reader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR    = path.join(__dirname, '..', '..', 'comfyui-workflows');
const CHECKPOINTS_DIR  = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'checkpoints');
const IPADAPTER_DIR    = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'ipadapter');
const CLIP_VISION_DIR  = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'clip_vision');
const CONTROLNET_DIR   = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'controlnet');
const UPSCALE_DIR      = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'upscale_models');
const IPADAPTER_MODEL  = 'ip-adapter_sdxl_vit-h.safetensors';
const CLIP_VISION_MODEL = 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors';
const CUSTOM_NODES_DIR = path.join(ITERFORGE_HOME, 'comfyui', 'custom_nodes');

// ControlNet model filenames (installed by setup)
const CONTROLNET_MODELS = {
  openpose: 'controlnet-openpose-sdxl.safetensors',
  canny:    'controlnet-canny-sdxl.safetensors',
  depth:    'controlnet-depth-sdxl.safetensors',
};

// Default strength per ControlNet type
const CONTROLNET_DEFAULTS = {
  openpose: 0.85,  // strong — need exact pose
  canny:    0.70,  // medium — shape lock with style variation
  depth:    0.65,  // softer — 3D structure guidance only
};

// Upscale model filename
const UPSCALE_MODEL = 'RealESRGAN_x4.pth';

/**
 * Check whether all IP-Adapter dependencies are installed.
 * Returns true only if the custom node + both model files exist.
 */
export async function isIPAdapterAvailable() {
  const [nodeOk, modelOk, clipOk] = await Promise.all([
    fs.pathExists(path.join(CUSTOM_NODES_DIR, 'ComfyUI_IPAdapter_plus', '__init__.py')),
    fs.pathExists(path.join(IPADAPTER_DIR, IPADAPTER_MODEL)),
    fs.pathExists(path.join(CLIP_VISION_DIR, CLIP_VISION_MODEL)),
  ]);
  return nodeOk && modelOk && clipOk;
}

/**
 * Check whether a specific ControlNet type is ready (node + model file exist).
 * @param {'openpose'|'canny'|'depth'} type
 */
export async function isControlNetAvailable(type) {
  const modelFile = CONTROLNET_MODELS[type];
  if (!modelFile) return false;
  const [nodeOk, modelOk] = await Promise.all([
    fs.pathExists(path.join(CUSTOM_NODES_DIR, 'comfyui_controlnet_aux', '__init__.py')),
    fs.pathExists(path.join(CONTROLNET_DIR, modelFile)),
  ]);
  return nodeOk && modelOk;
}

/** Check which ControlNet types are ready. Returns { openpose, canny, depth } booleans. */
export async function getControlNetStatus() {
  const [openpose, canny, depth] = await Promise.all([
    isControlNetAvailable('openpose'),
    isControlNetAvailable('canny'),
    isControlNetAvailable('depth'),
  ]);
  return { openpose, canny, depth };
}

/** Check whether the upscaler is ready (node + model file). */
export async function isUpscalerAvailable() {
  const [nodeOk, modelOk] = await Promise.all([
    fs.pathExists(path.join(CUSTOM_NODES_DIR, 'ComfyUI_UltimateSDUpscale', '__init__.py')),
    fs.pathExists(path.join(UPSCALE_DIR, UPSCALE_MODEL)),
  ]);
  return nodeOk && modelOk;
}

// Read URL dynamically from env.json each call — supports runtime cloud/local toggle
const ENV_JSON_PATH = path.join(ITERFORGE_HOME, 'env.json');
function getBaseUrl() {
  try {
    return JSON.parse(fs.readFileSync(ENV_JSON_PATH, 'utf8'))?.tools?.comfyui?.url ?? 'http://127.0.0.1:8188';
  } catch { return 'http://127.0.0.1:8188'; }
}
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
      // JSON-encode the string so embedded quotes, newlines, and control chars
      // don't break the surrounding JSON structure when injected.
      const escaped = JSON.stringify(String(value)).slice(1, -1);
      json = json.replace(plainPattern, escaped);
    }
  }
  return JSON.parse(json);
}

async function get(endpoint) {
  const res = await fetch(`${getBaseUrl()}${endpoint}`);
  if (!res.ok) throw new Error(`ComfyUI ${endpoint} → ${res.status}`);
  return res.json();
}

async function post(endpoint, body) {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ComfyUI ${endpoint} → ${res.status}: ${detail}`);
  }
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
 * Detect whether a model is a distilled Lightning/Turbo/LCM model.
 * These models require low steps (4-10) and low CFG (1.5-2.5).
 * Standard SDXL models (Juggernaut, RealVis, etc.) need 20-30 steps and CFG 4-7.
 */
export function isLightningModel(modelName) {
  const n = (modelName ?? '').toLowerCase();
  return n.includes('lightning') || n.includes('turbo') || n.includes('_lcm') || n.includes('flash') || n.includes('hyper');
}

/**
 * Return sane generation defaults for a given checkpoint.
 * Callers can override any value — these are applied only when the caller
 * passes the original user value (steps/cfg) from the UI.
 */
export function modelDefaults(modelName) {
  if (isLightningModel(modelName)) {
    return { steps: 8, cfg: 2.0, sampler: 'euler', scheduler: 'sgm_uniform' };
  }
  // Standard full-quality SDXL (Juggernaut XL, RealVisXL, etc.)
  return { steps: 25, cfg: 5.5, sampler: 'dpmpp_2m_sde', scheduler: 'karras' };
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

  const res = await fetch(`${getBaseUrl()}/upload/image`, {
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
          const url = `${getBaseUrl()}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=output`;
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
 * @param {string}  [opts.referencePath]      - local path to reference image (enables img2img)
 * @param {number}  [opts.strength]           - img2img denoise strength 0-1 (default 0.75)
 * @param {string}  [opts.sampler]            - sampler override
 * @param {string}  [opts.controlnetType]     - 'openpose'|'canny'|'depth' (enables ControlNet)
 * @param {string}  [opts.controlnetImage]    - local path to ControlNet guide image
 * @param {number}  [opts.controlnetStrength] - ControlNet influence 0-1 (uses type default)
 * @param {number}  [opts.upscaleFactor]      - run upscale pass after generation (2 or 4)
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
    loraName: explicitLora = null,
    referencePath = null,
    strength = 0.75,
    sampler = null,
    controlnetType = null,
    controlnetImage = null,
    controlnetStrength = null,
  } = opts;

  // Resolve checkpoint and detect model type
  const ckptName = model ?? await detectCheckpoint();
  const mDefaults = modelDefaults(ckptName);

  // Auto-clamp steps and CFG to sane ranges for the detected model type.
  // For Lightning: cap at 10 steps / 2.5 CFG even if the preset asked for more.
  // For standard SDXL: use the preset/user value as-is (already validated upstream).
  const effectiveSteps = isLightningModel(ckptName)
    ? Math.min(steps, 10)
    : steps;
  const effectiveCfg = isLightningModel(ckptName)
    ? Math.min(cfg, 2.5)
    : cfg;
  const effectiveSampler  = sampler  || mDefaults.sampler;
  const effectiveScheduler = mDefaults.scheduler;

  // Determine workflow file
  // Priority: ControlNet → IP-Adapter sprite → img2img → txt2img
  let workflowFile;
  let useIPAdapter = false;
  let useControlNet = false;

  if (controlnetType && controlnetImage) {
    // ControlNet requested — check if models are installed
    const cnReady = await isControlNetAvailable(controlnetType);
    if (cnReady) {
      workflowFile = path.join(WORKFLOWS_DIR, `txt2img-${controlnetType}-sdxl.json`);
      useControlNet = true;
      console.log(`[ComfyUI] Using ControlNet workflow: ${controlnetType}`);
    } else {
      console.warn(`[ComfyUI] ControlNet ${controlnetType} not ready — falling back to txt2img`);
      workflowFile = path.join(WORKFLOWS_DIR, 'txt2img-sdxl.json');
    }
  } else if (referencePath && type === 'sprite') {
    // Sprite frames with a reference: prefer IP-Adapter for character identity lock
    const ipAdapterReady = await isIPAdapterAvailable();
    if (ipAdapterReady) {
      workflowFile = path.join(WORKFLOWS_DIR, 'sprite-ipadapter-sdxl.json');
      useIPAdapter = true;
      console.log('[ComfyUI] Using IP-Adapter workflow for sprite frame');
    } else {
      workflowFile = path.join(WORKFLOWS_DIR, 'img2img-sdxl.json');
      console.log('[ComfyUI] IP-Adapter not ready yet — falling back to img2img');
    }
  } else if (referencePath) {
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

  // Resolve LoRA: prefer explicitly passed name (from preset), fall back to first available
  const loraDir = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'loras');
  let loraName = null;
  try {
    const loraFiles = await fs.readdir(loraDir);
    const available = loraFiles.filter(f => {
      const n = f.toLowerCase();
      return (n.endsWith('.safetensors') || n.endsWith('.pt')) && !n.includes('put_');
    });
    if (explicitLora && available.includes(explicitLora)) {
      loraName = explicitLora;                  // preset-specified LoRA found
    } else if (explicitLora) {
      console.warn(`[ComfyUI] Preset LoRA "${explicitLora}" not found in loras folder — skipping`);
    } else {
      loraName = available[0] ?? null;          // fallback: first available
    }
  } catch { /* lora dir missing — skip */ }

  // Build token map — use effective (model-aware) steps/cfg/sampler
  const tokens = {
    __CKPT_NAME__:       ckptName,
    __PROMPT_POSITIVE__: positive,
    __PROMPT_NEGATIVE__: negative,
    __STEPS__:  effectiveSteps,
    __CFG__:    effectiveCfg,
    __SEED__:   seed,
    __WIDTH__:  width,
    __HEIGHT__: height,
    __LORA_NAME__:       loraName ?? 'none',
    __LORA_STRENGTH__:   loraName ? 0.75 : 0.0,
    __IPADAPTER_WEIGHT__: 0.55,  // 0.55 = strong identity lock while allowing pose variation
    __UPSCALE_MODEL__:   UPSCALE_MODEL,
    __UPSCALE_FACTOR__:  2,
  };

  if (referencePath) {
    const refFilename = await uploadImage(referencePath);
    tokens.__REFERENCE_IMAGE__ = refFilename;
    tokens.__STRENGTH__ = strength;
  }

  if (useControlNet && controlnetImage) {
    const cnFilename = await uploadImage(controlnetImage);
    tokens.__CONTROLNET_IMAGE__    = cnFilename;
    tokens.__CONTROLNET_MODEL__    = CONTROLNET_MODELS[controlnetType];
    tokens.__CONTROLNET_STRENGTH__ = controlnetStrength ?? CONTROLNET_DEFAULTS[controlnetType] ?? 0.75;
  }

  // Apply sampler override if provided
  let workflow = injectTokens(template, tokens);

  // If no LoRA is available, bypass node 8 — rewire nodes 2, 3, 5 directly to checkpoint (node 1)
  if (!loraName) {
    const wf = workflow;
    if (wf['8']) delete wf['8'];
    if (wf['2']?.inputs?.clip?.[0] === '8') wf['2'].inputs.clip  = ['1', 1];
    if (wf['3']?.inputs?.clip?.[0] === '8') wf['3'].inputs.clip  = ['1', 1];
    if (wf['5']?.inputs?.model?.[0] === '8') wf['5'].inputs.model = ['1', 0];
    workflow = wf;
  }

  // Apply effective sampler and scheduler (model-aware)
  {
    let json = JSON.stringify(workflow);
    json = json.replace(/"sampler_name":"[^"]+"/g,  `"sampler_name":"${effectiveSampler}"`);
    json = json.replace(/"scheduler":"[^"]+"/g,      `"scheduler":"${effectiveScheduler}"`);
    workflow = JSON.parse(json);
  }

  // Submit
  const { prompt_id: promptId } = await post('/prompt', { prompt: workflow });

  // Poll and save
  const imagePath = await pollAndSave(promptId, outputDir);
  return { imagePath, seed, backend: 'comfyui' };
}
