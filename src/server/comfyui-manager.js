import net     from 'net';
import path    from 'path';
import fs      from 'fs-extra';
import { spawn } from 'child_process';
import { openSync, closeSync } from 'fs';
import { ITERFORGE_HOME } from '../env/reader.js';
import { readEnv }        from '../env/reader.js';

const COMFYUI_HOST = '127.0.0.1';
const COMFYUI_PORT = 8188;
const PIDS_FILE    = path.join(ITERFORGE_HOME, 'pids.json');

export function isPortOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (r) => { socket.destroy(); resolve(r); };
    socket.setTimeout(timeoutMs);
    socket.once('connect',  () => done(true));
    socket.once('timeout',  () => done(false));
    socket.once('error',    () => done(false));
    socket.connect(port, host);
  });
}

export async function startComfyUIBackground() {
  const env     = await readEnv();
  const comfyTool = env.tools?.comfyui;

  const fallbackComfy = path.join(ITERFORGE_HOME, 'comfyui');
  const comfyDir = comfyTool?.path ?? fallbackComfy;

  if (!(await fs.pathExists(path.join(comfyDir, 'main.py')))) {
    console.warn('  ⚠ ComfyUI not found — run: iterforge install');
    return;
  }

  // Resolve Python
  const pythonTool    = env.tools?.python;
  const fallbackPython = await (async () => {
    const venvPy = path.join(ITERFORGE_HOME, 'venv', 'Scripts', 'python.exe');
    const basePy = path.join(ITERFORGE_HOME, 'python-base', 'python.exe');
    if (await fs.pathExists(venvPy)) return venvPy;
    if (await fs.pathExists(basePy)) return basePy;
    return 'python';
  })();
  const pythonExe = pythonTool?.path ?? fallbackPython;

  const logFile = path.join(ITERFORGE_HOME, 'comfyui.log');
  await fs.ensureDir(ITERFORGE_HOME);
  const logFd = openSync(logFile, 'a');

  const child = spawn(
    pythonExe,
    ['main.py', '--listen', COMFYUI_HOST, '--port', String(COMFYUI_PORT), '--lowvram'],
    { cwd: comfyDir, detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true }
  );
  child.unref();
  closeSync(logFd);

  // Save PID
  let pids = {};
  try { pids = await fs.readJson(PIDS_FILE); } catch {}
  pids.comfyui = child.pid;
  await fs.writeJson(PIDS_FILE, pids, { spaces: 2 });

  console.log(`  ComfyUI launched (PID ${child.pid}) — logs: ${logFile}`);
}
