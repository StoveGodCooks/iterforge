import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import sharp from 'sharp';
import { ITERFORGE_HOME } from '../../env/reader.js';
import { generate as routerGenerate } from '../../backends/router.js';
import { readHistory, writeHistory, HISTORY_FILE, ASSETS_DIR } from './history.js';
import { buildPresetPrompt, ASSET_PRESETS } from './asset-presets.js';
import { removeBackground } from '../../tools/rembg.js';

const router = express.Router();

// In-memory job store for sprite sheet batch jobs
const sheetJobs = new Map();

// TTL cleanup — remove completed/failed jobs after 10 minutes
function scheduleSheetJobCleanup(jobId) {
  setTimeout(() => sheetJobs.delete(jobId), 10 * 60 * 1000);
}

const DEFAULT_NEGATIVE =
  'blurry, low quality, jpeg artifacts, watermark, signature, text, logo, ' +
  'distorted, duplicate, out of frame, worst quality, low resolution, ' +
  'bad anatomy, deformed, ugly, mutation, extra limbs';

// Hard-injected into EVERY sprite sheet frame — forces clean 2D sprite output.
// Positive terms use ComfyUI attention syntax (value:weight) to override model priors.
const SPRITE_POSITIVE_PREFIX =
  '2D game sprite, single character, solo character, one character only, ' +
  '(pure white background:1.4), (white background:1.4), isolated on white, ' +
  'clean cutout edges, flat shading, no scene background, not a reference sheet, ' +
  'no text, no watermark, no labels';

// Hard-appended to EVERY frame's negative — blocks the most common failures.
// Text/watermark terms are repeated here even though DEFAULT_NEGATIVE has them —
// the double-block is intentional, the model needs both to suppress trained-in text.
const SPRITE_NEGATIVE_SUFFIX =
  ', text, words, letters, watermark, written text, printed text, text overlay, ' +
  'caption, label, annotation, title text, brand name, copyright text, ' +
  'game title, logo, corner logo, studio watermark, any writing, ' +
  'grey background, gradient background, light grey background, off-white background, ' +
  'dark grey background, studio grey, seamless grey, neutral grey, silver background, ' +
  'product photography background, studio photography backdrop, vignette, ' +
  'character reference sheet, character turnaround sheet, multiple poses in one image, ' +
  'multiple views of same character, model sheet, front back side view, ' +
  'ground plane, drop shadow, cast shadow, 3D render, CGI, blender render, ' +
  'photorealistic rendering, depth of field, bokeh, studio lighting, rim lighting, ' +
  'ambient occlusion, hud elements, interface ui, ' +
  'multiple characters, crowd, busy background, environment scene';

