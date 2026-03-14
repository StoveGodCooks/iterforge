import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import multer from 'multer';
import { ITERFORGE_HOME } from '../../env/reader.js';
import { generate as routerGenerate } from '../../backends/router.js';
import { PromptEngine } from '../../prompts/engine.js';
import { readHistory, HISTORY_FILE, ASSETS_DIR } from './history.js';

const router = express.Router();

const TMP_DIR = path.join(ITERFORGE_HOME, 'tmp');
const upload  = multer({ dest: TMP_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

// In-memory job store  { [jobId]: { status, result?, error? } }
const jobs = new Map();

const DEFAULT_NEGATIVE =
  'blurry, low quality, jpeg artifacts, watermark, signature, text, logo, ' +
  'distorted, duplicate, out of frame, worst quality, low resolution';

// ── POST /api/generate ───────────────────────────────────────────────────────
router.post('/', upload.single('refImage'), async (req, res) => {
  try {
    const {
      mode          = 'custom',    // 'custom' | 'preset' | 'template'
      prompt        = '',
      negativePrompt = DEFAULT_NEGATIVE,
      faction       = 'AEGIS',
      atmosphere    = 'midday',
      condition     = 'standard',
      type          = 'custom',    // arena | card | custom
      model         = null,
      seed          = null,
      steps         = 30,
      cfg           = 7,
      sampler       = null,
      width         = 1024,
      height        = 1024,
      strength      = 0.75,
    } = req.body;

    // Build prompts
    let positive, negative;
    if (mode === 'preset') {
      const built = PromptEngine.build({
        type,
        faction,
        atmosphere,
        condition,
        zoom: 2, darkness: 3, noise: 1,
      });
      positive = built.positive;
      negative = built.negative;
    } else {
      if (!prompt.trim()) {
        return res.status(400).json({ error: 'prompt is required for custom mode' });
      }
      positive = prompt.trim();
      negative = negativePrompt || DEFAULT_NEGATIVE;
    }

    const jobId    = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const resolvedSeed = seed !== null ? Number(seed) : Math.floor(Math.random() * 2 ** 32);
    const refPath  = req.file?.path ?? null;

    jobs.set(jobId, { status: 'pending', startTime: Date.now() });

    res.json({ success: true, jobId, startTime: Date.now() });

    // Run generation asynchronously
    (async () => {
      try {
        await fs.ensureDir(ASSETS_DIR);
        const result = await routerGenerate({
          type,
          positive,
          negative,
          steps:         Number(steps),
          cfg:           Number(cfg),
          seed:          resolvedSeed,
          width:         Number(width),
          height:        Number(height),
          sampler:       sampler || null,
          model:         model   || null,
          referencePath: refPath || null,
          strength:      Number(strength),
          outputDir:     ASSETS_DIR,
        });

        // Clean up temp upload
        if (refPath) await fs.remove(refPath).catch(() => {});

        // Rename to readable filename
        const slug = positive.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');
        const destName = `${slug}_${result.seed}.png`;
        const destPath = path.join(ASSETS_DIR, destName);
        if (result.imagePath !== destPath) {
          await fs.move(result.imagePath, destPath, { overwrite: true });
          result.imagePath = destPath;
        }

        // Append to history
        const historyEntry = {
          id:          jobId,
          timestamp:   new Date().toISOString(),
          prompt:      positive,
          negative,
          mode,
          type,
          seed:        result.seed,
          backend:     result.backend,
          imagePath:   destPath,
          filename:    destName,
          params:      { steps: Number(steps), cfg: Number(cfg), width: Number(width), height: Number(height) },
        };

        const history = await readHistory();
        history.unshift(historyEntry);
        await fs.writeJson(HISTORY_FILE, history.slice(0, 200), { spaces: 2 });

        jobs.set(jobId, { status: 'completed', result: historyEntry });
      } catch (err) {
        if (refPath) await fs.remove(refPath).catch(() => {});
        jobs.set(jobId, { status: 'failed', error: err.message });
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

// ── GET /api/generate/image/:filename  — serve PNG from assets ───────────────
router.get('/image/:filename', async (req, res) => {
  const filePath = path.join(ASSETS_DIR, req.params.filename);
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.sendFile(filePath);
});

export default router;
