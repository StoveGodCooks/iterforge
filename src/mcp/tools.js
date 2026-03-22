/**
 * tools.js — Shared MCP tool definitions for Inter-Forge.
 *
 * Used by both the SSE transport (src/server/routes/mcp.js) and the
 * stdio transport (src/mcp/server.js).  All tools call the Express
 * route-handler logic via node-fetch to localhost:3000 so there is a
 * single source of truth for every operation.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ITERFORGE_HOME } from '../env/reader.js';

const execFileAsync = promisify(execFile);

// Base URL — the Express server is always on 3000 when the MCP server is in use
const BASE_URL = 'http://127.0.0.1:3000';

// Asset types that automatically get a 3D mesh generated (mirrors GenerationPanel.jsx)
const MESH_ASSET_TYPES = new Set([]);  // disabled — user manually triggers 3D via generate_sword_mesh or apply_to_mesh

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiGet(path_) {
  const res = await fetch(`${BASE_URL}${path_}`);
  return res.json();
}

async function apiPost(path_, body) {
  const res = await fetch(`${BASE_URL}${path_}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(msg) {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: msg }, null, 2) }],
  };
}

// Poll an endpoint every intervalMs until status is 'completed' or 'failed'
async function pollUntilDone(endpoint, intervalMs = 2000, maxMs = 360_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    const data = await apiGet(endpoint);
    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw new Error(data.error ?? 'Job failed');
  }
  throw new Error('Timeout waiting for job to complete');
}

// ── Tool definitions (JSON Schema for input) ─────────────────────────────────

const TOOLS = [
  {
    name: 'get_status',
    description: 'Check the status of all Inter-Forge backends (ComfyUI, Blender).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_asset',
    description: 'Generate a game asset. For 3D-capable types (weapon, prop, item, character, creature, building, vehicle) this automatically produces a fully textured 3D mesh (GLB) — no extra steps needed. For other types it returns the 2D image. Blocks until the full pipeline is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:        { type: 'string', description: 'Custom positive prompt (required for custom mode)' },
        mode:          { type: 'string', enum: ['custom', 'preset'], description: 'Generation mode (default: custom)' },
        assetType:     { type: 'string', description: 'Asset type e.g. character, environment, prop, creature, icon' },
        artStyle:      { type: 'string', description: 'Art style e.g. stylized, pixel, anime, cartoon, realistic' },
        subject:       { type: 'string', description: 'Subject description for preset mode' },
        genre:         { type: 'string', description: 'Game genre hint e.g. fantasy, scifi, horror' },
        model:         { type: 'string', description: 'Model override (null = use default)' },
        seed:          { anyOf: [{ type: 'number' }, { type: 'string' }], description: 'Seed (-1 = random)' },
        steps:         { anyOf: [{ type: 'number' }, { type: 'string' }], description: 'Inference steps (default: 6)' },
        cfg:           { anyOf: [{ type: 'number' }, { type: 'string' }], description: 'CFG scale (default: 2)' },
        width:         { anyOf: [{ type: 'number' }, { type: 'string' }], description: 'Output width in pixels (default: 1024)' },
        height:        { anyOf: [{ type: 'number' }, { type: 'string' }], description: 'Output height in pixels (default: 1024)' },
        negative:      { type: 'string', description: 'Negative prompt' },
      },
    },
  },
  {
    name: 'generate_sprite_sheet',
    description: 'Generate an animated sprite sheet (multiple frames). Returns jobId and frameCount.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:     { type: 'string', description: 'Character description prompt' },
        frameCount: { type: 'number', description: 'Number of animation frames (default: 4)' },
        animType:   { type: 'string', description: 'Animation type e.g. walk, run, idle, attack' },
        artStyle:   { type: 'string', description: 'Art style' },
        frameWidth: { type: 'number', description: 'Width per frame in pixels (default: 128)' },
        frameHeight:{ type: 'number', description: 'Height per frame in pixels (default: 128)' },
        seed:       { type: 'number' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'apply_to_mesh',
    description: 'Apply a generated texture to a 3D mesh via Blender. Returns jobId.',
    inputSchema: {
      type: 'object',
      properties: {
        texturePath:      { type: 'string', description: 'Absolute path to texture PNG, or __API__:<filename> for generated assets' },
        meshType:         { type: 'string', description: 'Mesh preset: cube, sphere, cylinder, plane, torus (default: cube)' },
        exportFormat:     { type: 'string', description: 'Export format: glb (default)' },
        subdivisionLevel: { type: 'number', description: 'Subdivision level 0-3 (default: 1)' },
        textureRotation:  { type: 'number', description: 'Texture rotation in degrees (default: 0)' },
      },
      required: ['texturePath'],
    },
  },
  {
    name: 'poll_job',
    description: 'Poll the status of an async job. Returns { status, result?, error? }.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId:   { type: 'string', description: 'Job ID returned from generate_asset, generate_sprite_sheet, or apply_to_mesh' },
        jobType: { type: 'string', enum: ['generate', 'sprite-sheet', 'blender', 'triposr'], description: 'Which job queue to poll (default: generate)' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'get_history',
    description: 'Retrieve the generation history. Returns array of past generations.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max entries to return (default: all)' },
      },
    },
  },
  {
    name: 'blender_run_script',
    description: 'Run arbitrary Python code in headless Blender. Returns { success, stdout, stderr }.',
    inputSchema: {
      type: 'object',
      properties: {
        pythonCode: { type: 'string', description: 'Python code to execute in Blender' },
      },
      required: ['pythonCode'],
    },
  },
  {
    name: 'generate_sword_mesh',
    description: 'Professional sword 3D pipeline: reads texture proportions, builds accurate blade/guard/handle/pommel geometry, front-projects the 2D art as UV skin, applies PBR metallic material, renders preview, exports GLB. Use poll_job with jobType:"blender" to get the result.',
    inputSchema: {
      type: 'object',
      properties: {
        textureFilename: { type: 'string', description: 'Filename of a generated sword image (from generate_asset result.filename)' },
      },
      required: ['textureFilename'],
    },
  },
  {
    name: 'generate_3d_asset',
    description: 'Reconstruct a full 3D model (GLB) from a 2D generated image using TripoSR neural reconstruction. Requires ≥6 GB VRAM. Auto-downloads ~1 GB weights on first run (MIT licence, cached locally). Returns { jobId } — poll with poll_job(jobId, jobType:"triposr").',
    inputSchema: {
      type: 'object',
      properties: {
        imageFilename: { type: 'string', description: 'Filename of a previously generated image (from generate_asset result.filename)' },
        resolution:    { type: 'number', description: 'Marching cubes resolution — 128 (fast/draft), 256 (default), 384 (high quality)' },
      },
      required: ['imageFilename'],
    },
  },
  {
    name: 'export_to_engine',
    description: 'Package selected assets into a ZIP for a game engine. Returns { zipPath, downloadUrl, fileList }.',
    inputSchema: {
      type: 'object',
      properties: {
        assetIds:   { type: 'array', items: { type: 'string' }, description: 'History entry IDs to include' },
        engine:     { type: 'string', enum: ['godot', 'unity', 'unreal', 'pygame'], description: 'Target game engine' },
        outputName: { type: 'string', description: 'Base name for the ZIP file (default: iterforge-export)' },
      },
      required: ['assetIds', 'engine'],
    },
  },
  {
    name: 'read_project_context',
    description: 'Read the full Inter-Forge project state: generation history, active settings, backend status, tier, installed models, and recent outputs. Use this to understand what has been generated and what the current setup looks like.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'write_project_context',
    description: 'Patch Inter-Forge project settings using dot-notation keys (e.g. "active.faction", "settings.steps"). Writes changes to the project config on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'object',
          description: 'Key-value pairs using dot notation — e.g. { "active.faction": "ECLIPSE", "settings.steps": 20 }',
          additionalProperties: true,
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'get_generation_history',
    description: 'Retrieve the most recent generation history entries from Inter-Forge.',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'Number of entries to return (default: 10)' },
      },
    },
  },
  {
    name: 'get_backend_status',
    description: 'Check all Inter-Forge backend statuses: ComfyUI, Blender, Python, IP-Adapter, installed models. Returns { available: [...], tier, details }.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleGetStatus() {
  try {
    const data = await apiGet('/api/status');
    return ok({ comfyui: data.comfyui, blender: data.blenderInstalled ? 'installed' : 'not found', server: data.server });
  } catch (e) {
    return err(`Failed to reach server: ${e.message}`);
  }
}

async function handleGenerateAsset(args) {
  try {
    // Coerce numeric fields — MCP clients sometimes send everything as strings
    const payload = {
      ...args,
      ...(args.width  != null && { width:  Number(args.width)  }),
      ...(args.height != null && { height: Number(args.height) }),
      ...(args.seed   != null && { seed:   Number(args.seed)   }),
      ...(args.steps  != null && { steps:  Number(args.steps)  }),
      ...(args.cfg    != null && { cfg:    Number(args.cfg)    }),
    };

    // Start image generation and poll to completion
    const startData    = await apiPost('/api/generate', payload);
    const imageJob     = await pollUntilDone(`/api/generate/${startData.jobId}`);
    const imageResult  = imageJob.result;
    const filename     = imageResult?.filename;

    // Auto-chain 3D reconstruction for meshable asset types
    // Weapon → sword silhouette pipeline (proper UV-mapped mesh)
    // Other meshable types → TripoSR (AI-based reconstruction)
    const assetType = args.assetType ?? '';
    if (MESH_ASSET_TYPES.has(assetType) && filename) {
      try {
        const isSword = assetType === 'weapon';
        const meshEndpoint = isSword
          ? '/api/blender/sword-asset'
          : '/api/triposr/generate';
        const meshBody = isSword
          ? { textureFilename: filename }
          : { imageFilename: filename, resolution: 256 };
        const meshPollBase = isSword ? '/api/blender' : '/api/triposr';

        const meshStart = await apiPost(meshEndpoint, meshBody);
        if (meshStart.jobId) {
          const meshJob = await pollUntilDone(`${meshPollBase}/${meshStart.jobId}`, 2000, 360_000);

          let glbFile, glbUrl;
          if (isSword && meshJob.result) {
            glbFile = meshJob.result.filename;
            glbUrl  = `/api/blender/model/${glbFile}`;
          } else {
            glbUrl  = meshJob.result?.glbUrl;
            glbFile = glbUrl ? glbUrl.split('/').pop().split('?')[0] : null;
          }

          const imgPath = imageResult?.imagePath ?? null;
          const content = [{ type: 'text', text: JSON.stringify({ type: '3d', imageFilename: filename, glbFilename: glbFile, glbUrl, prompt: imageResult?.prompt, seed: imageResult?.seed }, null, 2) }];
          if (imgPath) {
            try {
              const b64 = (await fs.readFile(imgPath)).toString('base64');
              content.push({ type: 'image', data: b64, mimeType: 'image/png' });
            } catch {}
          }
          return { content };
        }
      } catch { /* 3D failed — fall through and return 2D result */ }
    }

    // 2D-only result (or 3D failed silently)
    const content = [{ type: 'text', text: JSON.stringify(imageResult, null, 2) }];
    if (imageResult?.imagePath) {
      try {
        const b64 = (await fs.readFile(imageResult.imagePath)).toString('base64');
        content.push({ type: 'image', data: b64, mimeType: 'image/png' });
      } catch {}
    }
    return { content };
  } catch (e) {
    return err(e.message);
  }
}

