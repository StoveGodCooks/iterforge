import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { ITERFORGE_HOME } from '../env/reader.js';

const PIDS_FILE = path.join(ITERFORGE_HOME, 'pids.json');

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

function killPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false; // process already gone
    throw err;
  }
}

async function stopBackend(name) {
  const pids = await readPids();
  const pid = pids[name];

  if (!pid) {
    console.log(chalk.yellow(`! No tracked PID for ${name}. It may have been started outside Inter-Forge.`));
    return;
  }

  const killed = killPid(pid);
  if (killed) {
    console.log(chalk.green(`✓ ${name} stopped (PID ${pid}).`));
  } else {
    console.log(chalk.yellow(`! ${name} (PID ${pid}) was not running.`));
  }

  delete pids[name];
  await writePids(pids);
}

export async function runStop(target) {
  if (!SUPPORTED.includes(target) && target !== 'all') {
    console.error(chalk.red(`Unknown backend: "${target}". Supported: ${SUPPORTED.join(', ')}`));
    process.exit(1);
  }

  if (target === 'all') {
    for (const backend of SUPPORTED) {
      await stopBackend(backend);
    }
  } else {
    await stopBackend(target);
  }
}