// Per-asset-type pose sets — injected per-frame so each frame is a distinct useful pose
const POSE_SETS = {
  character: {
    // IMPORTANT: No "side view", "back view", "turnaround" — those phrases trigger
    // the model's "character reference sheet" pattern. Use pure action descriptions only.
    4:  [
      'standing idle, relaxed, arms loose at sides, neutral expression',
      'walking forward, mid-stride, one leg raised, weight shifting',
      'attacking, weapon raised overhead, lunging forward, fierce expression',
      'stumbling backward from a hit, arms raised in defense, off balance',
    ],
    8:  [
      'standing idle, relaxed neutral stance, arms at sides',
      'idle, subtle weight shift, slight body sway',
      'walking briskly, one leg raised, mid-stride, arms swinging',
      'running fast, leaning forward, both feet leaving ground',
      'attack wind-up, arm drawn back, tensed and ready to strike',
      'attacking, weapon fully extended, striking forward',
      'jumping, both feet off ground, airborne',
      'hurt, stumbling backward, cringing in pain, recoiling',
    ],
    9:  [
      'idle neutral stance', 'idle relaxed, slight lean', 'idle looking back over shoulder',
      'walking forward, mid-stride', 'running forward at speed',
      'sprinting at full pace, leaning hard', 'attacking with weapon raised high',
      'jumping in air, airborne', 'hurt stumbling backward',
    ],
    16: [
      'idle 1 neutral stance', 'idle 2 breathing, slight sway', 'idle 3 glancing sideways', 'idle 4 relaxed arms crossed',
      'walking 1 mid-stride', 'walking 2 opposite leg raised', 'walking 3 arms swinging', 'walking 4 weight forward',
      'running 1 fast sprint lean', 'running 2 full speed both feet off ground',
      'attack 1 wind-up tensed', 'attack 2 full strike extension',
      'jumping rising upward', 'falling descending',
      'hurt hit reaction cringing', 'defeated collapse',
    ],
  },
  creature: {
    // Same rule: no "side view" / "turnaround" language
    4:  [
      'idle alert stance, front facing, full body, natural posture',
      'prowling forward slowly, one paw raised mid-step',
      'lunging attack, mouth open, claws extended, aggressive leap',
      'recoiling from hit, defensive flinch, drawn back',
    ],
    8:  [
      'idle alert, watching', 'idle resting, sniffing ground',
      'stalking forward slowly, low body', 'trotting, mid-stride',
      'charging at full speed, body low', 'lunging attack, mouth open wide',
      'pouncing jump, airborne', 'hurt flinching back, defensive',
    ],
    9:  [
      'idle alert front facing', 'idle resting curled', 'idle looking away',
      'walking forward', 'trotting mid-stride', 'running full charge',
      'attacking aggressively', 'jumping pouncing', 'hurt recoiling',
    ],
    16: [
      'idle 1 alert watching', 'idle 2 sniffing', 'idle 3 resting', 'idle 4 shifting weight',
      'walk 1 slow step', 'walk 2 opposite paw', 'walk 3 turning', 'walk 4 approaching',
      'run 1 trotting', 'run 2 full gallop', 'attack 1 wind-up', 'attack 2 lunging strike',
      'jump rising', 'fall landing', 'hurt flinching', 'death collapsing',
    ],
  },
  item: {
    4:  ['front view centered', 'side view angled left', 'top down overhead view', 'three quarter perspective view'],
    8:  ['front view', 'back view', 'left side', 'right side', 'top view', 'bottom view', 'angle 1', 'angle 2'],
    9:  ['front', 'back', 'left', 'right', 'top', 'bottom', 'angle 1', 'angle 2', 'close up detail'],
  },
  prop: {
    4:  ['front view centered', 'side view', 'top down view', 'three quarter angled'],
    8:  ['front', 'back', 'left side', 'right side', 'top', 'bottom', 'angle 1', 'angle 2'],
  },
  building: {
    4:  ['front facade', 'side view', 'back view', 'three quarter isometric view'],
    8:  ['front day', 'front night', 'side view', 'back', 'damaged variant', 'top down', 'ruins', 'full detail close up'],
  },
  vfx: {
    4:  [
      'start frame, small spark, beginning',
      'build up frame, growing energy, expanding',
      'peak frame, full intensity, maximum brightness',
      'dissipate frame, fading out, smoke trails',
    ],
    8:  [
      'frame 1 spark ignite', 'frame 2 grow', 'frame 3 expand',
      'frame 4 peak bright', 'frame 5 fade start',
      'frame 6 smoke', 'frame 7 dissipate', 'frame 8 gone',
    ],
  },
  particle: {
    4:  ['start frame small', 'expanding mid frame', 'peak intensity', 'end dissolving'],
    8:  ['frame 1', 'frame 2', 'frame 3', 'frame 4', 'frame 5', 'frame 6', 'frame 7', 'frame 8'],
  },
  texture: {
    4:  ['seamless tile section 1', 'seamless tile section 2', 'seamless tile variation', 'edge transition'],
  },
  icon: {
    4:  ['normal state', 'hover highlighted state', 'pressed active state', 'disabled greyed state'],
    8:  ['icon 1', 'icon 2', 'icon 3', 'icon 4', 'icon 5', 'icon 6', 'icon 7', 'icon 8'],
  },
};

