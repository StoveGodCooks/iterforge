/**
 * masterforge.js — Express route handler for the MasterForge 3D pipeline.
 *
 * Routes:
 *   POST /api/masterforge/generate          — start a mesh generation job
 *   GET  /api/masterforge/status            — pipeline availability check
 *   GET  /api/masterforge/asset-types       — list supported asset type configs
 *   GET  /api/masterforge/job/:jobId        — poll job status
 *   GET  /api/masterforge/model/:jobId/:file — serve any output file (GLB/STL/DXF/PNG)
 */

import express        from 'express';
import path           from 'path';
import fs             from 'fs-extra';
import multer         from 'multer';
import { fileURLToPath } from 'url';
import { BLENDER_ASSETS_DIR } from '../../env/reader.js';
import {
  generateMesh,
  findPython,
  MASTERFORGE_ASSET_TYPES,
  RUN_PY,
} from '../../backends/masterforge.js';
import { ASSETS_DIR, writeHistory } from './history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// Multer for direct image uploads to MasterForge
const upload = multer({ dest: ASSETS_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

// Output directory — one sub-folder per job
const MF_DIR = path.join(BLENDER_ASSETS_DIR, 'masterforge');

// In-memory job store  { [jobId]: { status, progress?, result?, error? } }
const mfJobs    = new Map();
let   mfRunning = false;
let   mfRunStart = 0;          // timestamp when lock was acquired
const MF_LOCK_TIMEOUT = 12 * 60 * 1000; // 12 min — auto-clear a stuck lock

function isMfLocked() {
  if (!mfRunning) return false;
  if (Date.now() - mfRunStart > MF_LOCK_TIMEOUT) {
    console.warn('[MasterForge] Lock auto-cleared after timeout');
    mfRunning = false;
    return false;
  }
  return true;
}

function scheduleCleanup(jobId) {
  setTimeout(() => mfJobs.delete(jobId), 10 * 60 * 1000);
}

// ── POST /api/masterforge/upload-image — save a local image into ASSETS_DIR ──
router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const dest = path.join(ASSETS_DIR, `${req.file.filename}${ext}`);
    await fs.move(req.file.path, dest, { overwrite: true });
    res.json({ success: true, filename: path.basename(dest) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/masterforge/generate ───────────────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    if (isMfLocked()) {
      return res.status(409).json({ error: 'A MasterForge job is already running. Please wait.' });
    }

    const {
      imagePath,
      imageFilename,
      assetType = 'sword',
      useMidas  = false,
      noLod     = false,
      noDxf     = false,
    } = req.body;

    // ── Resolve image path ─────────────────────────────────────────────────
    let resolvedImage = imagePath ?? null;
    if (imageFilename) {
      const fn = path.basename(imageFilename);
      const candidates = [
        path.join(ASSETS_DIR, fn),
        path.join(ASSETS_DIR, 'frames', fn),
      ];
      resolvedImage = candidates.find(p => fs.pathExistsSync(p)) ?? candidates[0];
    }
    if (!resolvedImage || !(await fs.pathExists(resolvedImage))) {
      return res.status(400).json({ error: `Image not found: ${resolvedImage}` });
    }

    // ── Create job ─────────────────────────────────────────────────────────
    const jobId  = `mf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobDir = path.join(MF_DIR, jobId);
    await fs.ensureDir(jobDir);

    mfJobs.set(jobId, {
      status:    'running',
      progress:  'Starting MasterForge...',
      startTime: Date.now(),
      assetType,
    });
    res.json({ success: true, jobId, assetType });

    // ── Run pipeline asynchronously ────────────────────────────────────────
    mfRunning  = true;
    mfRunStart = Date.now();
    try {
      const result = await generateMesh({
        imagePath: resolvedImage,
        assetType,
        outputDir: jobDir,
        useMidas:  Boolean(useMidas),
        noLod:     Boolean(noLod),
        noDxf:     Boolean(noDxf),
        onLog: (line) => {
          if (mfJobs.has(jobId)) {
            mfJobs.get(jobId).progress = line.slice(0, 140);
          }
        },
      });

      // Write debug log
      const logPath = path.join(jobDir, 'masterforge.log');
      await fs.writeFile(
        logPath,
        `EXIT ${result.exitCode}\n\n--- STDOUT ---\n${result.stdout}\n--- STDERR ---\n${result.stderr}`
      ).catch(() => {});

      if (!result.success) {
        const lastStderr = result.stderr?.slice(-2000) || '';
        mfJobs.set(jobId, {
          status: 'failed',
          error:  `MasterForge exited ${result.exitCode}: ${lastStderr.split('\n').pop()}`,
          stderr: lastStderr,
          fullError: result.stderr
        });
        scheduleCleanup(jobId);
        return;
      }

      // ── Scan outputs ───────────────────────────────────────────────────
      const files = await fs.readdir(jobDir);

      const glbFile   = files.find(f => f.endsWith('.glb'));
      const stlFile   = files.find(f => f.endsWith('.stl') && !f.includes('_lod'));
      const dxfFile   = files.find(f => f.endsWith('.dxf'));
      const texFile   = files.find(f => f.endsWith('_tex.png'));
      const zonesFile = files.find(f => f.endsWith('_zones.json'));
      const lodFiles  = files.filter(f => /_lod\d+\.stl$/.test(f)).sort();

      // Read zones summary if available
      let zonesSummary = null;
      if (zonesFile) {
        try {
          zonesSummary = JSON.parse(
            await fs.readFile(path.join(jobDir, zonesFile), 'utf-8')
          );
        } catch { /* non-fatal */ }
      }

      const historyEntry = {
        id:           jobId,
        type:         'masterforge',
        assetType,
        filename:     glbFile ?? stlFile ?? '',
        glbFile,
        stlFile,
        dxfFile,
        texFile,
        lodFiles,
        zonesFile,
        zonesSummary,
        jobDir,
        sourcePng:    resolvedImage,
        timestamp:    Date.now(),
        prompt:       `MasterForge ${assetType}: ${path.basename(resolvedImage)}`,
        backend:      'masterforge-0.1.0',
        params:       { assetType, useMidas, noLod, noDxf },
      };

      await writeHistory(h => [historyEntry, ...h]);
      mfJobs.set(jobId, { status: 'completed', result: historyEntry });
      scheduleCleanup(jobId);

    } catch (err) {
      mfJobs.set(jobId, { status: 'failed', error: err.message });
      scheduleCleanup(jobId);
    } finally {
      mfRunning = false;
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/masterforge/status ───────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const pythonExe = findPython();
    const pyExists  = await fs.pathExists(pythonExe).catch(() => false);
    const runExists = await fs.pathExists(RUN_PY).catch(() => false);
    res.json({
      available:     pyExists && runExists,
      python:        pythonExe,
      pythonFound:   pyExists,
      runPy:         RUN_PY,
      runPyFound:    runExists,
      assetTypes:    MASTERFORGE_ASSET_TYPES,
      busy:          isMfLocked(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/masterforge/reset-lock — force-clear a stuck running lock ───────
router.post('/reset-lock', (_req, res) => {
  mfRunning  = false;
  mfRunStart = 0;
  res.json({ success: true, message: 'Lock cleared' });
});

// ── GET /api/masterforge/asset-types ─────────────────────────────────────────
router.get('/asset-types', (_req, res) => {
  res.json({ types: MASTERFORGE_ASSET_TYPES });
});

// ── GET /api/masterforge/model/:jobId/:filename — serve any output file ───────
router.get('/model/:jobId/:filename', async (req, res) => {
  const { jobId, filename } = req.params;
  const safe     = path.basename(filename);
  const filePath = path.join(MF_DIR, jobId, safe);

  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'File not found' });
  }

  const ext = path.extname(safe).toLowerCase();
  const contentTypes = {
    '.glb': 'model/gltf-binary',
    '.stl': 'application/sla',
    '.dxf': 'application/dxf',
    '.png': 'image/png',
    '.npz': 'application/octet-stream',
    '.json': 'application/json',
  };
  res.setHeader('Content-Type', contentTypes[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');

  // Force download for DXF and STL
  if (ext === '.dxf' || ext === '.stl') {
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  }

  res.sendFile(filePath);
});

// ── GET /api/masterforge/job/:jobId — poll status ─────────────────────────────
router.get('/job/:jobId', (req, res) => {
  const job = mfJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

export default router;
