/**
 * triposr.js — Express routes for TripoSR 3D reconstruction
 *
 * Routes:
 *   POST /api/triposr/generate        — start a 3D reconstruction job
 *   GET  /api/triposr/:jobId          — poll job status / result
 *   GET  /api/triposr/model/:file     — serve GLB file
 *   GET  /api/triposr/preview/:file   — serve preview PNG
 */

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../env/reader.js';
import { generate3dAsset, findComfyPython } from '../../backends/triposr.js';
import { ASSETS_DIR } from './history.js';

const router = express.Router();

// ── Directories ───────────────────────────────────────────────────────────────

const TRIPOSR_OUT_DIR = path.join(ITERFORGE_HOME, '3d', 'triposr-out');

// ── In-memory job store ───────────────────────────────────────────────────────

const triposrJobs = new Map();   // jobId → { status, progress, result, error, startTime }

function makeJobId() {
  return `tsr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function scheduleCleanup(jobId) {
  // Keep completed jobs for 30 minutes so the frontend can poll
  setTimeout(() => triposrJobs.delete(jobId), 30 * 60 * 1000);
}

// ── POST /api/triposr/generate ────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    imageFilename,    // filename from a previously generated image (in ASSETS_DIR)
    imagePath: rawImagePath, // OR an absolute path
    maskPath  = null,
    resolution = 256,
  } = req.body;

  // Resolve image path
  let imagePath = rawImagePath;
  if (!imagePath && imageFilename) {
    imagePath = path.join(ASSETS_DIR, imageFilename);
  }

  if (!imagePath) {
    return res.status(400).json({ error: 'imageFilename or imagePath is required' });
  }

  if (!(await fs.pathExists(imagePath))) {
    return res.status(400).json({ error: `Image not found: ${imagePath}` });
  }

  const jobId    = makeJobId();
  const stem     = path.basename(imagePath, path.extname(imagePath)) + `_3d`;
  const startTime = Date.now();

  triposrJobs.set(jobId, {
    status:    'running',
    progress:  { n: 0, total: 10, msg: 'Queued…' },
    result:    null,
    error:     null,
    startTime,
  });

  res.json({ success: true, jobId, startTime });

  // ── Run inference async (don't await in request handler) ──────────────────
  (async () => {
    const job = triposrJobs.get(jobId);
    try {
      const pythonExe = await findComfyPython();

      const result = await generate3dAsset({
        imagePath,
        maskPath,
        resolution: Number(resolution) || 256,
        stem,
        pythonExe,
        onProgress: (n, total, msg) => {
          if (triposrJobs.has(jobId)) {
            triposrJobs.get(jobId).progress = { n, total, msg };
          }
        },
      });

      job.status = 'completed';
      job.result = result;
    } catch (err) {
      job.status = 'failed';
      job.error  = err.message;
    } finally {
      scheduleCleanup(jobId);
    }
  })();
});

// ── GET /api/triposr/prefetch (SSE) ──────────────────────────────────────────
// Streams download progress so the Settings panel can show a progress bar.
// Safe to call multiple times — huggingface_hub skips files already on disk.

import { spawn } from 'child_process';

router.get('/prefetch', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const pythonExe = await findComfyPython();

    // Find the infer script (same path resolution as generate3dAsset)
    const { fileURLToPath } = await import('url');
    const { default: path2 } = await import('path');
    const __dir = path2.dirname(fileURLToPath(import.meta.url));
    const inferScript = path2.join(__dir, '..', '..', '3d', 'inference', 'triposr_infer.py')
      .replace(/app\.asar([/\\])/g, 'app.asar.unpacked$1');

    const child = spawn(pythonExe, [inferScript, '--prefetch-only'], {
      windowsHide: true,
      env: { ...process.env, ITERFORGE_HOME, PYTHONUNBUFFERED: '1' },
    });

    let buf = '';
    const handleLine = (line) => {
      line = line.trim();
      if (!line) return;
      if (line.startsWith('[TripoSR] PROGRESS:')) {
        const m = line.match(/PROGRESS:\s*(\d+)\/(\d+)\s*(.*)/);
        if (m) emit({ type: 'progress', n: Number(m[1]), total: Number(m[2]), msg: m[3] });
      } else if (line.startsWith('[TripoSR] DONE:')) {
        emit({ type: 'done' });
      } else if (line.startsWith('[TripoSR] ERROR:')) {
        emit({ type: 'error', msg: line.slice('[TripoSR] ERROR:'.length).trim() });
      } else {
        emit({ type: 'log', msg: line });
      }
    };

    child.stdout?.on('data', chunk => {
      buf += chunk.toString();
      const parts = buf.split('\n'); buf = parts.pop();
      parts.forEach(handleLine);
    });
    child.stderr?.on('data', chunk => {
      chunk.toString().split('\n').filter(Boolean).forEach(l => emit({ type: 'log', msg: l }));
    });
    child.on('close', () => { if (buf.trim()) handleLine(buf); res.end(); });
    child.on('error', (e) => { emit({ type: 'error', msg: e.message }); res.end(); });

    req.on('close', () => child.kill());
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', msg: e.message })}\n\n`);
    res.end();
  }
});

// ── GET /api/triposr/status ───────────────────────────────────────────────────
// Quick check — are weights already downloaded?

router.get('/status', async (req, res) => {
  const weightsDir = path.join(ITERFORGE_HOME, '3d', 'weights', 'triposr');
  const modelCkpt  = path.join(weightsDir, 'model.ckpt');
  const configYaml = path.join(weightsDir, 'config.yaml');
  const downloaded = (await fs.pathExists(modelCkpt)) && (await fs.pathExists(configYaml));
  const pythonExe  = await findComfyPython().catch(() => null);
  res.json({ downloaded, weightsDir, pythonExe });
});

// ── GET /api/triposr/:jobId ───────────────────────────────────────────────────

router.get('/:jobId', (req, res) => {
  // Skip file-serving routes
  if (req.params.jobId === 'model' || req.params.jobId === 'preview') {
    return res.status(400).json({ error: 'Use /model/:file or /preview/:file' });
  }

  const job = triposrJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { status, progress, result, error, startTime } = job;

  if (status === 'running') {
    return res.json({ status, progress, startTime });
  }

  if (status === 'completed') {
    const glbFile     = result?.glbPath     ? path.basename(result.glbPath)     : null;
    const previewFile = result?.previewPath ? path.basename(result.previewPath) : null;
    return res.json({
      status,
      startTime,
      result: {
        ...result,
        glbUrl:     glbFile     ? `/api/triposr/model/${glbFile}`   : null,
        previewUrl: previewFile ? `/api/triposr/preview/${previewFile}` : null,
      },
    });
  }

  // failed
  return res.json({ status, error, startTime });
});

// ── GET /api/triposr/model/:file ──────────────────────────────────────────────

router.get('/model/:file', async (req, res) => {
  const filePath = path.join(TRIPOSR_OUT_DIR, path.basename(req.params.file));
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'GLB not found' });
  }
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.sendFile(filePath);
});

// ── GET /api/triposr/preview/:file ────────────────────────────────────────────

router.get('/preview/:file', async (req, res) => {
  const filePath = path.join(TRIPOSR_OUT_DIR, path.basename(req.params.file));
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'Preview not found' });
  }
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(filePath);
});

export default router;
