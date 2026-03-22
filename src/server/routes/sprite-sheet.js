import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import sharp from 'sharp';
import { MasterForgePipeline } from '../../pipeline/orchestrator.js';
import { ASSETS_DIR, writeHistory } from './history.js';
import { 
  SPRITE_POSITIVE_PREFIX, 
  SPRITE_NEGATIVE_SUFFIX, 
  getPoseSuffixes,
  POSE_SETS 
} from '../../pipeline/spriteConstants.js';

const router = express.Router();

// In-memory job store for sprite sheet batch jobs
const sheetJobs = new Map();

// TTL cleanup — remove completed/failed jobs after 10 minutes
function scheduleSheetJobCleanup(jobId) {
  setTimeout(() => sheetJobs.delete(jobId), 10 * 60 * 1000);
}

// Grid layout definitions: { cols, rows }
const GRID_LAYOUTS = {
  '2x2': { cols: 2, rows: 2 },
  '3x2': { cols: 3, rows: 2 },
  '3x3': { cols: 3, rows: 3 },
  '4x4': { cols: 4, rows: 4 },
  '2x4': { cols: 2, rows: 4 },
  '4x2': { cols: 4, rows: 2 },
  '1x4': { cols: 1, rows: 4 },
  '4x1': { cols: 4, rows: 1 },
};

// ── POST /api/sprite-sheet ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      prompt         = '',
      gridLayout     = '2x2',
      width          = 512,
      assetType      = 'character',
      artStyle       = 'stylized',
      subject        = '',
      ipadapterWeight = null,
      lockedRef      = null, // path to the locked FORGE image
    } = req.body;

    if (!lockedRef) {
      return res.status(400).json({ error: 'lockedRef (source image) is required' });
    }

    const layout = GRID_LAYOUTS[gridLayout] ?? GRID_LAYOUTS['2x2'];
    const frameCount = layout.cols * layout.rows;
    const jobId = `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    sheetJobs.set(jobId, {
      status: 'pending',
      progress: { completed: 0, total: frameCount },
      startTime: Date.now(),
    });

    res.json({ success: true, jobId, frameCount });

    // Run via Orchestrator
    (async () => {
      try {
        const result = await MasterForgePipeline.run({
          generate:    { enabled: false },
          multiview:   { enabled: false },
          forge:       { enabled: false },
          spriteSheet: {
            enabled:         true,
            preset:          'custom',
            frames:          frameCount,
            frameSize:       Number(width),
            lockedRef:       lockedRef,
            ipadapterWeight: ipadapterWeight,
          },
          deliver: { enabled: true, history: true, godot_sync: true },
          intent:    subject.trim() || prompt.trim(),
          assetType: assetType,
          artStyle:  artStyle,
        }, (progress) => {
          if (progress.stage === 'spriteSheet' && progress.progress) {
            sheetJobs.set(jobId, {
              ...sheetJobs.get(jobId),
              status: 'running',
              progress: progress.progress
            });
          }
        });

        sheetJobs.set(jobId, { 
          status: 'completed', 
          result: result.outputs?.history ?? result.outputs?.spriteSheet ?? result 
        });
        scheduleSheetJobCleanup(jobId);

      } catch (err) {
        console.error(`[SpriteSheet] Pipeline failed for ${jobId}:`, err.message);
        
        let errorData = err.message;
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.type === 'QUALITY_GATE_FAILURE') {
            errorData = parsed;
          }
        } catch { /* not JSON, use raw string */ }

        sheetJobs.set(jobId, { 
          status: 'failed', 
          error: typeof errorData === 'string' ? errorData : 'Quality Gate Failure',
          diagnostic: typeof errorData === 'object' ? errorData : null
        });
        scheduleSheetJobCleanup(jobId);
      }
    })();

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sprite-sheet/:jobId  (poll status) ───────────────────────────────
router.get('/:jobId', (req, res) => {
  const job = sheetJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── GET /api/sprite-sheet/frame/:filename  — serve individual frame PNG ───────
router.get('/frame/:filename', async (req, res) => {
  const framesDir = path.join(ASSETS_DIR, 'frames');
  const filePath  = path.join(framesDir, path.basename(req.params.filename));
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'Frame not found' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(filePath);
});

// ── POST /api/sprite-sheet/compose  — re-composite frames in custom order ─────
router.post('/compose', async (req, res) => {
  try {
    const { frameFilenames, gridLayout, frameWidth, frameHeight, originalJobId } = req.body;
    const layout = GRID_LAYOUTS[gridLayout] ?? GRID_LAYOUTS['2x2'];
    const framesDir = path.join(ASSETS_DIR, 'frames');

    const composites = await Promise.all(frameFilenames.map(async (name, i) => {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      const buf = await sharp(path.join(framesDir, path.basename(name)))
        .resize(frameWidth, frameHeight)
        .png()
        .toBuffer();
      return { input: buf, left: col * frameWidth, top: row * frameHeight };
    }));

    const sheetWidth  = frameWidth  * layout.cols;
    const sheetHeight = frameHeight * layout.rows;
    const sheetName   = `spritesheet_custom_${gridLayout}_${Date.now()}.png`;
    const sheetPath   = path.join(ASSETS_DIR, sheetName);

    await sharp({
      create: { width: sheetWidth, height: sheetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite(composites)
      .png()
      .toFile(sheetPath);

    const jobId = `sheet-custom-${Date.now()}`;
    const entry = {
      id:        jobId,
      timestamp: new Date().toISOString(),
      prompt:    'Custom arranged sprite sheet',
      mode:      'custom',
      type:      'spritesheet',
      imagePath: sheetPath,
      filename:  sheetName,
      params:    { width: sheetWidth, height: sheetHeight, gridLayout },
      frames:    frameFilenames.map(f => ({ filename: f })),
    };

    await writeHistory(h => [entry, ...h]);

    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