async function handleGenerateSpriteSheet(args) {
  try {
    const data = await apiPost('/api/sprite-sheet', args);
    return ok({ jobId: data.jobId, frameCount: args.frameCount ?? 4 });
  } catch (e) {
    return err(e.message);
  }
}

async function handleApplyToMesh(args) {
  try {
    const data = await apiPost('/api/blender/apply-mesh', args);
    if (!data.success) return err(data.error ?? 'Blender job failed to start');
    return ok({ jobId: data.jobId });
  } catch (e) {
    return err(e.message);
  }
}

async function handlePollJob(args) {
  try {
    const type = args.jobType ?? 'generate';
    let endpoint;
    if (type === 'sprite-sheet') endpoint = `/api/sprite-sheet/${args.jobId}`;
    else if (type === 'blender')  endpoint = `/api/blender/${args.jobId}`;
    else if (type === 'triposr')  endpoint = `/api/triposr/${args.jobId}`;
    else                          endpoint = `/api/generate/${args.jobId}`;

    const data = await apiGet(endpoint);

    // If completed and has an image on disk, include it as a base64 image block
    // so Claude Desktop (and other MCP clients) can render it inline.
    if (data.status === 'completed') {
      // 2D generation: imagePath
      // Blender jobs: previewPath (rendered PNG preview of 3D model)
      const imgPath = data.result?.imagePath ?? data.result?.previewPath ?? null;
      if (imgPath) {
        try {
          const imgBuffer = await fs.readFile(imgPath);
          const b64 = imgBuffer.toString('base64');
          return {
            content: [
              { type: 'text', text: JSON.stringify(data, null, 2) },
              { type: 'image', data: b64, mimeType: 'image/png' },
            ],
          };
        } catch {
          // File unreadable — fall through to plain text
        }
      }
    }

    return ok(data);
  } catch (e) {
    return err(e.message);
  }
}

