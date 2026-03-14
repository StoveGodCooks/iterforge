#!/usr/bin/env node
import { Command } from 'commander';
import { EnvManager } from '../src/env/manager.js';
import { runDoctor } from '../src/cli/doctor.js';
import { runInit } from '../src/cli/init.js';
import { runStart } from '../src/cli/start.js';
import { runStop } from '../src/cli/stop.js';
import { runGenerate } from '../src/cli/generate.js';
import { startMCPServer } from '../src/mcp/server.js';

const program = new Command();

program
  .name('iterforge')
  .description('IterForge — Game Asset Generation Pipeline Orchestrator')
  .version('1.0.0');

// ── doctor ────────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Check health of the IterForge environment')
  .action(runDoctor);

// ── install ───────────────────────────────────────────────────────────────────
program
  .command('install')
  .description('Install missing managed dependencies (Python, ComfyUI)')
  .action(async () => {
    try {
      await EnvManager.setup();
    } catch {
      process.exit(1);
    }
  });

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize IterForge in the current project directory')
  .option('--force', 'Overwrite existing iterforge.json and agent configs')
  .option('--silent', 'Suppress output')
  .action(async (opts) => {
    try {
      await runInit(opts);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

// ── generate ──────────────────────────────────────────────────────────────
program
  .command('generate [type]')
  .description(
    'Generate an image — preset type (arena|card) or free-form --prompt\n' +
    '  Preset:  iterforge generate arena --faction AEGIS\n' +
    '  Custom:  iterforge generate --prompt "dark castle, game art"\n' +
    '  Remix:   iterforge generate --prompt "..." --reference photo.png'
  )
  // ── prompt (custom mode) ──
  .option('--prompt <text>',     'free-form positive prompt (skips the preset engine)')
  .option('--negative <text>',   'negative prompt (used with --prompt)')
  // ── inspiration image (img2img) ──
  .option('--reference <path>',  'path to reference/inspiration image (enables img2img)')
  .option('--strength <n>',      'how much to change the reference 0-1 (default 0.75)', parseFloat)
  // ── preset options ──
  .option('--faction <n>',       'AEGIS | ECLIPSE | SPECTER  (preset mode only)')
  .option('--atmosphere <n>',    'midday | nighttime | rain | flooded  (preset mode only)')
  .option('--condition <n>',     'standard | damaged | flooded  (preset mode only)')
  .option('--zoom <n>',          'framing 0-4  (preset mode only)', parseInt)
  .option('--darkness <n>',      'darkness 0-4  (preset mode only)', parseInt)
  .option('--noise <n>',         'noise 0-4  (preset mode only)', parseInt)
  // ── generation controls ──
  .option('--model <filename>',  'checkpoint filename to use (e.g. dreamshaper_xl.safetensors)')
  .option('--width <n>',         'output width in pixels', parseInt)
  .option('--height <n>',        'output height in pixels', parseInt)
  .option('--steps <n>',         'inference steps (default 30)', parseInt)
  .option('--cfg <n>',           'CFG scale (default 7.0)', parseFloat)
  .option('--seed <n>',          'fixed seed for reproducibility', parseInt)
  .option('--sampler <name>',    'sampler name (dpmpp_2m_sde | euler | dpmpp_2m | ...)')
  .option('--backend <name>',    'force specific backend')
  .option('--no-cloud',          'never use cloud backends')
  .option('--export-godot',      'auto-export to Godot after generation')
  .option('--dry-run',           'print prompt + settings, do not generate')
  .action(async (type, opts) => {
    try {
      await runGenerate(type, opts);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

// ── start ─────────────────────────────────────────────────────────────────
program
  .command('start <backend>')
  .description('Start a generation backend (comfyui | all)')
  .action(async (backend) => {
    try {
      await runStart(backend);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

// ── stop ──────────────────────────────────────────────────────────────────
program
  .command('stop <backend>')
  .description('Stop a generation backend (comfyui | all)')
  .action(async (backend) => {
    try {
      await runStop(backend);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

// ── mcp ───────────────────────────────────────────────────────────────────
program
  .command('mcp')
  .description('Start MCP server (stdio JSON-RPC — used by AI agents)')
  .action(async () => {
    try {
      await startMCPServer();
    } catch (err) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
  });

program.parse();