// Returns an array of pose suffix strings, one per frame
function getPoseSuffixes(assetType, frameCount) {
  const typeSet = POSE_SETS[assetType];
  if (!typeSet) {
    // Generic fallback: variation labels
    return Array.from({ length: frameCount }, (_, i) => `variation ${i + 1}, unique pose`);
  }
  // Find the closest defined frame count
  const available = Object.keys(typeSet).map(Number).sort((a, b) => a - b);
  const closest = available.reduce((prev, curr) =>
    Math.abs(curr - frameCount) < Math.abs(prev - frameCount) ? curr : prev
  );
  const poses = typeSet[closest];
  // Tile if frameCount > defined poses, trim if less
  return Array.from({ length: frameCount }, (_, i) => poses[i % poses.length]);
}

// Grid layout definitions: { cols, rows }
const GRID_LAYOUTS = {
  '2x2': { cols: 2, rows: 2 },
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
      negativePrompt = DEFAULT_NEGATIVE,
      gridLayout     = '2x2',
      model          = null,
      steps          = 6,
      cfg            = 2,
      sampler        = 'euler',
      width          = 512,
      height         = 512,
      mode           = 'custom',
      assetType      = 'character',
      artStyle       = 'stylized',
      subject        = '',
    } = req.body;

    // Build base positive using the same user-first preset system as single gen
    let basePositive, baseNegative, sheetCfg, sheetSteps, presetLoraName;
    if (mode === 'preset') {
      const built = buildPresetPrompt({
        assetType,
        artStyle,
        subject: subject.trim() || prompt.trim(),
        baseNegative: DEFAULT_NEGATIVE,
        cfg:   Number(cfg),
        steps: Number(steps),
      });
      basePositive   = built.positive;
      baseNegative   = built.negative + SPRITE_NEGATIVE_SUFFIX;
      sheetCfg       = built.cfg;
      sheetSteps     = built.steps;
      presetLoraName = built.loraName ?? null;
    } else {
      if (!prompt.trim()) return res.status(400).json({ error: 'prompt is required' });
      basePositive   = prompt.trim();
      baseNegative   = DEFAULT_NEGATIVE + SPRITE_NEGATIVE_SUFFIX;
      sheetCfg       = Number(cfg);
      sheetSteps     = Number(steps);
    }
    const finalNegative = baseNegative;

    const layout = GRID_LAYOUTS[gridLayout] ?? GRID_LAYOUTS['2x2'];
    const frameCount = layout.cols * layout.rows;
    const jobId = `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const poseSuffixes = getPoseSuffixes(assetType, frameCount);
    // consistencyMode: generate frame 0 first (text2img), then use it as img2img
    // reference for all remaining frames so the character stays visually identical.
    const consistencyMode = req.body.consistencyMode !== false; // default true

    sheetJobs.set(jobId, {
      status: 'pending',
      progress: { completed: 0, total: frameCount },
      startTime: Date.now(),
    });

    res.json({ success: true, jobId, frameCount });

    // Run batch generation asynchronously
    (async () => {
      try {
        await fs.ensureDir(ASSETS_DIR);
        const framesDir = path.join(ASSETS_DIR, 'frames');
        await fs.ensureDir(framesDir);

        const seeds = Array.from({ length: frameCount }, () => Math.floor(Math.random() * 2 ** 32));
        const frames = [];

        // ── STEP 1: Generate anchor frame (frame 0) as clean text2img ────────
        // Prompt order: subject (boosted) → pose → LoRA triggers → sprite guardrails → style.
        // Subject and pose go FIRST so they aren't buried under preset boilerplate in
        // SDXL's 77-token CLIP window. LoRA triggers still activate even mid-prompt.
        // Per-frame prompt: subject first (weighted), then pose, then base preset positive
        const subjectWeighted = subject.trim() ? `(${subject.trim()}:1.3)` : null;
        const buildFramePositive = (poseIdx) =>
          [subjectWeighted, poseSuffixes[poseIdx], basePositive]
            .filter(Boolean).join(', ');

        const anchorResult = await routerGenerate({
          type: 'sprite',
          positive: buildFramePositive(0),
          negative: finalNegative,
          steps:   sheetSteps,
          cfg:     sheetCfg,
          seed:    seeds[0],
          width:   Number(width),
          height:  Number(height),
          sampler: sampler || 'euler',
          model:   model || null,
          loraName: presetLoraName,
          referencePath: null,
          strength: 0.75,
          outputDir: framesDir,
        });
        frames.push(anchorResult);
        sheetJobs.set(jobId, {
          status: 'running',
          progress: { completed: 1, total: frameCount },
          startTime: sheetJobs.get(jobId).startTime,
        });

        // ── STEP 2: Remaining frames — locked to anchor via img2img ──────────
        // Each subsequent frame uses frame 0 as the reference image at strength 0.60.
        // The pose prompt drives the variation; the character design stays anchored.
        const anchorRef = consistencyMode ? anchorResult.imagePath : null;

        for (let i = 1; i < frameCount; i += 2) {
          const batch = seeds.slice(i, Math.min(i + 2, frameCount));
          const results = await Promise.all(batch.map((seed, batchOffset) => {
            const frameIdx = i + batchOffset;
            return routerGenerate({
              type: 'sprite',
              positive: buildFramePositive(frameIdx),
              negative: finalNegative,
              steps:   sheetSteps,
              cfg:     sheetCfg,
              seed,
              width:   Number(width),
              height:  Number(height),
              sampler: sampler || 'euler',
              model:   model || null,
              loraName: presetLoraName,
              referencePath: anchorRef,
              strength: anchorRef ? 0.60 : 0.75,
              outputDir: framesDir,
            });
          }));
          frames.push(...results);
          sheetJobs.set(jobId, {
            status: 'running',
            progress: { completed: Math.min(i + batch.length, frameCount), total: frameCount },
            startTime: sheetJobs.get(jobId).startTime,
          });
        }

        // Rename frame files to stable paths
        const frameNames = [];
        for (let i = 0; i < frames.length; i++) {
          const slug = basePositive.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');
          const frameName = `frame_${slug}_${seeds[i]}_${jobId.slice(-6)}_${i}.png`;
          const framePath = path.join(framesDir, frameName);
          await fs.move(frames[i].imagePath, framePath, { overwrite: true });
          frames[i].imagePath = framePath;
          frameNames.push(frameName);
        }

        // Strip backgrounds from every frame (rembg — non-blocking, white bg)
        await Promise.all(frames.map(f => removeBackground(f.imagePath, { white: true })));

        // Composite into sprite sheet using Sharp
        const sheetWidth  = Number(width)  * layout.cols;
        const sheetHeight = Number(height) * layout.rows;

        const composites = await Promise.all(frames.map(async (frame, i) => {
          const col = i % layout.cols;
          const row = Math.floor(i / layout.cols);
          const buf = await sharp(frame.imagePath)
            .resize(Number(width), Number(height))
            .png()
            .toBuffer();
          return {
            input: buf,
            left: col * Number(width),
            top:  row * Number(height),
          };
        }));

        const slug = basePositive.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');
        const sheetName = `spritesheet_${slug}_${gridLayout}_${jobId.slice(-6)}.png`;
        const sheetPath = path.join(ASSETS_DIR, sheetName);

        await sharp({
          create: { width: sheetWidth, height: sheetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        })
          .composite(composites)
          .png()
          .toFile(sheetPath);

        // Build history entry for the sprite sheet
        const historyEntry = {
          id:        jobId,
          timestamp: new Date().toISOString(),
          prompt:    basePositive,
          negative:  finalNegative,
          mode,
          type:      'spritesheet',
          seed:      seeds[0],
          backend:   frames[0]?.backend ?? 'comfyui',
          imagePath: sheetPath,
          filename:  sheetName,
          params:    {
            steps:      Number(steps),
            cfg:        Number(cfg),
            width:      sheetWidth,
            height:     sheetHeight,
            gridLayout,
            frameCount,
          },
          frames: frameNames.map((name, i) => ({ filename: name, seed: seeds[i], pose: poseSuffixes[i] })),
        };

        await writeHistory(h => [historyEntry, ...h]);

        sheetJobs.set(jobId, { status: 'completed', result: historyEntry });
        scheduleSheetJobCleanup(jobId);
      } catch (err) {
        sheetJobs.set(jobId, { status: 'failed', error: err.message });
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
