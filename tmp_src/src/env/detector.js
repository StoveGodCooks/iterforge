import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import net from 'net';

export const ITERFORGE_HOME = path.join(os.homedir(), 'AppData', 'Roaming', 'IterForge');
const VENV_PYTHON   = path.join(ITERFORGE_HOME, 'venv', 'Scripts', 'python.exe');
const BASE_PYTHON   = path.join(ITERFORGE_HOME, 'python-base', 'python.exe');
const COMFYUI_PORT = 8188;
const COMFYUI_HOST = '127.0.0.1';

// Resolve whether a TCP port is accepting connections (no HTTP needed)
function isPortOpen(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

export class EnvDetector {
  static async checkAll() {
    return {
      node:          await this.checkNode(),
      python:        await this.checkPython(),
      comfyui:       await this.checkComfyUIInstall(),
      comfyuiServer: await this.checkComfyUIRunning(),
      docker:        await this.checkDocker(),
      gpu:           await this.checkGPU(),
      mcpConfig:     await this.checkMCPConfig(),
    };
  }

  // ── Node.js ──────────────────────────────────────────────────────────────
  static async checkNode() {
    try {
      const raw = execSync('node -v', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); // e.g. "v20.11.0"
      const major = parseInt(raw.replace('v', '').split('.')[0], 10);
      if (major < 18) {
        return {
          status: 'MISSING',
          version: raw,
          code: 'ERR_NODE_VERSION',
          detail: `Node.js ${raw} is below minimum required v18.`,
          fix: 'Install Node.js 18 LTS from https://nodejs.org'
        };
      }
      return { status: 'OK', version: raw };
    } catch {
      return {
        status: 'MISSING',
        code: 'ERR_NODE_MISSING',
        fix: 'Install Node.js 18+ from https://nodejs.org'
      };
    }
  }

  // ── Python ───────────────────────────────────────────────────────────────
  static async checkPython() {
    // Prefer venv Python (primary managed path), fall back to python-base
    for (const managedPython of [VENV_PYTHON, BASE_PYTHON]) {
      if (await fs.pathExists(managedPython)) {
        try {
          const v = execSync(`"${managedPython}" --version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
          return { status: 'OK', version: v, type: 'managed', path: managedPython };
        } catch {}
      }
    }

    try {
      const v = execSync('python --version', { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
      return { status: 'OK', version: v, type: 'system' };
    } catch {
      return {
        status: 'MISSING',
        code: 'ERR_PYTHON_MISSING',
        fix: 'iterforge install'
      };
    }
  }

  // ── ComfyUI install (folder) ──────────────────────────────────────────────
  static async checkComfyUIInstall() {
    const comfyPath = path.join(ITERFORGE_HOME, 'comfyui');
    const mainPy = path.join(comfyPath, 'main.py');
    if (await fs.pathExists(mainPy)) {
      return { status: 'OK', path: comfyPath };
    }
    return {
      status: 'MISSING',
      code: 'ERR_COMFYUI_NOT_INSTALLED',
      fix: 'iterforge install'
    };
  }

  // ── ComfyUI server (live port check) ─────────────────────────────────────
  static async checkComfyUIRunning() {
    const open = await isPortOpen(COMFYUI_HOST, COMFYUI_PORT);
    if (open) {
      return { status: 'OK', detail: `Listening on ${COMFYUI_HOST}:${COMFYUI_PORT}` };
    }
    return {
      status: 'WARN',
      code: 'ERR_COMFYUI_NOT_RUNNING',
      detail: `Nothing on port ${COMFYUI_PORT}.`,
      fix: 'iterforge start comfyui'
    };
  }

  // ── Docker ───────────────────────────────────────────────────────────────
  static async checkDocker() {
    try {
      const v = execSync('docker --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      return { status: 'OK', version: v };
    } catch {
      return {
        status: 'WARN',           // Docker is V2 — warn, not block
        code: 'ERR_DOCKER_MISSING',
        detail: 'Required for advanced tools (Blender, Inkscape) in V2.',
        fix: 'Install Docker Desktop from https://www.docker.com/products/docker-desktop'
      };
    }
  }

  // ── GPU ──────────────────────────────────────────────────────────────────
  static async checkGPU() {
    // NVIDIA — try nvidia-smi in PATH, then common install locations
    const nvidiaPaths = [
      'nvidia-smi',
      'C:\\Windows\\System32\\nvidia-smi.exe',
      'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
    ];
    for (const cmd of nvidiaPaths) {
      try {
        const out = execSync(`"${cmd}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        if (out.includes('NVIDIA-SMI') || out.includes('Driver Version')) {
          const match = out.match(/\|\s+(\w[\w\s]+NVIDIA[^|]+)\|/i) ||
                        out.match(/GPU\s+\d+:([^\n(]+)/i);
          const name = match ? match[1].trim() : 'NVIDIA GPU';
          return { status: 'OK', type: 'NVIDIA', name };
        }
      } catch {}
    }

    // AMD — check via wmic
    try {
      const out = execSync('wmic path win32_VideoController get Name', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
      const gpuLine = lines.find(l => /nvidia|amd|radeon|geforce|rtx|gtx/i.test(l));
      if (gpuLine) {
        const type = /nvidia|geforce|rtx|gtx/i.test(gpuLine) ? 'NVIDIA' : 'AMD';
        return { status: 'OK', type, name: gpuLine };
      }
    } catch {}

    return {
      status: 'WARN',
      type: 'UNKNOWN',
      code: 'ERR_GPU_NOT_DETECTED',
      detail: 'No GPU detected. ComfyUI will run in CPU mode (~8-15 min/image).'
    };
  }

  // ── MCP config ───────────────────────────────────────────────────────────
  static async checkMCPConfig() {
    const cwd = process.cwd();
    const candidates = [
      path.join(cwd, '.mcp.json'),
      path.join(cwd, '.claude', 'settings.json'),
      path.join(cwd, '.gemini', 'config.json'),
    ];
    for (const p of candidates) {
      if (await fs.pathExists(p)) {
        return { status: 'OK', path: p };
      }
    }
    return {
      status: 'WARN',
      code: 'ERR_MCP_NOT_CONFIGURED',
      detail: 'No MCP config found in current directory.',
      fix: 'iterforge init'
    };
  }
}