async function handleGetHistory(args) {
  try {
    const data = await apiGet('/api/history');
    const generations = data.generations ?? [];
    const limited = args.limit ? generations.slice(0, args.limit) : generations;
    return ok({ generations: limited, total: data.total ?? generations.length });
  } catch (e) {
    return err(e.message);
  }
}

async function handleBlenderRunScript(args) {
  try {
    const { pythonCode } = args;

    // Find blender — check env.json first, then common Windows locations
    const { readEnv } = await import('../env/reader.js');
    const env = await readEnv();
    const managedBlenderExe = path.join(ITERFORGE_HOME, 'blender', 'blender.exe');

    let blenderExe = env.tools?.blender?.path ?? null;
    if (!blenderExe || !(await fs.pathExists(blenderExe))) {
      if (await fs.pathExists(managedBlenderExe)) {
        blenderExe = managedBlenderExe;
      }
    }

    if (!blenderExe) {
      return err('Blender not found. Set the Blender path in Settings first.');
    }

    // Write temp script
    const tmpDir    = path.join(ITERFORGE_HOME, 'tmp');
    await fs.ensureDir(tmpDir);
    const scriptPath = path.join(tmpDir, `mcp_script_${Date.now()}.py`);
    await fs.writeFile(scriptPath, pythonCode, 'utf8');

    try {
      const { stdout, stderr } = await execFileAsync(blenderExe, [
        '--background',
        '--python', scriptPath,
      ], { timeout: 120_000 });
      return ok({ success: true, stdout: stdout.slice(-4000), stderr: stderr.slice(-2000) });
    } catch (execErr) {
      return ok({ success: false, stdout: execErr.stdout?.slice(-4000) ?? '', stderr: execErr.stderr?.slice(-2000) ?? execErr.message });
    } finally {
      await fs.remove(scriptPath).catch(() => {});
    }
  } catch (e) {
    return err(e.message);
  }
}

