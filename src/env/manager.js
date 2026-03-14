import path from 'path';
import fs from 'fs-extra';
import { execSync } from 'child_process';
import ora from 'ora';
import fetch from 'node-fetch';
import { ITERFORGE_HOME } from './reader.js';
import { registerTool } from './writer.js';

const VENV_DIR    = path.join(ITERFORGE_HOME, 'venv');
const VENV_PYTHON = path.join(VENV_DIR, 'Scripts', 'python.exe');
const VENV_PIP    = path.join(VENV_DIR, 'Scripts', 'pip.exe');
const COMFYUI_DIR = path.join(ITERFORGE_HOME, 'comfyui');
const COMFYUI_REPO = 'https://github.com/comfyanonymous/ComfyUI.git';

// IterForge always uses its own managed Python 3.11.9 — never the system Python.
// This guarantees PyTorch CUDA compatibility regardless of what the user has installed.

// ── Download & silently install full Python 3.11.9 ───────────────────────────
async function downloadPython(spinner) {
  const url = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe';
  const dest = path.join(ITERFORGE_HOME, 'python-installer.exe');
  const installDir = path.join(ITERFORGE_HOME, 'python-base');

  if (await fs.pathExists(path.join(installDir, 'python.exe'))) {
    return path.join(installDir, 'python.exe');
  }

  spinner.text = 'Downloading Python 3.11.9 (~25 MB)...';
  await fs.ensureDir(ITERFORGE_HOME);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Python download failed: ${res.status}`);
  const buf = await res.buffer();
  await fs.writeFile(dest, buf);

  spinner.text = 'Installing Python 3.11.9...';
  execSync(
    `"${dest}" /passive InstallAllUsers=0 PrependPath=0 Include_launcher=0 TargetDir="${installDir}"`,
    { stdio: 'ignore', timeout: 120_000 }
  );
  await fs.remove(dest);
  return path.join(installDir, 'python.exe');
}

export class EnvManager {
  static async setup() {
    await fs.ensureDir(ITERFORGE_HOME);
    const spinner = ora('Checking managed environment...').start();

    try {
      const pythonExe = await this.ensureVenv(spinner);
      await this.ensureComfyUI(spinner, pythonExe);
      spinner.succeed('Managed environment ready.');
    } catch (err) {
      spinner.fail(`Setup failed: ${err.message}`);
      throw err;
    }
  }

  // ── Step 1: ensure a working venv exists ───────────────────────────────────
  static async ensureVenv(spinner) {
    // Always use managed Python 3.11.9 — never trust system Python version
    const basePython = await downloadPython(spinner);

    // If venv already exists and was built from our managed Python, reuse it
    if (await fs.pathExists(VENV_PYTHON)) {
      await registerTool('python', { path: VENV_PYTHON, version: 'venv-3.11.9', managed: true });
      return VENV_PYTHON;
    }

    spinner.text = 'Creating Python virtual environment...';
    await fs.ensureDir(ITERFORGE_HOME);
    execSync(`"${basePython}" -m venv "${VENV_DIR}"`, { stdio: 'ignore' });

    if (!(await fs.pathExists(VENV_PYTHON))) {
      throw new Error('venv creation failed — python.exe not found after venv init.');
    }

    await registerTool('python', { path: VENV_PYTHON, version: 'venv-3.11.9', managed: true });
    return VENV_PYTHON;
  }

  // ── Step 2: ensure ComfyUI is cloned & deps installed ──────────────────────
  static async ensureComfyUI(spinner, pythonExe) {
    const alreadyCloned = await fs.pathExists(path.join(COMFYUI_DIR, 'main.py'));

    if (!alreadyCloned) {
      // Verify git
      try {
        execSync('git --version', { stdio: 'ignore' });
      } catch {
        throw new Error(
          'Git is required. Install from https://git-scm.com and retry.'
        );
      }

      spinner.text = 'Cloning ComfyUI (this is a one-time step)...';
      execSync(`git clone --depth 1 "${COMFYUI_REPO}" "${COMFYUI_DIR}"`, {
        stdio: 'ignore',
        timeout: 120_000,
      });
    }

    // Check if CUDA torch is properly installed — always verify, never assume
    const cudaOk = await this._cudaAvailable(pythonExe);

    if (!cudaOk) {
      // Install (or force-reinstall) PyTorch with CUDA 12.1
      // --force-reinstall ensures CPU-only torch gets replaced even if present
      spinner.text = 'Installing PyTorch with CUDA 12.1 (~2 GB, one-time)...';
      execSync(
        `"${VENV_PIP}" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 --force-reinstall --quiet`,
        { stdio: 'ignore', timeout: 600_000 }
      );
    }

    // Use a marker file for the remaining deps (yaml, PIL, etc.)
    const depsMarker = path.join(ITERFORGE_HOME, 'comfyui-deps.ok');
    const depsInstalled = await fs.pathExists(depsMarker);

    if (!depsInstalled) {
      // Install remaining ComfyUI deps (pip skips already-installed packages)
      spinner.text = 'Installing ComfyUI dependencies...';
      const reqFile = path.join(COMFYUI_DIR, 'requirements.txt');
      if (await fs.pathExists(reqFile)) {
        execSync(
          `"${VENV_PIP}" install -r "${reqFile}" --quiet`,
          { stdio: 'ignore', timeout: 300_000 }
        );
      }
      // Write marker only after deps succeed
      await fs.writeFile(depsMarker, new Date().toISOString());
    }

    await this.ensureModel(spinner);

    await registerTool('comfyui', {
      path: COMFYUI_DIR,
      url: 'http://127.0.0.1:8188',
      managed: true,
    });
  }

  // ── Step 3: ensure at least one SDXL checkpoint exists ─────────────────────
  static async ensureModel(spinner) {
    const checkpointsDir = path.join(COMFYUI_DIR, 'models', 'checkpoints');
    await fs.ensureDir(checkpointsDir);

    const files = await fs.readdir(checkpointsDir);
    const hasSafetensors = files.some(f => f.endsWith('.safetensors') || f.endsWith('.ckpt'));
    if (hasSafetensors) return; // already have a model

    // Download official Stability AI SDXL 1.0 base from HuggingFace (~6.9 GB)
    const MODEL_URL = 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors';
    const modelDest = path.join(checkpointsDir, 'sd_xl_base_1.0.safetensors');
    const tmpDest   = modelDest + '.tmp';

    spinner.text = 'Downloading SDXL 1.0 base model (~6.9 GB, one-time)...';

    const res = await fetch(MODEL_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Model download failed: ${res.status} ${res.statusText}`);

    const total = parseInt(res.headers.get('content-length') || '0', 10);
    let received = 0;
    const out = fs.createWriteStream(tmpDest);

    await new Promise((resolve, reject) => {
      res.body.on('data', chunk => {
        received += chunk.length;
        if (total) {
          const pct = ((received / total) * 100).toFixed(1);
          spinner.text = `Downloading SDXL 1.0 base model... ${pct}%`;
        }
      });
      res.body.pipe(out);
      res.body.on('error', reject);
      out.on('finish', resolve);
      out.on('error', reject);
    });

    await fs.rename(tmpDest, modelDest);
    spinner.text = 'SDXL model ready.';
  }

  static async _packageInstalled(pythonExe, pkg) {
    try {
      execSync(`"${pythonExe}" -c "import ${pkg}"`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // Returns true only if torch is installed AND CUDA is available
  static async _cudaAvailable(pythonExe) {
    try {
      execSync(
        `"${pythonExe}" -c "import torch; assert torch.cuda.is_available(), 'no cuda'"`,
        { stdio: 'ignore' }
      );
      return true;
    } catch {
      return false;
    }
  }
}
