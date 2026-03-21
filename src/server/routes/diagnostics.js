/**
 * diagnostics.js — Inter-Forge comprehensive test suite
 *
 * GET /api/diagnostics/run  — SSE stream of all diagnostic tests
 * GET /api/diagnostics/blender-log/:id — fetch stored blender output
 */

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ITERFORGE_HOME, BLENDER_ASSETS_DIR, ENV_PATH } from '../../env/reader.js';
import { detectBlender } from '../../backends/blender.js';
import { detectInkscape, MANAGED_INKSCAPE_EXE } from '../../backends/inkscape.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// External processes can't read from inside app.asar — redirect to unpacked copy
function unpackedPath(p) {
  return p.replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');
}

const MANAGED_BLENDER_EXE = path.join(ITERFORGE_HOME, 'blender', 'blender.exe');
const COMFYUI_DIR         = path.join(ITERFORGE_HOME, 'comfyui');
const PYTHON_EXE          = path.join(ITERFORGE_HOME, 'python-base', 'python.exe');
const ASSETS_DIR          = path.join(ITERFORGE_HOME, 'assets', 'generated');
const APPLY_SCRIPT        = unpackedPath(path.join(__dirname, '..', '..', '3d', 'templates', 'apply_texture.py'));

// Stored blender logs by run ID (TTL: 10 min)
const storedLogs = new Map();