async function handleGenerateSwordMesh(args) {
  try {
    const data = await apiPost('/api/blender/sword-asset', { textureFilename: args.textureFilename });
    if (!data.success) return err(data.error ?? 'Failed to start sword asset job');
    return ok({ jobId: data.jobId, note: 'Poll with poll_job(jobId, jobType:"blender") to get the GLB + rendered preview.' });
  } catch (e) {
    return err(e.message);
  }
}

async function handleGenerate3dAsset(args) {
  try {
    const data = await apiPost('/api/triposr/generate', {
      imageFilename: args.imageFilename,
      resolution:    args.resolution ?? 256,
    });
    if (!data.success) return err(data.error ?? 'Failed to start TripoSR job');
    return ok({ jobId: data.jobId, note: 'Poll with poll_job(jobId, jobType:"triposr") to get the GLB + preview.' });
  } catch (e) {
    return err(e.message);
  }
}

async function handleExportToEngine(args) {
  try {
    const data = await apiPost('/api/export', args);
    if (data.error) return err(data.error);
    return ok(data);
  } catch (e) {
    return err(e.message);
  }
}

// ── Project context helpers ───────────────────────────────────────────────────

// Resolve the project config file: prefer iterforge.json in cwd, fall back to ITERFORGE_HOME
function resolveProjectFile() {
  const cwd = process.cwd();
  const local = path.join(cwd, 'iterforge.json');
  return local;
}

