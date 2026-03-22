import path from 'path';
import fs from 'fs-extra';
import { execSync, spawn } from 'child_process';
import ora from 'ora';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { ITERFORGE_HOME } from './reader.js';
import { registerTool } from './writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRIPOSR_INFER_SCRIPT = path.join(__dirname, '..', '3d', 'inference', 'triposr_infer.py');
const TRIPOSR_MARKER       = path.join(ITERFORGE_HOME, 'triposr.ok');

// Install packages directly into python-base — no separate venv, no installer.
// Uses the embeddable Python zip (no admin/MSI required).
const BASE_DIR    = path.join(ITERFORGE_HOME, 'python-base');
const BASE_PYTHON = path.join(BASE_DIR, 'python.exe');
const COMFYUI_DIR = path.join(ITERFORGE_HOME, 'comfyui');
const COMFYUI_REPO = 'https://github.com/comfyanonymous/ComfyUI.git';

// Blender 4.2 LTS — portable Windows x64 zip (no installer, no admin required).
// Extracts to a versioned subfolder; we move it to BLENDER_DIR/blender.exe.
const BLENDER_DIR     = path.join(ITERFORGE_HOME, 'blender');
const BLENDER_EXE     = path.join(BLENDER_DIR, 'blender.exe');
const BLENDER_VERSION = '4.2.3';
const BLENDER_URL     = `https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-windows-x64.zip`;

// Inkscape 1.4.3 — Windows x64 NSIS installer, silent install to AppData.
// /S = silent, /D= sets install dir (must be absolute, no trailing slash).
const INKSCAPE_DIR     = path.join(ITERFORGE_HOME, 'inkscape');
const INKSCAPE_EXE     = path.join(INKSCAPE_DIR, 'bin', 'inkscape.exe');
const INKSCAPE_VERSION = '1.4.3';
const INKSCAPE_URL     = `https://inkscape.org/release/inkscape-${INKSCAPE_VERSION}/windows/64-bit/exe/dl/`;

// ── Download & extract embeddable Python 3.11.9 (no installer needed) ────────
async function downloadPython(spinner) {
  if (await fs.pathExists(BASE_PYTHON)) {
    return BASE_PYTHON;
  }

  const EMBED_URL = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip';
  const zipDest   = path.join(ITERFORGE_HOME, 'python-embed.zip');

  spinner.text = 'Downloading Python 3.11.9 (~10 MB)...';
  await fs.ensureDir(ITERFORGE_HOME);
  // Clean any partial extract
  await fs.remove(BASE_DIR);
  await fs.ensureDir(BASE_DIR);

  const res = await fetch(EMBED_URL);
  if (!res.ok) throw new Error(`Python download failed: ${res.status}`);
  await fs.writeFile(zipDest, Buffer.from(await res.arrayBuffer()));

  spinner.text = 'Extracting Python 3.11.9...';
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipDest}' -DestinationPath '${BASE_DIR}' -Force"`,
    { stdio: 'ignore', timeout: 60_000 }
  );
  await fs.remove(zipDest);

  // Embeddable Python: enable site-packages AND add ComfyUI to sys.path.
  // NOTE: embeddable Python's ._pth file suppresses PYTHONPATH entirely —
  // the only way to add paths is by editing this file directly.
  const pthFile = path.join(BASE_DIR, 'python311._pth');
  if (await fs.pathExists(pthFile)) {
    let content = await fs.readFile(pthFile, 'utf8');
    content = content.replace('#import site', 'import site');
    // Add ComfyUI dir so 'import comfy' works when ComfyUI runs
    if (!content.includes(COMFYUI_DIR)) {
      content += `\n${COMFYUI_DIR}\n`;
    }
    await fs.writeFile(pthFile, content);
  }

  if (!(await fs.pathExists(BASE_PYTHON))) {
    throw new Error('Python extraction failed — python.exe not found after unzip.');
  }

  return BASE_PYTHON;
}

export class EnvManager {
  static async setup({ onProgress } = {}) {
    await fs.ensureDir(ITERFORGE_HOME);
    const spinner = ora('Checking managed environment...').start();

    // Mirror spinner text to optional progress callback (used by web UI)
    const _orig = Object.getOwnPropertyDescriptor(spinner, 'text') ??
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(spinner), 'text');
    let _text = '';
    Object.defineProperty(spinner, 'text', {
      get: () => _text,
      set: (v) => { _text = v; if (onProgress) onProgress(v); },
      configurable: true,
    });

