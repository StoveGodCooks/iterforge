import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import sharp from 'sharp';
import multer from 'multer';
import { ITERFORGE_HOME } from '../../env/reader.js';
import { MasterForgePipeline } from '../../pipeline/orchestrator.js';
import { ASSETS_DIR, writeHistory } from './history.js';
import { buildPresetPrompt, ASSET_PRESETS } from './asset-presets.js';

const router = express.Router();

const TMP_DIR = path.join(ITERFORGE_HOME, 'tmp');
const upload  = multer({ dest: TMP_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

// In-memory job store  { [jobId]: { status, result?, error? } }
const jobs = new Map();

// TTL cleanup — remove completed/failed jobs after 10 minutes
function scheduleJobCleanup(jobId) {
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
}

const DEFAULT_NEGATIVE =
  'blurry, low quality, jpeg artifacts, watermark, signature, text, logo, ' +
  'distorted, duplicate, out of frame, worst quality, low resolution, ' +
  'bad anatomy, deformed, ugly, mutation, extra limbs, disfigured, ' +
  'grainy, noisy, oversaturated, flat, boring, amateur';

// ── POST /api/generate ───────────────────────────────────────────────────────
router.post('/', upload.single('refImage'), async (req, res) => {
  try {
    const {
      mode           = 'custom',
      prompt         = '',
      negativePrompt = DEFAULT_NEGATIVE,
      assetType      = 'character',
      artStyle       = 'stylized',
      subject        = '',
      genre          = '',
      type           = 'custom',
      model          = null,
      seed           = null,
      steps          = 6,
      cfg            = 2,
      sampler        = null,
      width          = 1024,
      height         = 1024,
      strength       = 0.75,
    } = req.body;

    // Build prompts
    let positive, negative;
    let safeSteps = Math.min(Math.max(Number(steps) || 6,  1), 50);
    let safeCfg   = Math.min(Math.max(Number(cfg)   || 2,  1), 20);
    let presetLoraName = null;

    if (mode === 'preset') {
      const built = buildPresetPrompt({
        assetType,
        artStyle,
        subject: subject.trim() || prompt.trim(),
        baseNegative: DEFAULT_NEGATIVE,
        cfg:   safeCfg,
        steps: safeSteps,
      });
      positive       = built.positive;
      negative       = built.negative;
      safeCfg        = Math.min(Math.max(built.cfg,   1), 20);
      safeSteps      = Math.min(Math.max(built.steps, 1), 50);
      presetLoraName = built.loraName ?? null;
    } else {
      if (!prompt.trim()) {
        return res.status(400).json({ error: 'prompt is required for custom mode' });
      }
      positive = prompt.trim();
      negative = negativePrompt || DEFAULT_NEGATIVE;
    }

    const assetMode = 'standard';
    const modeLabel = null;

    // Resolve final dimensions
    let resolvedWidth  = Number(width)  || 1024;
    let resolvedHeight = Number(height) || 1024;
    if (mode === 'preset') {
      const presetSuggest = ASSET_PRESETS[assetType]?.suggestSize;
      if (presetSuggest && resolvedWidth === resolvedHeight) {
        resolvedWidth  = presetSuggest.width;
        resolvedHeight = presetSuggest.height;
      }
    }
    const safeWidth  = Math.min(Math.max(resolvedWidth,  128), 2048);
    const safeHeight = Math.min(Math.max(resolvedHeight, 128), 2048);

    const parsedSeed = Number(seed);
    const resolvedSeed = (seed !== null && seed !== '' && seed !== undefined && Number.isFinite(parsedSeed) && parsedSeed >= 0)
      ? parsedSeed
      : Math.floor(Math.random() * 2 ** 32);
    const refPath  = req.file?.path ?? null;

    // Build Pipeline Config
    const config = {
      intent:    positive,
      assetType: assetType,
      artStyle:  artStyle,
      output:    ['png'],
      generate: {
        enabled:       true,
        prompt:        positive,
        negative:      negative,
        steps:         safeSteps,
        cfg:           safeCfg,
        seed:          resolvedSeed,
        width:         safeWidth,
        height:        safeHeight,
        model:         model,
        loraName:      presetLoraName,
        sampler:       sampler,
        referencePath: refPath,
        strength:      Number(strength),
      },
      multiview: { enabled: false },
      forge:     { enabled: false },
      deliver:   { enabled: true, history: true },
    };

    // Note: We don't use the jobId from PipelineJob here yet to keep the 
    // frontend /api/generate/:jobId polling working. We wrap the pipeline.
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    jobs.set(jobId, { status: 'pending', startTime: Date.now() });
    res.json({ success: true, jobId, startTime: Date.now(), assetMode, modeLabel });

    // Run pipeline asynchronously
    (async () => {
      try {
        const pipelineResult = await MasterForgePipeline.run(config, (progress) => {
          if (jobs.has(jobId)) {
            jobs.get(jobId).progress = `${progress.stage}: ${progress.status}`;
          }
        });

        // Map pipeline result back to the legacy jobs format for the frontend
        jobs.set(jobId, { 
          status: 'completed', 
          result: pipelineResult.outputs.history 
        });
        scheduleJobCleanup(jobId);

      } catch (err) {
        if (refPath) await fs.remove(refPath).catch(() => {});
        jobs.set(jobId, { status: 'failed', error: err.message });
        scheduleJobCleanup(jobId);
      }
    })();

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/generate/:jobId  (poll for status) ──────────────────────────────
router.get('/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── POST /api/generate/rotate — rotate a generated image 90° CW or CCW ───────
// Body: { filename: string, direction: 'cw' | 'ccw' }
// Rotates the file in-place and returns the updated timestamp for cache-busting.
router.post('/rotate', async (req, res) => {
  try {
    const { filename, direction = 'cw' } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename required' });

    const filePath = path.join(ASSETS_DIR, path.basename(filename));
    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const degrees = direction === 'ccw' ? 270 : 90;   // 270° CCW == 90° CW counterpart
    const tmp = filePath + '.rot.png';
    await sharp(filePath).rotate(degrees).toFile(tmp);
    await fs.move(tmp, filePath, { overwrite: true });

    // Update history entry timestamp so the frontend re-fetches
    const timestamp = Date.now();
    await writeHistory(h =>
      h.map(e => (path.basename(e.filename ?? '') === path.basename(filename)
        ? { ...e, timestamp }
        : e))
    );

    res.json({ success: true, filename, timestamp });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/generate/image/:filename  — serve PNG from assets ───────────────
router.get('/image/:filename', async (req, res) => {
  const filePath = path.join(ASSETS_DIR, path.basename(req.params.filename));
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(filePath);
});

export default router;
