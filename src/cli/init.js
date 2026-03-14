import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { ContextManager } from '../context/manager.js';
import { readEnv } from '../env/reader.js';

// Walk up directory tree looking for a file
async function findUpward(filename, startDir = process.cwd()) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, filename);
    if (await fs.pathExists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

// Parse godot_version from project.godot content
function parseGodotVersion(content) {
  const match = content.match(/config\/features=PackedStringArray\("([^"]+)"/);
  if (match) return match[1]; // e.g. "4.2"
  const verMatch = content.match(/config_version=(\d+)/);
  if (verMatch && parseInt(verMatch[1]) >= 5) return '4.x';
  return null;
}

// Verify iterforge resolves in PATH
function checkIterforgeInPath() {
  try {
    execSync('iterforge --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function runInit(options = {}) {
  const cwd = process.cwd();

  // ── 1. PATH check ─────────────────────────────────────────────────────────
  if (!checkIterforgeInPath()) {
    if (process.env.CI) {
      // CI environments (GitHub Actions etc.) never have iterforge globally installed
      console.warn(chalk.yellow('⚠ iterforge not found in PATH (CI environment — skipping PATH check)'));
    } else {
      console.error(chalk.red('✗ [ERR_PATH_NOT_FOUND] iterforge is not resolving in PATH.'));
      console.error('  Detail: MCP configs would point to a missing command and break all agent tool calls.');
      console.error('  Fix:    ' + chalk.cyan('npm install -g iterforge') + ' then open a new terminal.');
      process.exit(1);
    }
  }

  // ── 2. Detect Godot project ───────────────────────────────────────────────
  let godotVersion = null;
  let godotProjectRoot = null;
  const godotFile = await findUpward('project.godot', cwd);

  if (godotFile) {
    godotProjectRoot = path.dirname(godotFile);
    const content = await fs.readFile(godotFile, 'utf8');
    godotVersion = parseGodotVersion(content);

    if (godotVersion && parseFloat(godotVersion) < 4.0) {
      console.warn(chalk.yellow('⚠ Godot 3 project detected. The IterForge plugin requires Godot 4.'));
      console.warn('  Asset generation and filesystem export will still work, but the dock plugin is disabled.');
    }
  }

  // ── 3. Read env.json for available tools ──────────────────────────────────
  const env = await readEnv();

  // ── 4. Check for existing iterforge.json ─────────────────────────────────
  const existingConfig = await ContextManager.read();
  if (existingConfig && !options.force) {
    console.log(chalk.yellow('iterforge.json already exists. Use --force to reinitialize.'));
  }

  // ── 5. Build iterforge.json ───────────────────────────────────────────────
  const projectName = path.basename(godotProjectRoot ?? cwd);
  const relativeGodotPath = godotProjectRoot ? path.relative(cwd, godotProjectRoot) || './' : './';

  const config = await ContextManager.init(projectName);
  if (godotVersion) config.project.godot_version = godotVersion;
  config.project.godot_path = relativeGodotPath;
  await ContextManager.write(config);

  // ── 6. Write MCP / agent configs ─────────────────────────────────────────
  const mcpEntry = {
    mcpServers: {
      iterforge: {
        command: 'iterforge',
        args: ['mcp'],
        description: 'IterForge: open-source game asset pipeline. Local AI generation, Godot integration.'
      }
    }
  };

  // .mcp.json — universal fallback (always written)
  const mcpPath = path.join(cwd, '.mcp.json');
  await fs.writeJson(mcpPath, mcpEntry, { spaces: 2 });
  const written = ['.mcp.json'];

  // .claude/settings.json — Claude Code
  const claudeDir = path.join(cwd, '.claude');
  if (await fs.pathExists(claudeDir) || options.force) {
    await fs.ensureDir(claudeDir);
    const claudeSettings = path.join(claudeDir, 'settings.json');
    let existing = {};
    if (await fs.pathExists(claudeSettings)) {
      try { existing = await fs.readJson(claudeSettings); } catch {}
    }
    existing.mcpServers = { ...(existing.mcpServers ?? {}), ...mcpEntry.mcpServers };
    await fs.writeJson(claudeSettings, existing, { spaces: 2 });
    written.push('.claude/settings.json');
  }

  // .gemini/config.json — Gemini CLI
  const geminiDir = path.join(cwd, '.gemini');
  if (await fs.pathExists(geminiDir) || options.force) {
    await fs.ensureDir(geminiDir);
    const geminiConfig = path.join(geminiDir, 'config.json');
    let existing = { tools: [] };
    if (await fs.pathExists(geminiConfig)) {
      try { existing = await fs.readJson(geminiConfig); } catch {}
    }
    if (!Array.isArray(existing.tools)) existing.tools = [];
    const already = existing.tools.findIndex(t => t.name === 'iterforge');
    const entry = { name: 'iterforge', description: 'IterForge game asset pipeline', command: 'iterforge mcp' };
    if (already >= 0) existing.tools[already] = entry;
    else existing.tools.push(entry);
    await fs.writeJson(geminiConfig, existing, { spaces: 2 });
    written.push('.gemini/config.json');
  }

  // ── 7. Create assets directory ────────────────────────────────────────────
  const assetsDir = path.join(cwd, 'assets', 'iterforge');
  await fs.ensureDir(assetsDir);

  // ── 8. Print summary ──────────────────────────────────────────────────────
  console.log(chalk.bold('\n✓ IterForge initialized\n'));

  console.log(chalk.bold('Project'));
  console.log(`  Name:         ${projectName}`);
  console.log(`  Godot:        ${godotVersion ? `${godotVersion} (detected)` : 'not detected'}`);
  console.log(`  Assets path:  assets/iterforge/`);

  console.log(chalk.bold('\nAgent configs written'));
  for (const f of written) {
    console.log(`  ${chalk.green('✓')} ${f}`);
  }

  console.log(chalk.bold('\nAvailable tools'));
  const toolKeys = Object.keys(env.tools);
  if (toolKeys.length === 0) {
    console.log(`  ${chalk.yellow('!')} No managed tools found. Run ${chalk.cyan('iterforge install')} to set up ComfyUI and Python.`);
  } else {
    for (const [name, info] of Object.entries(env.tools)) {
      const label = info.managed ? 'managed' : 'detected';
      console.log(`  ${chalk.green('✓')} ${name} (${label})`);
    }
  }

  console.log(chalk.bold('\nNext steps'));
  console.log(`  1. ${chalk.cyan('iterforge doctor')}         — verify all dependencies`);
  console.log(`  2. ${chalk.cyan('iterforge start comfyui')}  — start the image generation backend`);
  console.log(`  3. ${chalk.cyan('iterforge generate arena')} — generate your first asset\n`);
}