// ── SSE helper ────────────────────────────────────────────────────────────────
function sseEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Test runner ───────────────────────────────────────────────────────────────
router.get('/run', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (category, status, label, detail = null) => {
    sseEvent(res, { category, status, label, detail, ts: Date.now() });
  };

  try {
    // ── 1. System info ──────────────────────────────────────────────────────
    emit('system', 'info', 'Platform', `${os.platform()} ${os.release()} (${os.arch()})`);
    emit('system', 'info', 'Node.js', process.version);
    emit('system', 'info', 'CWD', process.cwd());
    emit('system', 'info', 'ITERFORGE_HOME', ITERFORGE_HOME);

    // ── 2. ITERFORGE_HOME directory ─────────────────────────────────────────
    const homeExists = await fs.pathExists(ITERFORGE_HOME);
    emit('filesystem', homeExists ? 'pass' : 'fail', 'ITERFORGE_HOME exists', ITERFORGE_HOME);

    // ── 3. env.json ─────────────────────────────────────────────────────────
    const envExists = await fs.pathExists(ENV_PATH);
    emit('filesystem', envExists ? 'pass' : 'fail', 'env.json exists', ENV_PATH);
    if (envExists) {
      try {
        const env = await fs.readJson(ENV_PATH);
        emit('filesystem', 'pass', 'env.json valid JSON',
          JSON.stringify(env, null, 2).slice(0, 800));
      } catch (e) {
        emit('filesystem', 'fail', 'env.json parse error', e.message);
      }
    }

    // ── 4. Key directories ──────────────────────────────────────────────────
    const dirs = [
      ['assets/generated', ASSETS_DIR],
      ['3d/models',   path.join(BLENDER_ASSETS_DIR, 'models')],
      ['3d/blends',   path.join(BLENDER_ASSETS_DIR, 'blends')],
      ['3d/previews', path.join(BLENDER_ASSETS_DIR, 'previews')],
      ['comfyui',     COMFYUI_DIR],
      ['python-base', path.join(ITERFORGE_HOME, 'python-base')],
    ];
    for (const [label, dirPath] of dirs) {
      const exists = await fs.pathExists(dirPath);
      emit('filesystem', exists ? 'pass' : 'warn', `Dir: ${label}`, dirPath);
    }

    // ── 5. Python ───────────────────────────────────────────────────────────
    const pythonExists = await fs.pathExists(PYTHON_EXE);
    emit('python', pythonExists ? 'pass' : 'fail', 'python.exe exists', PYTHON_EXE);
    if (pythonExists) {
      try {
        const ver = execSync(`"${PYTHON_EXE}" --version 2>&1`, { timeout: 5000 }).toString().trim();
        emit('python', 'pass', 'python --version', ver);
      } catch (e) {
        emit('python', 'fail', 'python --version failed', e.message);
      }
    }

    // ── 6. Blender exe ──────────────────────────────────────────────────────
    const blenderExeExists = await fs.pathExists(MANAGED_BLENDER_EXE);
    emit('blender', blenderExeExists ? 'pass' : 'fail', 'blender.exe exists', MANAGED_BLENDER_EXE);

    // ── 7. detectBlender() ──────────────────────────────────────────────────
    const blenderInfo = await detectBlender(null);
    emit('blender', blenderInfo.found ? 'pass' : 'fail', 'detectBlender()',
      JSON.stringify(blenderInfo, null, 2));

    // ── 8. blender --version ─────────────────────────────────────────────────
    if (blenderInfo.found) {
      emit('blender', 'running', 'blender --version');
      await new Promise(resolve => {
        const child = spawn(blenderInfo.path, ['--version'], { windowsHide: true });
        let out = '';
        child.stdout?.on('data', d => { out += d.toString(); });
        child.stderr?.on('data', d => { out += d.toString(); });
        child.on('close', code => {
          emit('blender', code === 0 ? 'pass' : 'fail', 'blender --version', out.trim());
          resolve();
        });
        child.on('error', err => {
          emit('blender', 'fail', 'blender --version error', err.message);
          resolve();
        });
        setTimeout(() => { child.kill(); emit('blender', 'fail', 'blender --version', 'TIMEOUT'); resolve(); }, 8000);
      });

      // ── 9. apply_texture.py script exists ──────────────────────────────
      const scriptExists = await fs.pathExists(APPLY_SCRIPT);
      emit('blender', scriptExists ? 'pass' : 'fail', 'apply_texture.py exists', APPLY_SCRIPT);

      // ── 10. Generate test PNG (1x1 red pixel) ──────────────────────────
      const testTexture = path.join(ITERFORGE_HOME, 'tmp', '_diag_test.png');
      await fs.ensureDir(path.dirname(testTexture));
      // Write a minimal valid 1×1 red PNG (hardcoded bytes)
      const redPixelPng = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
        '2e00000000c4944415478016360f8cf0000000200019ee21600000000049454e44ae426082', 'hex'
      );
      await fs.writeFile(testTexture, redPixelPng);
      emit('blender', 'pass', 'Test texture created', testTexture);

      // ── 11. Full Blender headless test ──────────────────────────────────
      const testGlb   = path.join(ITERFORGE_HOME, 'tmp', '_diag_test.glb');
      const testBlend = path.join(ITERFORGE_HOME, 'tmp', '_diag_test.blend');
      emit('blender', 'running', 'Blender headless test (apply texture → GLB)…');

      const runId = `diag-${Date.now()}`;
      let blenderLog = '';

      await new Promise(resolve => {
        const args = [
          '--background',
          '--python', APPLY_SCRIPT,
          '--', 'cube', testTexture, testGlb, testBlend,
        ];
        const child = spawn(blenderInfo.path, args, { windowsHide: true });

        child.stdout?.on('data', d => {
          blenderLog += d.toString();
          // Stream each line live
          d.toString().split('\n').filter(Boolean).forEach(line => {
            emit('blender', 'log', line);
          });
        });
        child.stderr?.on('data', d => {
          blenderLog += d.toString();
          d.toString().split('\n').filter(Boolean).forEach(line => {
            emit('blender', 'log', line);
          });
        });

        child.on('close', async code => {
          storedLogs.set(runId, blenderLog);
          setTimeout(() => storedLogs.delete(runId), 10 * 60 * 1000);

          const glbCreated   = await fs.pathExists(testGlb);
          const blendCreated = await fs.pathExists(testBlend);

          if (code === 0 && glbCreated) {
            const glbStat = await fs.stat(testGlb);
            emit('blender', 'pass', `Blender exited OK (code 0)  GLB: ${(glbStat.size / 1024).toFixed(1)} KB`, `runId: ${runId}`);
          } else {
            emit('blender', 'fail', `Blender exited code ${code}  GLB created: ${glbCreated}  .blend created: ${blendCreated}`,
              `See full log above ↑  runId: ${runId}`);
          }

          if (glbCreated) emit('blender', 'pass', 'GLB file created', testGlb);
          else            emit('blender', 'fail', 'GLB file NOT created', testGlb);

          if (blendCreated) emit('blender', 'pass', '.blend file created', testBlend);
          else              emit('blender', 'warn', '.blend file NOT created', testBlend);

          // Cleanup test files
          await fs.remove(testTexture).catch(() => {});
          await fs.remove(testGlb).catch(() => {});
          await fs.remove(testBlend).catch(() => {});
          resolve();
        });

        child.on('error', err => {
          emit('blender', 'fail', 'spawn error', err.message);
          resolve();
        });

        // 3-minute timeout for Blender (first run is slow — compiling shaders)
        setTimeout(() => {
          child.kill();
          emit('blender', 'fail', 'Blender test TIMED OUT after 3 minutes');
          resolve();
        }, 3 * 60 * 1000);
      });
    } else {
      emit('blender', 'skip', 'Skipping Blender tests — blender.exe not found');
    }

    // ── 12. Inkscape ────────────────────────────────────────────────────────
    const inkscapeExeExists = await fs.pathExists(MANAGED_INKSCAPE_EXE);
    emit('inkscape', inkscapeExeExists ? 'pass' : 'warn', 'inkscape.exe (managed)', MANAGED_INKSCAPE_EXE);
    const inkscapeInfo = await detectInkscape(null);
    emit('inkscape', inkscapeInfo.found ? 'pass' : 'warn', 'detectInkscape()',
      JSON.stringify(inkscapeInfo, null, 2));
    if (inkscapeInfo.found) {
      emit('inkscape', 'running', 'inkscape --version');
      await new Promise(resolve => {
        const child = spawn(inkscapeInfo.path, ['--version'], { windowsHide: true });
        let out = '';
        child.stdout?.on('data', d => { out += d.toString(); });
        child.stderr?.on('data', d => { out += d.toString(); });
        child.on('close', code => {
          emit('inkscape', code === 0 ? 'pass' : 'fail', 'inkscape --version', out.trim());
          resolve();
        });
        child.on('error', err => { emit('inkscape', 'fail', 'inkscape --version error', err.message); resolve(); });
        setTimeout(() => { child.kill(); emit('inkscape', 'warn', 'inkscape --version TIMEOUT'); resolve(); }, 8000);
      });
    }

    // ── 13. ComfyUI reachable ───────────────────────────────────────────────
    emit('comfyui', 'running', 'Checking ComfyUI at http://127.0.0.1:8188…');
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch('http://127.0.0.1:8188/system_stats', { signal: ctrl.signal });
      clearTimeout(tid);
      const data = await r.json();
      emit('comfyui', 'pass', 'ComfyUI reachable', JSON.stringify(data, null, 2).slice(0, 400));
    } catch (e) {
      emit('comfyui', e.name === 'AbortError' ? 'warn' : 'fail', 'ComfyUI not reachable', e.message);
    }

    // ── 13. Internal API routes ─────────────────────────────────────────────
    const baseUrl = `http://127.0.0.1:${process.env.SERVER_PORT || 3000}`;
    const routes = [
      ['GET', '/api/status'],
      ['GET', '/api/blender/status'],
      ['GET', '/api/inkscape/status'],
      ['GET', '/api/history'],
    ];
    for (const [method, route] of routes) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch(`${baseUrl}${route}`, { method, signal: ctrl.signal });
        clearTimeout(tid);
        const text = await r.text();
        emit('api', r.ok ? 'pass' : 'fail', `${method} ${route} → ${r.status}`,
          text.slice(0, 300));
      } catch (e) {
        emit('api', 'fail', `${method} ${route} failed`, e.message);
      }
    }

    // ── Done ────────────────────────────────────────────────────────────────
    emit('done', 'done', 'Diagnostics complete');

  } catch (err) {
    emit('error', 'fail', 'Diagnostics runner crashed', err.stack || err.message);
  } finally {
    res.end();
  }
});

// ── GET stored blender log ────────────────────────────────────────────────────
router.get('/blender-log/:id', (req, res) => {
  const log = storedLogs.get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Log not found or expired' });
  res.setHeader('Content-Type', 'text/plain');
  res.send(log);
});

export default router;
