import path from 'path';
import fs from 'fs-extra';
import { PipelineJob } from './job.js';
import { generate as comfyGenerate } from '../backends/comfyui.js';
import { generateMesh as pythonForge } from '../backends/masterforge.js';
import { writeHistory, ASSETS_DIR } from '../server/routes/history.js';
import { removeBackground } from '../tools/rembg.js';
import { GAME_ASSET_TYPES } from '../server/routes/asset-presets.js';
import { readEnv } from '../env/reader.js';
import { checkConsistency } from '../backends/quality.js';
import { validateViewSet } from '../backends/multiview.js';
import { normalizeFrame, packSheet, writeGodotMetadata } from '../backends/sprite_post.js';
import { ASSET_TYPES } from './assetTypes.js';
import { SPRITE_POSITIVE_PREFIX, SPRITE_NEGATIVE_SUFFIX, getPoseSuffixes, buildNegative, buildStyleNegative } from './spriteConstants.js';

/**
 * MasterForgePipeline — The central orchestrator for all generation and forging.
 */
export class MasterForgePipeline {

  /**
   * Run the pipeline from end-to-end based on the provided config.
   */
  static async run(config, onProgress = null) {
    const job = new PipelineJob(config, onProgress);
    job.status = 'running';

    try {
      // ── CACHE ENV ONCE PER RUN ─────────────────────────────────────────────
      const env = await readEnv();

      // ── Stage 1: GENERATE (ComfyUI) ────────────────────────────────────────
      if (config.generate?.enabled) {
        await job.stage('generate', () => this._generate(job));
      }

      // ── Stage 2: MULTIVIEW (Locking) ───────────────────────────────────────
      if (config.multiview?.enabled) {
        await job.stage('multiview', () => this._multiview(job, env));
      }

      // ── Stage 3: FORGE (Python Stack) ──────────────────────────────────────
      if (config.forge?.enabled) {
        // License Gate: 3D mesh is a Pro feature
        if (env.tier === 'free') {
          throw new Error('MasterForge 3D mesh is a Pro feature. Please upgrade your license.');
        }
        await job.stage('forge', () => this._forge(job));
      }

      // ── Stage 4: SPRITE SHEET (Frame loop) ─────────────────────────────────
      if (config.spriteSheet?.enabled) {
        await job.stage('spriteSheet', () => this._spriteSheet(job));
      }

      // ── Stage 5: DELIVER (History / Godot) ─────────────────────────────────
      if (config.deliver?.enabled) {
        await job.stage('deliver', () => this._deliver(job));
      }

      job.status = 'completed';
      return job.result();

    } catch (err) {
      console.error(`[Pipeline] Fatal error in job ${job.id}:`, err.message);
      job.fail(err);
      throw err;
    }
  }

  // ── PRIVATE STAGES ─────────────────────────────────────────────────────────

  static async _generate(job) {
    const { generate, intent, assetType, artStyle } = job.config;

    const negative = [
      generate.negative || '',
      buildNegative(assetType),
      buildStyleNegative(artStyle)
    ].filter(Boolean).join(', ');
    
    const result = await comfyGenerate({
      type:          'preset', 
      positive:      generate.prompt || intent,
      negative:      negative,
      steps:         generate.steps || 6,
      cfg:           generate.cfg || 2.0,
      seed:          generate.seed,
      width:         generate.width || 1024,
      height:        generate.height || 1024,
      outputDir:     ASSETS_DIR,
      model:         generate.model || null,
      loraName:      generate.loraName || null,
      sampler:       generate.sampler || null,
      referencePath: generate.referencePath || null,
      strength:      generate.strength ?? 0.75,
    });

    job.state.images.front = result.imagePath;
    job.state.seed = result.seed;
    
    // Auto-isolate if it's a game asset
    if (GAME_ASSET_TYPES.has(assetType)) {
      await removeBackground(result.imagePath, { white: false });
    }
  }

  static async _multiview(job, env) {
    const { images } = job.config.multiview;
    
    // License Gate: Multiview is a Pro feature
    if (env.tier === 'free') {
      throw new Error('Multiview smelting is a Pro feature. Please upgrade your license.');
    }

    if (!images.front) {
      throw new Error('Reference front view required for multiview stage');
    }

    // Validate view set completeness (needs front, left, right)
    const isValid = await validateViewSet(images);
    if (!isValid) {
      throw new Error('Incomplete multiview set. Front, Left, and Right views are required.');
    }

    // Store approved images in job state
    job.state.images.front = images.front;
    job.state.images.left  = images.left;
    job.state.images.right = images.right;
    job.state.images.back  = images.back || null;
    
    console.log(`[Pipeline] Multiview approved: ${images.front}, ${images.left}, ${images.right}`);
  }

