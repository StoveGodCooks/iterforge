import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { ContextManager } from '../context/manager.js';
import { PromptEngine } from '../prompts/engine.js';
import { generate as routerGenerate } from '../backends/router.js';
import { verifyModel } from '../backends/comfyui.js';

// V1 supported types
const SUPPORTED_TYPES = ['arena', 'card'];

/** Build output filename per spec §A9 */
function buildFilename(type, faction, atmosphere, condition, seed) {
  return `${type}_${faction}_${atmosphere}_${condition}_${seed}.png`
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export async function runGenerate(type, opts) {
  // ── 1. Validate type ───────────────────────────────────────────────────
  if (!SUPPORTED_TYPES.includes(type)) {
    console.error(chalk.red(`✗ [ERR_INVALID_TYPE] "${type}" is not supported in V1. Supported: ${SUPPORTED_TYPES.join(', ')}`));
    process.exit(1);
  }

  // ── 2. Load project context ────────────────────────────────────────────
  const config = await ContextManager.read();
  if (!config) {
    console.error(chalk.red('✗ [ERR_NO_PROJECT] No iterforge.json found. Run: iterforge init'));
    process.exit(1);
  }

  // ── 3. Merge settings (CLI flags override stored settings) ────────────
  const settings = {
    faction:    opts.faction    ?? config.active.faction    ?? 'AEGIS',
    atmosphere: opts.atmosphere ?? config.settings.atmosphere ?? 'midday',
    condition:  opts.condition  ?? config.settings.condition  ?? 'standard',
    zoom:       opts.zoom       !== undefined ? Number(opts.zoom)       : config.settings.zoom,
    darkness:   opts.darkness   !== undefined ? Number(opts.darkness)   : config.settings.darkness,
    noise:      opts.noise      !== undefined ? Number(opts.noise)      : config.settings.noise,
    steps:      opts.steps      !== undefined ? Number(opts.steps)      : config.settings.steps,
    cfg:        opts.cfg        !== undefined ? Number(opts.cfg)        : config.settings.cfg,
    seed:       opts.seed       !== undefined ? Number(opts.seed)       : Math.floor(Math.random() * 2 ** 32),
    width:      config.settings.width  ?? 1024,
    height:     config.settings.height ?? 1024,
    backend:    opts.backend    ?? config.backend_override ?? null,
    noCloud:    opts.noCloud    ?? false,
  };

  // ── 4. Build prompt ────────────────────────────────────────────────────
  const { positive, negative } = PromptEngine.build({
    type,
    faction:    settings.faction,
    atmosphere: settings.atmosphere,
    darkness:   settings.darkness,
    zoom:       settings.zoom,
    noise:      settings.noise,
    condition:  settings.condition,
  });

  // ── 5. Dry run ─────────────────────────────────────────────────────────
  if (opts.dryRun) {
    console.log(chalk.bold('\nDry run — no image will be generated\n'));
    console.log(chalk.bold('Positive prompt:'));
    console.log(' ', positive);
    console.log(chalk.bold('\nNegative prompt:'));
    console.log(' ', negative);
    console.log(chalk.bold('\nSettings:'));
    for (const [k, v] of Object.entries(settings)) {
      console.log(`  ${k.padEnd(12)} ${v}`);
    }
    return;
  }

  // ── 6. Verify model before first generate ─────────────────────────────
  try {
    await verifyModel();
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }

  // ── 7. Generate ────────────────────────────────────────────────────────
  const outputDir = path.join(process.cwd(), config.project.assets_path ?? 'assets/iterforge');
  const spinner = ora(`Generating ${type} (${settings.faction} / ${settings.atmosphere})...`).start();

  let result;
  try {
    result = await routerGenerate({
      type,
      positive,
      negative,
      steps:   settings.steps,
      cfg:     settings.cfg,
      seed:    settings.seed,
      width:   settings.width,
      height:  settings.height,
      backend: settings.backend,
      noCloud: settings.noCloud,
      outputDir,
    });
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }

  // Rename file to spec §A9 convention
  const destFilename = buildFilename(type, settings.faction, settings.atmosphere, settings.condition, result.seed);
  const destPath = path.join(outputDir, destFilename);

  const { default: fs } = await import('fs-extra');
  if (result.imagePath !== destPath) {
    await fs.move(result.imagePath, destPath, { overwrite: true });
  }

  spinner.succeed(`Generated: ${destFilename}  [${result.backend}]`);

  // ── 8. Update iterforge.json ───────────────────────────────────────────
  const newEntry = {
    image_path:   destPath,
    prompt:       positive,
    backend_used: result.backend,
    seed:         result.seed,
    timestamp:    new Date().toISOString(),
  };

  const history = [newEntry, ...(config.history ?? [])].slice(0, config.max_history ?? 50);

  await ContextManager.write({
    ...config,
    last_generated: newEntry,
    history,
    godot_sync: {
      ...config.godot_sync,
      pending_assets: [
        ...(config.godot_sync?.pending_assets ?? []),
        { path: destPath, type, timestamp: newEntry.timestamp }
      ]
    }
  });

  // ── 9. Summary ─────────────────────────────────────────────────────────
  console.log(`  Path:   ${chalk.cyan(destPath)}`);
  console.log(`  Seed:   ${result.seed}  (use --seed ${result.seed} to reproduce)`);
  if (opts.exportGodot) {
    console.log(chalk.yellow('  --export godot: Godot export not yet implemented (Phase 9).'));
  }
}
