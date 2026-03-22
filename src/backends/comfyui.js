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

/**
 * Recursively inject tokens into a workflow object.
 * Safe replacement that doesn't corrupt JSON structure.
 */
function injectTokens(obj, tokens) {
  if (typeof obj === 'string') {
    let result = obj;
    for (const [key, value] of Object.entries(tokens)) {
      if (result.includes(key)) {
        // If the entire string is just the token, we can use the original type (e.g. number)
        if (result === key) return value;
        // Otherwise, it's a partial replacement in a larger string
        result = result.replace(new RegExp(key, 'g'), String(value));
      }
    }
    return result;
  } else if (Array.isArray(obj)) {
    return obj.map(item => injectTokens(item, tokens));
  } else if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = injectTokens(obj[key], tokens);
    }
    return newObj;
  }
  return obj;
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
 */
export function isLightningModel(modelName) {
  const n = (modelName ?? '').toLowerCase();
  return n.includes('lightning') || n.includes('turbo') || n.includes('_lcm') || n.includes('flash') || n.includes('hyper');
}

/**
 * Return sane generation defaults for a given checkpoint.
 */
export function modelDefaults(modelName) {
  if (isLightningModel(modelName)) {
    return { steps: 8, cfg: 2.0, sampler: 'euler', scheduler: 'sgm_uniform' };
  }
  return { steps: 25, cfg: 5.5, sampler: 'dpmpp_2m_sde', scheduler: 'karras' };
}

/**
 * Upload a local image file to ComfyUI's input folder.
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
  return data.name;
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

export async function verifyModel() {
  await detectCheckpoint();
  return true;
}

/**
 * Generate an image via ComfyUI.
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
    ipadapterWeight = null,
  } = opts;

  const ckptName = model ?? await detectCheckpoint();
  const mDefaults = modelDefaults(ckptName);

  const effectiveSteps = isLightningModel(ckptName) ? Math.min(steps, 10) : steps;
  const effectiveCfg   = isLightningModel(ckptName) ? Math.min(cfg, 2.5) : cfg;
  const effectiveSampler  = sampler  || mDefaults.sampler;
  const effectiveScheduler = mDefaults.scheduler;

  let workflowFile;
  let useIPAdapter = false;
  let useControlNet = false;

  if (type === 'smelt') {
    workflowFile = path.join(WORKFLOWS_DIR, 'smelt-multiview-sdxl.json');
  } else if (controlnetType && controlnetImage) {
    const cnReady = await isControlNetAvailable(controlnetType);
    if (cnReady) {
      workflowFile = path.join(WORKFLOWS_DIR, `txt2img-${controlnetType}-sdxl.json`);
      useControlNet = true;
    } else {
      workflowFile = path.join(WORKFLOWS_DIR, 'txt2img-sdxl.json');
    }
  } else if (referencePath && type === 'sprite') {
    const ipAdapterReady = await isIPAdapterAvailable();
    if (ipAdapterReady) {
      workflowFile = path.join(WORKFLOWS_DIR, 'sprite-ipadapter-sdxl.json');
      useIPAdapter = true;
    } else {
      workflowFile = path.join(WORKFLOWS_DIR, 'img2img-sdxl.json');
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

  const loraDir = path.join(ITERFORGE_HOME, 'comfyui', 'models', 'loras');
  let loraName = null;
  try {
    const loraFiles = await fs.readdir(loraDir);
    const available = loraFiles.filter(f => {
      const n = f.toLowerCase();
      return (n.endsWith('.safetensors') || n.endsWith('.pt')) && !n.includes('put_');
    });
    if (explicitLora && available.includes(explicitLora)) loraName = explicitLora;
    // No auto-fallback — only use a LoRA when explicitly requested by the preset.
    // Auto-selecting available[0] was causing random LoRAs (e.g. HearthstoneCard)
    // to fire on asset types that don't request any LoRA.
  } catch { /* skip */ }

  const tokens = {
    __CKPT_NAME__:       ckptName,
    __PROMPT_POSITIVE__: positive,
    __PROMPT_NEGATIVE__: negative,
    __STEPS__:           effectiveSteps,
    __CFG__:             effectiveCfg,
    __SEED__:            seed,
    __WIDTH__:           width,
    __HEIGHT__:          height,
    __LORA_NAME__:       loraName ?? 'none',
    __LORA_STRENGTH__:   loraName ? 0.75 : 0.0,
    __IPADAPTER_WEIGHT__: ipadapterWeight ?? 0.55,
    __UPSCALE_MODEL__:   UPSCALE_MODEL,
    __UPSCALE_FACTOR__:  2,
  };

  if (referencePath) {
    tokens.__REFERENCE_IMAGE__ = await uploadImage(referencePath);
    tokens.__STRENGTH__ = strength;
  }

  if (useControlNet && controlnetImage) {
    tokens.__CONTROLNET_IMAGE__    = await uploadImage(controlnetImage);
    tokens.__CONTROLNET_MODEL__    = CONTROLNET_MODELS[controlnetType];
    tokens.__CONTROLNET_STRENGTH__ = controlnetStrength ?? CONTROLNET_DEFAULTS[controlnetType] ?? 0.75;
  }

  // 1. Inject tokens safely
  let workflow = injectTokens(template, tokens);

  // 2. Bypass LoRA node if none available (standardize on node 8)
  if (!loraName) {
    const nodesToRewire = Object.values(workflow);
    for (const node of nodesToRewire) {
      if (!node.inputs) continue;
      for (const key in node.inputs) {
        const link = node.inputs[key];
        if (Array.isArray(link) && link[0] === '8') {
          // Rewire to CheckpointLoader (Node 1)
          node.inputs[key] = ['1', link[1]]; 
        }
      }
    }
    delete workflow['8'];
  }

  // 3. Set sampler/scheduler (some samplers are nested in nodes)
  const setNested = (obj) => {
    if (obj !== null && typeof obj === 'object') {
      if (obj.sampler_name !== undefined) obj.sampler_name = effectiveSampler;
      if (obj.scheduler !== undefined) obj.scheduler = effectiveScheduler;
      for (const k in obj) setNested(obj[k]);
    }
  };
  setNested(workflow);

  const { prompt_id: promptId } = await post('/prompt', { prompt: workflow });
  const imagePath = await pollAndSave(promptId, outputDir);
  return { imagePath, seed, backend: 'comfyui' };
}
