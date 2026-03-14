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
  .command('generate <type>')
  .description('Generate a game asset (arena | card)')
  .option('--faction <n>',    'AEGIS | ECLIPSE | SPECTER')
  .option('--atmosphere <n>', 'midday | nighttime | rain | flooded')
  .option('--condition <n>',  'standard | damaged | flooded')
  .option('--zoom <n>',       'framing 0-4', parseInt)
  .option('--darkness <n>',   'darkness 0-4', parseInt)
  .option('--noise <n>',      'noise 0-4', parseInt)
  .option('--steps <n>',      'inference steps', parseInt)
  .option('--cfg <n>',        'CFG scale', parseFloat)
  .option('--seed <n>',       'fixed seed', parseInt)
  .option('--backend <name>', 'force specific backend')
  .option('--no-cloud',       'never use cloud backends')
  .option('--export-godot',   'auto-export to Godot after generation')
  .option('--dry-run',        'print prompt + settings, do not generate')
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
