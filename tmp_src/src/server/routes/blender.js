/**
 * blender.js — Express route handler for Blender 3D integration
 *
 * Routes:
 *   POST /api/blender/apply-mesh    — headless texture-to-mesh job (generic presets)
 *   POST /api/blender/sword-asset   — professional sword pipeline (sword_asset.py)
 *   GET  /api/blender/:jobId        — poll job status
 *   POST /api/blender/open-gui      — open full Blender GUI + start file watcher
 *   GET  /api/blender/model/:file   — serve GLB file
 *   GET  /api/blender/preview/:file — serve preview PNG
 */

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { ITERFORGE_HOME, BLENDER_ASSETS_DIR } from '../../env/reader.js';
import {
  detectBlender,
  applyTexture,
  exportFromBlend,
  openGui,
  watchBlend,
} from '../../backends/blender.js';
import { writeHistory, ASSETS_DIR } from './history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// ── Directories ──────────────────────────────────────────────────────────────
const MODELS_DIR   = path.join(BLENDER_ASSETS_DIR, 'models');    // GLB output
const PREVIEWS_DIR = path.join(BLENDER_ASSETS_DIR, 'previews');  // PNG previews
const BLENDS_DIR   = path.join(BLENDER_ASSETS_DIR, 'blends');    // .blend files
const UPLOADS_DIR  = path.join(ITERFORGE_HOME, 'tmp', 'blender-uploads');

// Multer for custom mesh uploads
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 100 * 1024 * 1024 } });

// ── In-memory job store ──────────────────────────────────────────────────────
const blenderJobs = new Map();
let   blenderRunning = false;    // single-job gate

// Active file watchers by blendFile path
const activeWatchers = new Map();  // blendFile → { watcher, jobId }

function scheduleJobCleanup(jobId) {
  setTimeout(() => blenderJobs.delete(jobId), 10 * 60 * 1000);
}

// ── Helper: read blenderPath from settings header or env ─────────────────────
function getSettingsPath(req) {
  // Frontend sends x-blender-path header from localStorage settings
  return req.headers['x-blender-path'] || null;
}