  static async _spriteSheet(job) {
    const { spriteSheet, assetType, artStyle } = job.config;
    const { frames, frameSize, lockedRef, ipadapterWeight } = spriteSheet;
    
    if (!lockedRef) throw new Error('lockedRef (reference image) is required for sprite sheet generation');

    const typeConfig = ASSET_TYPES[assetType] || ASSET_TYPES['sword'];
    const weight = ipadapterWeight ?? typeConfig.ipaWeight;
    const poseSuffixes = getPoseSuffixes(assetType, frames);

    const negative = [
      buildNegative(assetType),
      buildStyleNegative(artStyle)
    ].filter(Boolean).join(', ');
    
    const framesDir = path.join(ASSETS_DIR, 'frames', job.id);
    await fs.ensureDir(framesDir);

    const framePaths = [];
    const frameSeeds = [];
    const MAX_ATTEMPTS = spriteSheet.extraAttempts ? 5 : 3;

    for (let i = 0; i < frames; i++) {
      let lastQuality = null;
      let lastScore = null;
      let succeeded = false;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const seed = Math.floor(Math.random() * 2 ** 32);
        try {
          const positive = `${SPRITE_POSITIVE_PREFIX}, ${poseSuffixes[i]}`;
          const result = await comfyGenerate({
            type:            'sprite',
            positive:        positive,
            negative:        negative,
            referencePath:   lockedRef,
            ipadapterWeight: weight,
            seed:            seed,
            outputDir:       framesDir
          });

          const framePath = result.imagePath;
          
          // Isolate on transparent background
          await removeBackground(framePath, { white: false });

          // Quality check
          const quality = await checkConsistency({
            refPath:   lockedRef,
            genPath:   framePath,
            assetType: assetType,
            mode:      'sprite'
          });

          lastQuality = quality;
          lastScore = quality.score;

          if (quality.passed) {
            framePaths.push(framePath);
            frameSeeds.push(seed);
            succeeded = true;
            break;
          }

          console.warn(`[Pipeline] Frame ${i} attempt ${attempt + 1}/${MAX_ATTEMPTS} — score ${quality.score.toFixed(2)} below threshold`);
          await fs.remove(framePath).catch(() => {});

        } catch (err) {
          console.error(`[Pipeline] Error generating frame ${i} (attempt ${attempt + 1}):`, err.message);
        }
      }

      if (!succeeded) {
        const details = lastQuality?.details;
        const threshold = lastQuality?.threshold ?? 0.70;

        const diagnosis = details ? [
          details.color < 0.6 ? 'Color palette has drifted significantly from the reference — the model is generating a different color scheme.' : null,
          details.phash < 0.5 ? 'Structural identity is too different — the subject shape or silhouette has changed between frames.' : null,
          details.ssim  < 0.4 ? 'Pixel-level similarity is too low — the frame looks like a different subject entirely.' : null,
        ].filter(Boolean) : [];

        const suggestion = [
          lastQuality?.details?.color < 0.6 ? 'Try increasing the IP-Adapter weight to enforce stronger color identity.' : null,
          lastQuality?.details?.phash < 0.5 ? 'Try a lower IP-Adapter weight — too high can cause structural collapse.' : null,
          lastQuality?.details?.ssim  < 0.4 ? 'The reference image may not be suitable for this asset type. Try re-locking a cleaner source.' : null,
          diagnosis.length === 0            ? 'The score was close but did not meet the threshold. Try enabling Extra Attempts (5 tries) in settings.' : null,
        ].filter(Boolean);

        throw new Error(JSON.stringify({
          type: 'QUALITY_GATE_FAILURE',
          frame: i,
          attempts: MAX_ATTEMPTS,
          score: lastScore?.toFixed(3),
          threshold,
          diagnosis,
          suggestion,
        }));
      }

      // Update progress
      job.onProgress?.({ 
        id: job.id, 
        stage: 'spriteSheet', 
        status: 'running', 
        progress: { completed: i + 1, total: frames } 
      });
    }

    // Post-process frames (normalize)
    const normPaths = [];
    for (const f of framePaths) {
      const normPath = f.replace('.png', '_norm.png');
      await normalizeFrame(f, normPath, frameSize);
      normPaths.push(normPath);
    }

