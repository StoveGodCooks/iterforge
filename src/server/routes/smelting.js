/**
 * smelting.js — Express route handler for Phase 2 Multiview Smelting.
 */

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ASSETS_DIR } from './history.js';
import { generate as comfyGenerate } from '../../backends/comfyui.js';
import { checkConsistency } from '../../backends/quality.js';
import { ASSET_TYPES } from '../../pipeline/assetTypes.js';
import { removeBackground } from '../../tools/rembg.js';

const router = express.Router();

// In-memory job store for smelting view generation
const smeltingJobs = new Map();

function scheduleCleanup(jobId) {
  setTimeout(() => smeltingJobs.delete(jobId), 15 * 60 * 1000); // 15 min TTL
}

const VIEW_PROMPTS = {
  front: 'exact front-facing orthographic elevation, 0-degree rotation, subject facing directly toward viewer, perfectly vertical axis, flat even lighting, white background, fully visible, centered',
  left:  'exact 90-degree left side profile, perpendicular side elevation, subject facing directly left, no rotation toward viewer, perfectly vertical axis, flat even lighting, white background, fully visible, centered',
  right: 'exact 90-degree right side profile, perpendicular side elevation, subject facing directly right, no rotation toward viewer, perfectly vertical axis, flat even lighting, white background, fully visible, centered',
  back:  'exact rear-facing orthographic elevation, 180-degree rotation, subject facing directly away from viewer, perfectly vertical axis, flat even lighting, white background, fully visible, centered',
};

// Per-view exclusive negatives block all other angles
const VIEW_NEGATIVES = {
  front: 'side profile, left view, right view, turned, rotated away, three-quarter angle, back facing',
  left:  'front facing, right side, back view, three-quarter angle, facing viewer, rotated toward camera',
  right: 'front facing, left side, back view, three-quarter angle, facing viewer, rotated toward camera',
  back:  'front facing, side profile, left view, right view, facing viewer, three-quarter angle',
};

const ORTHO_NEGATIVE = 'perspective, foreshortening, isometric, angled, tilted, diagonal, dynamic pose, action pose, multiple subjects, decorative background, scene, environment, shadow, drop shadow, motion blur, dramatic lighting, rim lighting, partial view, cropped, cut off, zoomed in';

// ── POST /api/smelting/generate-view ─────────────────────────────────────────
router.post('/generate-view', async (req, res) => {
  try {
    const {
      refPath,
      viewType,
      assetType = 'sword',
      assetPrompt = '',
      ipaWeightOverride = null,
      useCanny = true,
      tinkerMode = false,
    } = req.body;

    if (!refPath || !VIEW_PROMPTS[viewType]) {
      return res.status(400).json({ error: 'Invalid refPath or viewType' });
    }

    const typeConfig = ASSET_TYPES[assetType] || ASSET_TYPES['sword'];
    const ipaWeight = ipaWeightOverride ?? typeConfig.ipaWeight;
    
    const jobId = `smelt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    smeltingJobs.set(jobId, {
      status: 'running',
      viewType,
      progress: 'Initializing ComfyUI...',
      startTime: Date.now()
    });

    res.json({ success: true, jobId, viewType });

    // Run asynchronously
    (async () => {
      const timeout = setTimeout(() => {
        if (smeltingJobs.get(jobId)?.status === 'running') {
          console.warn(`[Smelting] Job ${jobId} timed out after 5 minutes`);
          smeltingJobs.set(jobId, { status: 'failed', error: 'Generation timed out after 5 minutes' });
          scheduleCleanup(jobId);
        }
      }, 5 * 60 * 1000);

      try {
        // Resolve refPath to absolute (frontend may send just a basename)
        const resolvedRef = path.isAbsolute(refPath)
          ? refPath
          : path.join(ASSETS_DIR, path.basename(refPath));

        // 1. Build prompt: asset identity + strong view direction
        const positive = assetPrompt
          ? `${assetPrompt}, ${VIEW_PROMPTS[viewType]}`
          : VIEW_PROMPTS[viewType];

        const negative = [
          ORTHO_NEGATIVE,
          VIEW_NEGATIVES[viewType],
          'different design, different weapon, different character, wrong color scheme, wrong shape',
        ].join(', ');

        // 2. Generate view via ComfyUI using IP-Adapter + ControlNet Depth/Canny stack
        //    Front needs minimal denoising (identity cleanup), sides need full rotation freedom
        const VIEW_STRENGTH = { front: 0.30, left: 0.68, right: 0.68, back: 0.68 };
        const result = await comfyGenerate({
          type:            'smelt',
          model:           'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors',
          positive,
          negative,
          referencePath:   resolvedRef,
          strength:        VIEW_STRENGTH[viewType] ?? 0.68,
          steps:           28,
          cfg:             6.5,
          ipadapterWeight: ipaWeight,
          outputDir:       ASSETS_DIR,
        });

        const genPath = result.imagePath;

        // 2. Remove background — white bg for orthographic views
        await removeBackground(genPath, { white: true });

        // 3. Quality check — skipped in Tinker Mode
        let quality;
        if (tinkerMode) {
          quality = { passed: true, score: 1.0, warn: false, tinker: true };
        } else {
          quality = await checkConsistency({
            refPath:   resolvedRef,
            genPath,
            assetType,
            mode: 'smelting'
          });
        }

        smeltingJobs.set(jobId, {
          status: 'completed',
          result: {
            imagePath: genPath,
            filename: path.basename(genPath),
            quality,
          }
        });
        scheduleCleanup(jobId);

      } catch (err) {
        console.error(`[Smelting] Job ${jobId} failed:`, err.message);
        smeltingJobs.set(jobId, { status: 'failed', error: err.message });
        scheduleCleanup(jobId);
      }
    })();

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/smelting/check-consistency ─────────────────────────────────────
router.post('/check-consistency', async (req, res) => {
  try {
    const { refPath, genPath, assetType = 'sword' } = req.body;
    if (!refPath || !genPath) return res.status(400).json({ error: 'refPath and genPath required' });

    const quality = await checkConsistency({
      refPath,
      genPath,
      assetType,
      mode: 'smelting'
    });

    res.json(quality);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/smelting/job/:jobId ─────────────────────────────────────────────
router.get('/job/:jobId', (req, res) => {
  const job = smeltingJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

export default router;