// ── POST /api/blender/apply-mesh ─────────────────────────────────────────────
router.post('/apply-mesh', upload.single('customMesh'), async (req, res) => {
  try {
    // Gate: only one Blender job at a time
    if (blenderRunning) {
      return res.status(409).json({ error: 'A 3D job is already running. Please wait.' });
    }

    const {
      meshType        = 'cube',
      texturePath,          // absolute path from a previously generated image
      exportFormat    = 'glb',
      subdivisionLevel = 1,
      textureRotation  = 0,
    } = req.body;

    // Resolve texture path — frontend sends '__API__:<filename>' for generated images
    if (!texturePath) {
      return res.status(400).json({ error: 'texturePath is required' });
    }
    let resolvedTexturePath = texturePath;
    if (texturePath.startsWith('__API__:')) {
      const filename = path.basename(texturePath.slice('__API__:'.length));
      // Try generated assets dir first, then frames subdir
      const candidates = [
        path.join(ASSETS_DIR, filename),
        path.join(ASSETS_DIR, 'frames', filename),
      ];
      resolvedTexturePath = candidates.find(p => fs.pathExistsSync(p)) ?? candidates[0];
    }
    if (!(await fs.pathExists(resolvedTexturePath))) {
      return res.status(400).json({ error: `Texture file not found: ${resolvedTexturePath}` });
    }

    // Detect Blender
    const settingsPath = getSettingsPath(req);
    const blenderInfo  = await detectBlender(settingsPath);
    if (!blenderInfo.found) {
      return res.status(503).json({
        error:     'Blender not found',
        notFound:  true,
        message:   'Set the Blender path in Settings to enable 3D generation.',
      });
    }

    // Handle custom mesh upload
    let resolvedMeshType = meshType;
    if (req.file) {
      resolvedMeshType = `custom:${req.file.path}`;
    }

    // Build output paths
    const jobId     = `blender-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const slug      = meshType.replace(/[^a-z0-9]/gi, '_').slice(0, 20);
    const baseName  = `${slug}_${jobId}`;
    const outputGlb    = path.join(MODELS_DIR,   `${baseName}.glb`);
    const outputBlend  = path.join(BLENDS_DIR,   `${baseName}.blend`);
    const outputPreview = path.join(PREVIEWS_DIR, `${baseName}_preview.png`);

    // Create job record and respond immediately
    blenderJobs.set(jobId, {
      status:   'running',
      meshType: resolvedMeshType,
      progress: 'Starting Blender…',
      startTime: Date.now(),
    });
    res.json({ success: true, jobId });

    // Run headless Blender asynchronously
    blenderRunning = true;
    try {
      await fs.ensureDir(MODELS_DIR);
      await fs.ensureDir(BLENDS_DIR);
      await fs.ensureDir(PREVIEWS_DIR);

      const result = await applyTexture({
        blenderExe:       blenderInfo.path,
        meshType:         resolvedMeshType,
        texturePath:      resolvedTexturePath,
        outputGlb,
        outputBlend,
        subdivisionLevel: parseInt(subdivisionLevel) || 1,
        rotationDeg:      parseInt(textureRotation) || 0,
        onLog: (line) => {
          if (blenderJobs.has(jobId)) {
            blenderJobs.get(jobId).progress = line.slice(0, 120);
          }
        },
      });

      if (!result.success) {
        blenderJobs.set(jobId, {
          status: 'failed',
          error:  `Blender exited with code ${result.exitCode}`,
          stderr: result.stderr?.slice(-2000),
        });
        scheduleJobCleanup(jobId);
        return;
      }

      const previewExists = await fs.pathExists(outputPreview);
      const previewFilename = previewExists ? path.basename(outputPreview) : null;

      const historyEntry = {
        id:          jobId,
        type:        '3d',
        meshType:    meshType,
        filename:    path.basename(outputGlb),
        blendPath:   outputBlend,
        previewFilename,
        previewPath: previewExists ? outputPreview : null,
        texturePath: resolvedTexturePath,
        timestamp: Date.now(),
        prompt:    `3D: ${meshType} + ${path.basename(resolvedTexturePath)}`,
        seed:      null,
        backend:   `blender-${blenderInfo.version ?? 'unknown'}`,
        params:    { meshType, exportFormat },
      };

      await writeHistory(h => [historyEntry, ...h]);

      blenderJobs.set(jobId, {
        status: 'completed',
        result: historyEntry,
      });
      scheduleJobCleanup(jobId);

    } catch (err) {
      blenderJobs.set(jobId, { status: 'failed', error: err.message });
      scheduleJobCleanup(jobId);
    } finally {
      blenderRunning = false;
      // Clean up uploaded temp mesh if any
      if (req.file) fs.remove(req.file.path).catch(() => {});
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/blender/status — check Blender availability ─────────────────────
router.get('/status', async (req, res) => {
  try {
    const settingsPath = getSettingsPath(req);
    const info = await detectBlender(settingsPath);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/blender/:jobId — poll status ────────────────────────────────────
router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = blenderJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── POST /api/blender/open-gui ───────────────────────────────────────────────
router.post('/open-gui', async (req, res) => {
  try {
    const { blendFile } = req.body;
    if (!blendFile) return res.status(400).json({ error: 'blendFile is required' });
    if (!(await fs.pathExists(blendFile))) {
      return res.status(404).json({ error: `Blend file not found: ${blendFile}` });
    }

    const settingsPath = getSettingsPath(req);
    const blenderInfo  = await detectBlender(settingsPath);
    if (!blenderInfo.found) {
      return res.status(503).json({ error: 'Blender not found', notFound: true });
    }

    // Open Blender GUI
    const { pid } = openGui({ blenderExe: blenderInfo.path, blendFile });

    // Determine GLB output path from blendFile (same name, .glb ext)
    const outputGlb = blendFile.replace(/\.blend$/, '.glb');

    // Stop any existing watcher on this blend file
    if (activeWatchers.has(blendFile)) {
      activeWatchers.get(blendFile).watcher.stop();
    }

    // Start file watcher for live sync
    const watcher = watchBlend(blendFile, async () => {
      console.log(`[Inter-Forge] .blend changed — re-exporting ${outputGlb}`);
      try {
        await exportFromBlend({
          blenderExe: blenderInfo.path,
          blendFile,
          outputGlb,
        });
        // Touch the GLB so the frontend's ?t= cache buster picks it up
        const now = new Date();
        await fs.utimes(outputGlb, now, now);
        console.log('[Inter-Forge] Live sync re-export complete');
      } catch (err) {
        console.warn('[Inter-Forge] Live sync re-export failed:', err.message);
      }
    });

    // Auto-cleanup watcher after 2 hours of inactivity
    const watcherEntry = { watcher, pid };
    activeWatchers.set(blendFile, watcherEntry);
    setTimeout(() => {
      if (activeWatchers.get(blendFile) === watcherEntry) {
        watcher.stop();
        activeWatchers.delete(blendFile);
      }
    }, 2 * 60 * 60 * 1000);

    res.json({ success: true, pid, watchActive: true, blendFile });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/blender/model/:filename — serve GLB ─────────────────────────────
router.get('/model/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(MODELS_DIR, filename);
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'Model not found' });
  }
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(filePath);
});

// ── GET /api/blender/preview/:filename — serve preview PNG ───────────────────
router.get('/preview/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(PREVIEWS_DIR, filename);
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'Preview not found' });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(filePath);
});

export default router;