// Set a nested value by dot-notation key on an object
function setDeep(obj, dotKey, value) {
  const parts = dotKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

async function handleReadProjectContext() {
  try {
    // Try to read project file from cwd
    const projectFile = resolveProjectFile();
    let projectData = null;
    if (await fs.pathExists(projectFile)) {
      projectData = await fs.readJson(projectFile);
    }

    // Also pull live status from the API server (best-effort)
    let liveStatus = null;
    try { liveStatus = await apiGet('/api/status'); } catch {}

    let liveHistory = null;
    try {
      const h = await apiGet('/api/history');
      liveHistory = (h.generations ?? []).slice(0, 10);
    } catch {}

    return ok({
      success: true,
      context: projectData ?? {},
      liveStatus,
      recentHistory: liveHistory,
      projectFile: await fs.pathExists(projectFile) ? projectFile : null,
    });
  } catch (e) {
    return err(e.message);
  }
}

async function handleWriteProjectContext(args) {
  try {
    const { updates } = args;
    const projectFile = resolveProjectFile();

    let data = {};
    if (await fs.pathExists(projectFile)) {
      data = await fs.readJson(projectFile);
    }

    for (const [key, value] of Object.entries(updates)) {
      setDeep(data, key, value);
    }

    await fs.writeJson(projectFile, data, { spaces: 2 });
    return ok({ success: true, updatedKeys: Object.keys(updates), projectFile });
  } catch (e) {
    return err(e.message);
  }
}

async function handleGetGenerationHistory(args) {
  try {
    const n = args.n ?? 10;

    // Project file takes priority (cwd-scoped session context)
    const projectFile = resolveProjectFile();
    if (await fs.pathExists(projectFile)) {
      const data = await fs.readJson(projectFile);
      const history = (data.history ?? []).slice(0, n);
      return ok({ history, total: history.length, source: 'project-file' });
    }

    // Fall back to live API history (global across all sessions)
    try {
      const data = await apiGet('/api/history');
      const generations = (data.generations ?? []).slice(0, n);
      return ok({ history: generations, total: data.total ?? generations.length, source: 'api' });
    } catch {}

    return ok({ history: [], total: 0, source: 'none' });
  } catch (e) {
    return err(e.message);
  }
}

async function handleGetBackendStatus() {
  try {
    // Pull live status from API
    let status = {};
    try { status = await apiGet('/api/status'); } catch {}

    // Pull env for tier and installed tool versions
    const ENV_PATH = path.join(ITERFORGE_HOME, 'env.json');
    let env = {};
    try { env = await fs.readJson(ENV_PATH); } catch {}

    const available = [];
    if (status.comfyui === 'ok')       available.push('comfyui');
    if (status.blenderInstalled)        available.push('blender');
    if (status.ipAdapterReady)          available.push('ipadapter');

    return ok({
      available,
      tier:             env.tier ?? status.tier ?? 'local',
      comfyui:          status.comfyui ?? 'unknown',
      comfyStarting:    status.comfyStarting ?? false,
      blender:          status.blenderInstalled ? (status.blenderVersion ?? 'installed') : 'not found',
      ipAdapterReady:   status.ipAdapterReady ?? false,
      serverVersion:    status.version ?? null,
      details:          status,
    });
  } catch (e) {
    return err(e.message);
  }
}

// ── createMcpServer ───────────────────────────────────────────────────────────

export function createMcpServer() {
  const server = new Server(
    { name: 'iterforge', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      switch (name) {
        case 'get_status':            return await handleGetStatus();
        case 'generate_asset':        return await handleGenerateAsset(args);
        case 'generate_sprite_sheet': return await handleGenerateSpriteSheet(args);
        case 'apply_to_mesh':         return await handleApplyToMesh(args);
        case 'poll_job':              return await handlePollJob(args);
        case 'get_history':           return await handleGetHistory(args);
        case 'blender_run_script':    return await handleBlenderRunScript(args);
        case 'generate_sword_mesh':   return await handleGenerateSwordMesh(args);
        case 'generate_3d_asset':     return await handleGenerate3dAsset(args);
        case 'export_to_engine':      return await handleExportToEngine(args);
        case 'read_project_context':  return await handleReadProjectContext();
        case 'write_project_context': return await handleWriteProjectContext(args);
        case 'get_generation_history':return await handleGetGenerationHistory(args);
        case 'get_backend_status':    return await handleGetBackendStatus();
        default:
          return err(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return err(`Tool error: ${e.message}`);
    }
  });

  return server;
}
