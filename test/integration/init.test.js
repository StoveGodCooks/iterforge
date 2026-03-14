import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../../bin/iterforge.js');

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [CLI, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('exit', code => resolve({ code, out, err }));
    proc.on('error', reject);
  });
}

async function test() {
  const tmpDir = path.join(os.tmpdir(), 'iterforge-init-test-' + Date.now());
  await fs.ensureDir(tmpDir);

  try {
    // Test: init creates iterforge.json and .mcp.json
    const result = await run(['init'], tmpDir);
    // init may fail on PATH check (iterforge not in PATH in test env) — check for files directly
    const hasConfig = await fs.pathExists(path.join(tmpDir, 'iterforge.json'));
    const hasMcp    = await fs.pathExists(path.join(tmpDir, '.mcp.json'));

    if (!hasConfig) throw new Error('init: iterforge.json not created');
    if (!hasMcp)    throw new Error('init: .mcp.json not created');

    // Test: iterforge.json has expected shape
    const config = await fs.readJson(path.join(tmpDir, 'iterforge.json'));
    if (!config.project)  throw new Error('init: config missing project');
    if (!config.settings) throw new Error('init: config missing settings');
    if (!config.history)  throw new Error('init: config missing history');

    // Test: .mcp.json points to iterforge mcp
    const mcp = await fs.readJson(path.join(tmpDir, '.mcp.json'));
    if (!mcp.mcpServers?.iterforge) throw new Error('init: mcp.json missing iterforge entry');
    if (mcp.mcpServers.iterforge.args[0] !== 'mcp') throw new Error('init: mcp args wrong');

    // Test: assets dir created
    const hasAssets = await fs.pathExists(path.join(tmpDir, 'assets', 'iterforge'));
    if (!hasAssets) throw new Error('init: assets/iterforge dir not created');

    // Test: Godot version detected when project.godot present
    const godotFile = path.join(tmpDir, 'project.godot');
    await fs.writeFile(godotFile, '[application]\nconfig/features=PackedStringArray("4.3", "Forward Plus")\n');
    await fs.remove(path.join(tmpDir, 'iterforge.json'));
    await run(['init', '--force'], tmpDir);
    const config2 = await fs.readJson(path.join(tmpDir, 'iterforge.json'));
    if (config2.project.godot_version !== '4.3') throw new Error('init: Godot version not detected');

  } finally {
    await fs.remove(tmpDir);
  }
}

export default test;
