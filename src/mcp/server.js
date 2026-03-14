import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ContextManager } from '../context/manager.js';
import { resolveBackend } from '../backends/router.js';
import { verifyModel } from '../backends/comfyui.js';
import { PromptEngine } from '../prompts/engine.js';
import { runGenerate } from '../cli/generate.js';
import path from 'path';
import fs from 'fs-extra';

// ── Tool definitions (spec §11) ───────────────────────────────────────────────

const TOOLS = [
  {
    name: 'generate_asset',
    description: 'Generate a game asset image. Uses local backends first. RunPod cloud only for Pro/Studio users.',
    inputSchema: {
      type: 'object',
      properties: {
        type:      { type: 'string', enum: ['arena', 'card'], description: 'Asset type' },
        faction:   { type: 'string', enum: ['AEGIS', 'ECLIPSE', 'SPECTER'] },
        settings:  { type: 'object', description: 'Overrides for iterforge.json settings' },
        backend:   { type: 'string', description: 'Force specific backend' },
        dry_run:   { type: 'boolean', description: 'Preview prompt without generating' },
        no_cloud:  { type: 'boolean', description: 'Never use cloud backends' },
        seed:      { type: 'number' },
      },
      required: ['type']
    }
  },
  {
    name: 'read_project_context',
    description: 'Read iterforge.json. Call this first before any generation to understand current project state.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'write_project_context',
    description: 'Patch iterforge.json. Only provided fields change — all others preserved.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: { type: 'object', description: 'Partial iterforge.json fields to merge' }
      },
      required: ['updates']
    }
  },
  {
    name: 'get_generation_history',
    description: 'Return last N generations with image paths, prompts, settings, backends.',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'integer', description: 'Number of entries to return (default 10)' }
      }
    }
  },
  {
    name: 'get_backend_status',
    description: 'Check which backends are available and what tier the user is on.',
    inputSchema: { type: 'object', properties: {} }
  }
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleGenerateAsset(args) {
  const opts = {
    faction:    args.faction,
    backend:    args.backend ?? null,
    noCloud:    args.no_cloud ?? false,
    dryRun:     args.dry_run ?? false,
    seed:       args.seed,
    ...(args.settings ?? {})
  };

  // Capture stdout so we can return it as MCP content
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));

  try {
    await runGenerate(args.type, opts);
  } finally {
    console.log = origLog;
  }

  const config = await ContextManager.read();
  const last = config?.last_generated ?? {};

  return {
    success: true,
    image_path:   last.image_path ?? null,
    backend_used: last.backend_used ?? null,
    prompt_used:  last.prompt ?? null,
    seed:         last.seed ?? null,
    timestamp:    last.timestamp ?? null,
    output:       lines.join('\n')
  };
}

async function handleReadProjectContext() {
  const config = await ContextManager.read();
  if (!config) {
    return { success: false, error: { code: 'ERR_NO_PROJECT', message: 'No iterforge.json found.', fix: 'iterforge init' } };
  }
  return { success: true, context: config };
}

async function handleWriteProjectContext(args) {
  if (!args.updates || typeof args.updates !== 'object') {
    return { success: false, error: { code: 'ERR_INVALID_INPUT', message: 'updates must be an object.' } };
  }
  const config = await ContextManager.read();
  if (!config) {
    return { success: false, error: { code: 'ERR_NO_PROJECT', message: 'No iterforge.json found.', fix: 'iterforge init' } };
  }
  const updated = await ContextManager.update(args.updates);
  return { success: true, updated_fields: Object.keys(args.updates) };
}

async function handleGetGenerationHistory(args) {
  const config = await ContextManager.read();
  if (!config) return { history: [] };
  const n = args.n ?? 10;
  return { history: (config.history ?? []).slice(0, n) };
}

async function handleGetBackendStatus() {
  const available = [];
  try {
    const { name } = await resolveBackend();
    available.push(name);
  } catch {}

  const { readEnv } = await import('../env/reader.js');
  const env = await readEnv();

  return {
    available,
    preferred: available[0] ?? null,
    tier: env.tier ?? 'free',
    cloud_images_remaining: null  // RunPod tracking — Phase V2
  };
}

// ── Server bootstrap ──────────────────────────────────────────────────────────

export async function startMCPServer() {
  const server = new Server(
    { name: 'iterforge', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    let result;
    try {
      switch (name) {
        case 'generate_asset':        result = await handleGenerateAsset(args); break;
        case 'read_project_context':  result = await handleReadProjectContext(); break;
        case 'write_project_context': result = await handleWriteProjectContext(args); break;
        case 'get_generation_history':result = await handleGetGenerationHistory(args); break;
        case 'get_backend_status':    result = await handleGetBackendStatus(); break;
        default:
          result = { success: false, error: { code: 'ERR_UNKNOWN_TOOL', message: `Unknown tool: ${name}` } };
      }
    } catch (err) {
      result = { success: false, error: { code: 'ERR_TOOL_EXCEPTION', message: err.message } };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
