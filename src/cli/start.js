import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import net from 'net';
import { openSync, closeSync } from 'fs';
import { ITERFORGE_HOME } from '../env/reader.js';
import { readEnv } from '../env/reader.js';

const PIDS_FILE = path.join(ITERFORGE_HOME, 'pids.json');
const COMFYUI_HOST = '127.0.0.1';
const COMFYUI_PORT = 8188;
const COMFYUI_STARTUP_TIMEOUT_MS = 300_000; // 5 min — first launch loads models into VRAM
const COMFYUI_POLL_INTERVAL_MS = 1_000;

// Supported backends in V1
const SUPPORTED = ['comfyui'];

async function readPids() {
  if (!(await fs.pathExists(PIDS_FILE))) return {};
  try { return await fs.readJson(PIDS_FILE); } catch { return {}; }
}

async function writePids(pids) {
  await fs.ensureDir(ITERFORGE_HOME);
  await fs.writeJson(PIDS_FILE, pids, { spaces: 2 });
}

function isPortOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (r) => { socket.destroy(); resolve(r); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function waitForPort(host, port, timeoutMs, spinner) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(host, port)) return true;
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    spinner.text = `Waiting for ComfyUI to start... (${remaining}s)`;
    await new Promise(r => setTimeout(r, COMFYUI_POLL_INTERVAL_MS));
  }
  return false;
}

async function startComfyUI(env) {
  // Already running?
  if (await isPortOpen(COMFYUI_HOST, COMFYUI_PORT)) {
    console.log(chalk.green('✓ ComfyUI is already running on port 8188.'));
    return;
  }

  const comfyTool = env.tools?.comfyui;

  // Unmanaged — print manual instructions and exit
  if (comfyTool && comfyTool.managed === false) {
    console.log(chalk.yellow('! ComfyUI was not installed by IterForge (managed: false).'));
    console.log('  Start it manually with:');
    console.log(chalk.cyan(`    cd "${comfyTool.path}" && python main.py`));
    return;
  }

  // Not installed at all
  if (!comfyTool) {
    console.error(chalk.red('✗ [ERR_COMFYUI_NOT_INSTALLED] ComfyUI is not installed.'));
    console.error('  Fix: ' + chalk.cyan('iterforge install'));
    process.exit(1);
  }

  // Resolve python executable (managed preferred)
  const pythonTool = env.tools?.python;
  const pythonExe = pythonTool?.path ?? 'python';
  const comfyDir = comfyTool.path;

  const logFile = path.join(ITERFORGE_HOME, 'comfyui.log');
  await fs.ensureDir(ITERFORGE_HOME);
  const logFd = openSync(logFile, 'a');
  const spinner = ora(`Starting ComfyUI... logs: ${logFile}`).start();

  // venv Python has correct sys.path automatically — no PYTHONPATH hacks needed
  const child = spawn(
    pythonExe,
    ['main.py', '--listen', COMFYUI_HOST, '--port', String(COMFYUI_PORT), '--lowvram'],
    {
      cwd: comfyDir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    }
  );
  child.unref();
  closeSync(logFd);

  const pids = await readPids();
  pids.comfyui = child.pid;
  await writePids(pids);

  const ready = await waitForPort(COMFYUI_HOST, COMFYUI_PORT, COMFYUI_STARTUP_TIMEOUT_MS, spinner);

  if (ready) {
    spinner.succeed(`ComfyUI started on http://${COMFYUI_HOST}:${COMFYUI_PORT}  (PID ${child.pid})`);
  } else {
    spinner.warn(`ComfyUI process launched (PID ${child.pid}) but port ${COMFYUI_PORT} is not open yet.`);
    console.log('  It may still be loading models. Check: ' + chalk.cyan('iterforge doctor'));
  }
}

export async function runStart(target) {
  if (!SUPPORTED.includes(target) && target !== 'all') {
    console.error(chalk.red(`Unknown backend: "${target}". Supported: ${SUPPORTED.join(', ')}`));
    process.exit(1);
  }

  const env = await readEnv();

  if (target === 'all') {
    for (const backend of SUPPORTED) {
      await startComfyUI(env); // extend this loop when more backends are added
    }
  } else if (target === 'comfyui') {
    await startComfyUI(env);
  }
}
