import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { ContextManager } from '../context/manager.js';
import { PromptEngine } from '../prompts/engine.js';
import { generate as routerGenerate } from '../backends/router.js';
import { verifyModel } from '../backends/comfyui.js';

const PRESET_TYPES = ['arena', 'card'];

const DEFAULT_NEGATIVE =
  'blurry, low quality, jpeg artifacts, watermark, signature, text, logo, ' +
  'distorted, duplicate, out of frame, worst quality, low resolution, pixelated, ' +
  'oversaturated, overexposed, underexposed';

/** Build output filename for preset mode per spec §A9 */
function buildPresetFilename(type, faction, atmosphere, condition, seed, hasRef) {
  const base = `${type}_${faction}_${atmosphere}_${condition}${hasRef ? '_remix' : ''}_${seed}`;
  return base.toLowerCase().replace(/\s+/g, '_') + '.png';
}

/** Build output filename for custom prompt mode */
function buildCustomFilename(prompt, seed, hasRef) {
  const slug = prompt
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const prefix = hasRef ? 'remix' : 'custom';
  return `${prefix}_${slug}_${seed}.png`;
}

export async function runGenerate(type, opts) {
  const isCustom = Boolean(opts.prompt);
  const isPreset = Boolean(type) && PRESET_TYPES.includes(type);

  // ── Validate mode ───────────────────────────────────────────────────────────
  if (!isCustom && !isPreset) {
    if (type && !PRESET_TYPES.includes(type)) {
      console.error(chalk.red(`✗ [ERR_INVALID_TYPE] Unknown preset type "${type}". Supported: ${PRESET_TYPES.join(', ')}`));
      console.error('  Or skip the type and use: ' + chalk.cyan('iterforge generate --prompt "your prompt"'));
    } else {
      console.error(chalk.red('✗ Provide a preset type (arena|card) or use --prompt'));
      console.error('  Examples:');
      console.error('    ' + chalk.cyan('iterforge generate arena --faction AEGIS'));
      console.error('    ' + chalk.cyan('iterforge generate --prompt "dark fantasy castle, game art"'));
    }
    process.exit(1);
  }

  // ── Load project context ────────────────────────────────────────────────────
  const config = await ContextManager.read();
  if (!config) {
    console.error(chalk.red('✗ [ERR_NO_PROJECT] No iterforge.json found. Run: iterforge init'));
    process.exit(1);
  }

  // ── Build shared settings ───────────────────────────────────────────────────
  const seed = opts.seed !== undefined ? Number(opts.seed) : Math.floor(Math.random() * 2 ** 32);
  const settings = {
    steps:         opts.steps    !== undefined ? Number(opts.steps)    : config.settings?.steps    ?? 30,
    cfg:           opts.cfg      !== undefined ? Number(opts.cfg)      : config.settings?.cfg      ?? 7.0,
    seed,
    width:         opts.width    !== undefined ? Number(opts.width)    : config.settings?.width    ?? 1024,
    height:        opts.height   !== undefined ? Number(opts.height)   : config.settings?.height   ?? 1024,
    sampler:       opts.sampler  ?? null,
    backend:       opts.backend  ?? config.backend_override ?? null,
    noCloud:       opts.noCloud  ?? false,
    model:         opts.model    ?? null,
    referencePath: opts.reference ?? null,
    strength:      opts.strength !== undefined ? Number(opts.strength) : 0.75,
  };

  // ── Build prompts ───────────────────────────────────────────────────────────
  let positive, negative, outputType;

  if (isCustom) {
    positive    = opts.prompt;
    negative    = opts.negative ?? DEFAULT_NEGATIVE;
    outputType  = 'custom';
  } else {
    // Preset mode — faction/atmosphere/condition drive the PromptEngine
    const presetSettings = {
      faction:    opts.faction    ?? config.active?.faction    ?? 'AEGIS',
      atmosphere: opts.atmosphere ?? config.settings?.atmosphere ?? 'midday',
      condition:  opts.condition  ?? config.settings?.condition  ?? 'standard',
      zoom:       opts.zoom       !== undefined ? Number(opts.zoom)     : config.settings?.zoom     ?? 2,
      darkness:   opts.darkness   !== undefined ? Number(opts.darkness) : config.settings?.darkness ?? 3,
      noise:      opts.noise      !== undefined ? Number(opts.noise)    : config.settings?.noise    ?? 1,
    };
    const built = PromptEngine.build({ type, ...presetSettings });
    positive   = built.positive;
    negative   = built.negative;
    outputType = type;

    // Stash for filename building
    settings.faction    = presetSettings.faction;
    settings.atmosphere = presetSettings.atmosphere;
    settings.condition  = presetSettings.condition;
  }

  // ── Dry run ─────────────────────────────────────────────────────────────────
  if (opts.dryRun) {
    const mode = settings.referencePath ? 'img2img' : 'txt2img';
    console.log(chalk.bold(`\nDry run — mode: ${mode}\n`));
    console.log(chalk.bold('Positive prompt:'));
    console.log(' ', positive);
    console.log(chalk.bold('\nNegative prompt:'));
    console.log(' ', negative);
    console.log(chalk.bold('\nSettings:'));
    const display = { ...settings, mode };
    delete display.noCloud;
    for (const [k, v] of Object.entries(display)) {
      if (v !== null) console.log(`  ${k.padEnd(14)} ${v}`);
    }
    return;
  }

  // ── Verify model ────────────────────────────────────────────────────────────
  try {
    await verifyModel();
  } catch (err) {
    console.error(chalk.red(`✗ ${err.message}`));
    process.exit(1);
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  const outputDir = path.join(process.cwd(), config.project?.assets_path ?? 'assets/iterforge');
  const hasRef    = Boolean(settings.referencePath);
  const modeLabel = hasRef ? 'img2img' : 'txt2img';
  const label     = isCustom
    ? `image (${modeLabel})`
    : `${type} (${settings.faction} / ${settings.atmosphere}, ${modeLabel})`;

  const spinner = ora(`Generating ${label}...`).start();

  let result;
  try {
    result = await routerGenerate({
      type: outputType,
      positive,
      negative,
      steps:         settings.steps,
      cfg:           settings.cfg,
      seed:          settings.seed,
      width:         settings.width,
      height:        settings.height,
      sampler:       settings.sampler,
      backend:       settings.backend,
      noCloud:       settings.noCloud,
      model:         settings.model,
      referencePath: settings.referencePath,
      strength:      settings.strength,
      outputDir,
    });
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }

  // ── Rename to convention ────────────────────────────────────────────────────
  const { default: fse } = await import('fs-extra');
  let destFilename;
  if (isCustom) {
    destFilename = buildCustomFilename(positive, result.seed, hasRef);
  } else {
    destFilename = buildPresetFilename(outputType, settings.faction, settings.atmosphere, settings.condition, result.seed, hasRef);
  }
  const destPath = path.join(outputDir, destFilename);
  if (result.imagePath !== destPath) {
    await fse.move(result.imagePath, destPath, { overwrite: true });
  }

  spinner.succeed(`Generated: ${destFilename}  [${result.backend}]`);

  // ── Update iterforge.json ───────────────────────────────────────────────────
  const newEntry = {
    image_path:   destPath,
    prompt:       positive,
    backend_used: result.backend,
    seed:         result.seed,
    mode:         modeLabel,
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
        { path: destPath, type: outputType, timestamp: newEntry.timestamp }
      ]
    }
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`  Path:   ${chalk.cyan(destPath)}`);
  console.log(`  Seed:   ${result.seed}  (use --seed ${result.seed} to reproduce)`);
  if (hasRef) {
    console.log(`  Ref:    ${chalk.cyan(settings.referencePath)}  (strength ${settings.strength})`);
  }
}