    try {
      const pythonExe = await this.ensurePython(spinner);
      await this.ensureComfyUI(spinner, pythonExe);
      await this.ensureBlender(spinner);
      await this.ensureInkscape(spinner);
      await this.ensureTripoSR(spinner, pythonExe);
      spinner.succeed('Managed environment ready.');
      if (onProgress) onProgress('done');
    } catch (err) {
      spinner.fail(`Setup failed: ${err.message}`);
      throw err;
    }
  }

  // ── Step 1: ensure Python 3.11.9 with pip is ready ─────────────────────────
  static async ensurePython(spinner) {
    const basePython = await downloadPython(spinner);

    // Always ensure the ._pth file exists and is correct.
    // Embeddable Python suppresses PYTHONPATH; this file is the only way to add paths.
    // Create it from scratch if missing (e.g. manual Python extraction).
    const pthFile = path.join(BASE_DIR, 'python311._pth');
    let pth = (await fs.pathExists(pthFile))
      ? await fs.readFile(pthFile, 'utf8')
      : 'python311.zip\n.\n#import site\n';
    let changed = false;
    if (pth.includes('#import site')) { pth = pth.replace('#import site', 'import site'); changed = true; }
    if (!pth.includes(COMFYUI_DIR))   { pth += `\n${COMFYUI_DIR}\n`; changed = true; }
    if (changed || !(await fs.pathExists(pthFile))) await fs.writeFile(pthFile, pth);

    // Embeddable Python ships without pip — bootstrap it with get-pip.py
    const basePip = path.join(BASE_DIR, 'Scripts', 'pip.exe');
    if (!(await fs.pathExists(basePip))) {
      spinner.text = 'Bootstrapping pip (~2 MB)...';
      const getpipDest = path.join(ITERFORGE_HOME, 'get-pip.py');
      const r = await fetch('https://bootstrap.pypa.io/get-pip.py');
      if (!r.ok) throw new Error(`Failed to fetch get-pip.py: ${r.status}`);
      await fs.writeFile(getpipDest, Buffer.from(await r.arrayBuffer()));
      execSync(`"${basePython}" "${getpipDest}" --quiet`, { stdio: 'ignore', timeout: 60_000 });
      await fs.remove(getpipDest);
    }

    await registerTool('python', { path: basePython, version: '3.11.9', managed: true });
    return basePython;
  }

  // ── Step 2: ensure ComfyUI is cloned & deps installed ──────────────────────
  static async ensureComfyUI(spinner, pythonExe) {
    const alreadyCloned = await fs.pathExists(path.join(COMFYUI_DIR, 'main.py'));

    if (!alreadyCloned) {
      try {
        execSync('git --version', { stdio: 'ignore' });
      } catch {
        throw new Error('Git is required. Install from https://git-scm.com and retry.');
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
      spinner.text = 'Installing PyTorch with CUDA 12.1 (~2 GB, one-time)...';
      execSync(
        `"${pythonExe}" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 --force-reinstall --quiet`,
        { stdio: 'ignore', timeout: 1_800_000 }   // 30 min — large CUDA wheels
      );
    }

    // Use a marker file for the remaining deps (yaml, PIL, etc.)
    const depsMarker = path.join(ITERFORGE_HOME, 'comfyui-deps.ok');
    if (!(await fs.pathExists(depsMarker))) {
      spinner.text = 'Installing ComfyUI dependencies...';
      const reqFile = path.join(COMFYUI_DIR, 'requirements.txt');
      if (await fs.pathExists(reqFile)) {
        execSync(
          `"${pythonExe}" -m pip install -r "${reqFile}" --quiet`,
          { stdio: 'ignore', timeout: 300_000 }
        );
      }
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
    const hasModel = files.some(f => f.endsWith('.safetensors') || f.endsWith('.ckpt'));
    if (hasModel) return;

    // DreamShaper XL Lightning — stylized game art, fast (4-8 steps)
    const MODEL_URL  = 'https://huggingface.co/Lykon/dreamshaper-xl-lightning/resolve/main/DreamShaperXL_Lightning.safetensors';
    const MODEL_NAME = 'dreamshaper_xl_lightning.safetensors';
    const modelDest  = path.join(checkpointsDir, MODEL_NAME);
    const tmpDest    = modelDest + '.tmp';

    spinner.text = 'Downloading DreamShaper XL Lightning (~6.9 GB, one-time)...';

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
          spinner.text = `Downloading DreamShaper XL Lightning... ${pct}%`;
        }
      });
      res.body.pipe(out);
      res.body.on('error', reject);
      out.on('finish', resolve);
      out.on('error', reject);
    });

    await fs.rename(tmpDest, modelDest);
    spinner.text = 'DreamShaper XL ready.';
  }

  // ── Step 4: ensure Blender 4.2 LTS is installed ────────────────────────────
  static async ensureBlender(spinner) {
    // Already installed — skip
    if (await fs.pathExists(BLENDER_EXE)) {
      await registerTool('blender', { path: BLENDER_EXE, version: BLENDER_VERSION, managed: true });
      return BLENDER_EXE;
    }

    // Download portable Blender zip
    const zipDest    = path.join(ITERFORGE_HOME, 'blender.zip');
    const tmpExtract = path.join(ITERFORGE_HOME, 'blender-tmp');

    spinner.text = `Downloading Blender ${BLENDER_VERSION} LTS (~220 MB, one-time)...`;

    const res = await fetch(BLENDER_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Blender download failed: ${res.status} ${res.statusText}`);

    const total = parseInt(res.headers.get('content-length') || '0', 10);
    let received = 0;
    const out = fs.createWriteStream(zipDest);

    await new Promise((resolve, reject) => {
      res.body.on('data', chunk => {
        received += chunk.length;
        if (total) {
          const pct = ((received / total) * 100).toFixed(1);
          spinner.text = `Downloading Blender ${BLENDER_VERSION}... ${pct}%`;
        }
      });
      res.body.pipe(out);
      res.body.on('error', reject);
      out.on('finish', resolve);
      out.on('error', reject);
    });

    // Extract zip — same PowerShell approach as Python
    spinner.text = 'Extracting Blender (this takes ~30 seconds)...';
    await fs.remove(tmpExtract);
    await fs.ensureDir(tmpExtract);
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipDest}' -DestinationPath '${tmpExtract}' -Force"`,
      { stdio: 'ignore', timeout: 120_000 }
    );
    await fs.remove(zipDest);

    // Zip extracts to a versioned subfolder: blender-4.2.3-windows-x64/blender.exe
    // Move that subfolder to BLENDER_DIR so final path is BLENDER_DIR/blender.exe
    const entries = await fs.readdir(tmpExtract);
    const blenderSubdir = entries.find(e => e.toLowerCase().startsWith('blender'));
    if (!blenderSubdir) throw new Error('Blender extraction failed — no blender directory found in zip');

    await fs.remove(BLENDER_DIR);
    await fs.move(path.join(tmpExtract, blenderSubdir), BLENDER_DIR);
    await fs.remove(tmpExtract);

    if (!(await fs.pathExists(BLENDER_EXE))) {
      throw new Error('Blender installation failed — blender.exe not found after extraction');
    }

    spinner.text = `Blender ${BLENDER_VERSION} LTS ready.`;
    await registerTool('blender', { path: BLENDER_EXE, version: BLENDER_VERSION, managed: true });
    return BLENDER_EXE;
  }

  // ── Step 4: ensure Inkscape is installed ────────────────────────────────────
  static async ensureInkscape(spinner) {
    // Already in managed dir — done
    if (await fs.pathExists(INKSCAPE_EXE)) {
      await registerTool('inkscape', { path: INKSCAPE_EXE, version: INKSCAPE_VERSION, managed: true });
      return INKSCAPE_EXE;
    }

    // Check common system install locations first — copy rather than re-download
    const SYSTEM_INKSCAPE_CANDIDATES = [
      'C:\\inkscape\\bin\\inkscape.exe',            // portable install at C:\inkscape
      'C:\\Program Files\\Inkscape\\bin\\inkscape.exe',
      'C:\\Program Files (x86)\\Inkscape\\bin\\inkscape.exe',
    ];
    let systemInkscapeDir = null;
    for (const candidate of SYSTEM_INKSCAPE_CANDIDATES) {
      if (await fs.pathExists(candidate)) {
        systemInkscapeDir = path.dirname(path.dirname(candidate)); // bin/../ = root
        break;
      }
    }

    if (systemInkscapeDir) {
      // Copy existing system installation into managed directory
      spinner.text = `Copying Inkscape from ${systemInkscapeDir} (one-time)...`;
      await fs.copy(systemInkscapeDir, INKSCAPE_DIR, { overwrite: true });
    } else {
      // No system install found — download the installer and run silently
      const installerDest = path.join(ITERFORGE_HOME, 'inkscape-installer.exe');
      spinner.text = `Downloading Inkscape ${INKSCAPE_VERSION} (~100 MB, one-time)...`;

      const res = await fetch(INKSCAPE_URL, { redirect: 'follow' });
      if (!res.ok) throw new Error(`Inkscape download failed: ${res.status} ${res.statusText}`);

      const total = parseInt(res.headers.get('content-length') || '0', 10);
      let received = 0;
      const out = fs.createWriteStream(installerDest);

      await new Promise((resolve, reject) => {
        res.body.on('data', chunk => {
          received += chunk.length;
          if (total) {
            const pct = ((received / total) * 100).toFixed(1);
            spinner.text = `Downloading Inkscape ${INKSCAPE_VERSION}... ${pct}%`;
          }
        });
        res.body.pipe(out);
        res.body.on('error', reject);
        out.on('finish', resolve);
        out.on('error', reject);
      });

      // Silent NSIS install — /S silent, /D sets target dir (no quotes, no trailing slash)
      spinner.text = 'Installing Inkscape (silent)...';
      const winInstallDir = INKSCAPE_DIR.replace(/\//g, '\\');
      execSync(`"${installerDest}" /S /D=${winInstallDir}`, {
        stdio: 'ignore',
        timeout: 300_000,
      });
      await fs.remove(installerDest).catch(() => {});
    }

    if (!(await fs.pathExists(INKSCAPE_EXE))) {
      throw new Error('Inkscape setup failed — inkscape.exe not found after install');
    }

    spinner.text = `Inkscape ${INKSCAPE_VERSION} ready.`;
    await registerTool('inkscape', { path: INKSCAPE_EXE, version: INKSCAPE_VERSION, managed: true });
    return INKSCAPE_EXE;
  }

  // ── Step 5: download TripoSR deps + weights (~1 GB, MIT, one-time) ──────────
  static async ensureTripoSR(spinner, pythonExe) {
    if (await fs.pathExists(TRIPOSR_MARKER)) return;   // already done

    spinner.text = 'Installing TripoSR dependencies (~50 MB)...';

    // Run the inference script in --prefetch-only mode.
    // It installs Python deps and downloads HuggingFace weights, then exits.
    await new Promise((resolve, reject) => {
      const child = spawn(pythonExe, [TRIPOSR_INFER_SCRIPT, '--prefetch-only'], {
        windowsHide: true,
        env: { ...process.env, ITERFORGE_HOME, PYTHONUNBUFFERED: '1' },
      });

      let lastProgress = '';
      let buf = '';

      const handleLine = (line) => {
        line = line.trim();
        if (!line) return;
        if (line.startsWith('[TripoSR] PROGRESS:')) {
          const m = line.match(/PROGRESS:\s*\d+\/\d+\s*(.*)/);
          if (m) {
            lastProgress = m[1];
            spinner.text = `TripoSR: ${m[1]}`;
          }
        } else if (line.startsWith('[TripoSR] ERROR:')) {
          reject(new Error(line.slice('[TripoSR] ERROR:'.length).trim()));
        }
      };

      child.stdout?.on('data', chunk => {
        buf += chunk.toString();
        const parts = buf.split('\n'); buf = parts.pop();
        parts.forEach(handleLine);
      });

      child.on('close', async (code) => {
        if (buf.trim()) handleLine(buf);
        if (code === 0) {
          await fs.writeFile(TRIPOSR_MARKER, new Date().toISOString());
          spinner.text = 'TripoSR ready.';
          resolve();
        } else {
          // Non-zero exit but no [TripoSR] ERROR — log a warning but don't block setup
          // (TripoSR is optional; users without 6 GB VRAM won't use it)
          spinner.text = `TripoSR setup skipped (exit ${code}) — GPU may not meet requirements.`;
          resolve();
        }
      });

      child.on('error', (e) => reject(e));

      // 20-minute timeout — weights are ~1 GB on slow connections
      setTimeout(() => {
        child.kill();
        spinner.text = 'TripoSR download timed out — will retry on next launch.';
        resolve();   // don't block rest of setup
      }, 20 * 60 * 1000);
    });
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