    // Pack sheet
    const cols = frames > 4 ? 3 : 2;
    const stem = path.basename(lockedRef, path.extname(lockedRef));
    const sheetName = `${stem}_sheet_${job.id.slice(-6)}.png`;
    const sheetPath = path.join(ASSETS_DIR, sheetName);
    await packSheet(normPaths, sheetPath, cols);

    // Write Godot metadata
    const tresPath = path.join(ASSETS_DIR, `${stem}_${job.id.slice(-6)}.tres`);
    await writeGodotMetadata(tresPath, sheetName, frames, cols, frameSize);

    job.state.spriteSheet = {
      imagePath: sheetPath,
      filename:  sheetName,
      metadata:  tresPath,
      frames:    normPaths.map((p, i) => ({ filename: path.basename(p), seed: frameSeeds[i] }))
    };
  }

  static async _forge(job) {
    const { forge, assetType } = job.config;
    const frontImage = job.state.images.front;
    
    if (!frontImage) throw new Error('No input image for forge stage');

    const jobDir = path.join(path.dirname(frontImage), `forge_${job.id}`);
    await fs.ensureDir(jobDir);

    const result = await pythonForge({
      imagePath:      frontImage,
      assetType:      assetType || 'sword',
      outputDir:      jobDir,
      useMidas:       forge.use_midas ?? false,
      noLod:          !(forge.lod ?? true),
      noDxf:          !(forge.dxf ?? true),
      leftImagePath:  job.state.images.left  ?? null,
      rightImagePath: job.state.images.right ?? null,
      backImagePath:  job.state.images.back  ?? null,
      onLog: (line) => {
        job.onProgress?.({ id: job.id, stage: 'forge', status: 'running', log: line });
      }
    });

    if (!result.success) {
      throw new Error(`Python forge failed: ${result.stderr}`);
    }

    // Identify primary outputs with null guards
    const files = await fs.readdir(jobDir);
    const glb  = files.find(f => f.endsWith('.glb'));
    const stl  = files.find(f => f.endsWith('.stl') && !f.includes('_lod'));
    const dxf  = files.find(f => f.endsWith('.dxf'));
    const lods = files.filter(f => f.includes('_lod') && f.endsWith('.stl'));
    
    if (glb)  job.state.glb  = path.join(jobDir, glb);
    if (stl)  job.state.mesh = path.join(jobDir, stl);
    if (dxf)  job.state.dxf  = path.join(jobDir, dxf);
    if (lods.length) {
      job.state.lods = lods.map(f => path.join(jobDir, f));
    }
  }

  static async _deliver(job) {
    const { deliver, assetType, intent, generate } = job.config;
    let imagePath = job.state.images.front;

    // ── STABLE FILENAME ──────────────────────────────────────────────────────
    if (imagePath && await fs.pathExists(imagePath)) {
      const slug = (intent || 'asset').slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/, '');
      const seedLabel = job.state.seed ?? 'noseed';
      const destName = `${slug}_${seedLabel}_${job.id.slice(-6)}.png`;
      const destPath = path.join(ASSETS_DIR, destName);
      
      if (imagePath !== destPath) {
        await fs.move(imagePath, destPath, { overwrite: true });
        job.state.images.front = destPath;
        imagePath = destPath;
      }
    }

    // ── HISTORY ENTRY ────────────────────────────────────────────────────────
    const historyEntry = {
      id:        job.id,
      type:      job.state.spriteSheet ? 'spritesheet' : (job.state.glb ? '3d' : 'image'),
      meshType:  assetType,
      filename:  job.state.glb ? path.basename(job.state.glb) : path.basename(imagePath || ''),
      glbPath:   job.state.glb,
      meshPath:  job.state.mesh,
      imagePath: imagePath,
      timestamp: Date.now(),
      prompt:    intent,
      seed:      job.state.seed,
      backend:   'masterforge-pipeline-v1',
      params:    job.config,
      // Metadata specific to sprite sheets
      frames:    job.state.spriteSheet?.frames,
      metadata:  job.state.spriteSheet?.metadata
    };

    if (deliver.history) {
      job.state.history = historyEntry;
      await writeHistory(h => [historyEntry, ...h]);
    }

    // ── CLEANUP ──────────────────────────────────────────────────────────────
    if (generate?.referencePath) {
      await fs.remove(generate.referencePath).catch(() => {});
    }

    if (deliver.godot_sync) {
      // TODO: Implement Godot plugin bridge sync
      console.log('[Pipeline] Godot sync placeholder');
    }
  }
}
