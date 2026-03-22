/**
 * export.js — Multi-engine game asset export route.
 *
 * POST /api/export
 *   Body: { assetIds: string[], engine: 'godot'|'unity'|'unreal'|'pygame', outputName?: string }
 *   Returns: { zipPath, downloadUrl, fileList }
 *
 * GET /api/export/engines
 *   Returns: { detected: string[] }
 *
 * GET /api/export/download/:filename
 *   Returns: ZIP file download
 */

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { execFile } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';
import { ITERFORGE_HOME, BLENDER_ASSETS_DIR } from '../../env/reader.js';
import { readHistory } from './history.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

// ── Directories ───────────────────────────────────────────────────────────────
const EXPORTS_DIR = path.join(ITERFORGE_HOME, 'tmp', 'exports');
const MODELS_DIR  = path.join(BLENDER_ASSETS_DIR, 'models');

// ── Engine folder structures ──────────────────────────────────────────────────
const ENGINE_STRUCTURE = {
  godot: {
    sprites:       'sprites',
    sprite_sheets: 'sprite_sheets',
    models:        'models',
    textures:      'textures',
  },
  unity: {
    sprites:       'Assets/Inter-Forge/Sprites',
    sprite_sheets: 'Assets/Inter-Forge/Sprites/Sheets',
    models:        'Assets/Inter-Forge/Models',
    textures:      'Assets/Inter-Forge/Textures',
  },
  unreal: {
    sprites:       'Content/Inter-Forge/Textures',
    sprite_sheets: 'Content/Inter-Forge/Textures/Sheets',
    models:        'Content/Inter-Forge/Meshes',
    textures:      'Content/Inter-Forge/Textures',
  },
  pygame: {
    sprites:       'assets/sprites',
    sprite_sheets: 'assets/sheets',
    models:        'assets/models',
    textures:      'assets/textures',
  },
};

// ── Engine detection ──────────────────────────────────────────────────────────

async function detectEngines() {
  const detected = [];

  const godotGlobs = [
    'C:/Godot',
    path.join(process.env.PROGRAMFILES  ?? 'C:/Program Files',  'Godot'),
    path.join(process.env.LOCALAPPDATA  ?? path.join(os_homedir(), 'AppData', 'Local'), 'Programs', 'Godot'),
  ];

  const unityHubBase = path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Unity', 'Hub', 'Editor');
  const unrealBase   = path.join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Epic Games');

  // Godot
  for (const dir of godotGlobs) {
    if (await fs.pathExists(dir)) {
      const entries = await fs.readdir(dir).catch(() => []);
      if (entries.some(f => f.toLowerCase().endsWith('.exe'))) {
        detected.push('godot');
        break;
      }
    }
  }

  // Unity
  if (await fs.pathExists(unityHubBase)) {
    const versions = await fs.readdir(unityHubBase).catch(() => []);
    for (const v of versions) {
      const exe = path.join(unityHubBase, v, 'Editor', 'Unity.exe');
      if (await fs.pathExists(exe)) { detected.push('unity'); break; }
    }
  }

  // Unreal
  if (await fs.pathExists(unrealBase)) {
    const entries = await fs.readdir(unrealBase).catch(() => []);
    for (const entry of entries) {
      if (entry.startsWith('UE_')) {
        const exe = path.join(unrealBase, entry, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
        if (await fs.pathExists(exe)) { detected.push('unreal'); break; }
      }
    }
  }

  // pygame — check via python
  try {
    await execFileAsync('python', ['-c', 'import pygame'], { timeout: 5000 });
    detected.push('pygame');
  } catch {
    try {
      await execFileAsync('python3', ['-c', 'import pygame'], { timeout: 5000 });
      detected.push('pygame');
    } catch { /* not found */ }
  }

  return detected;
}

// small helper to avoid importing the full 'os' module at top level
function os_homedir() {
  return process.env.USERPROFILE ?? process.env.HOME ?? 'C:/Users/Default';
}

// ── Archiver helper ───────────────────────────────────────────────────────────

function createZip(outputPath) {
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(archive));
    archive.on('error', reject);
    archive.pipe(output);

    resolve._archive = archive;
  });
}

async function buildZip(outputPath, entries) {
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    const fileList = [];

    output.on('close', () => resolve(fileList));
    archive.on('error', reject);
    archive.pipe(output);

    for (const { srcPath, zipPath } of entries) {
      archive.file(srcPath, { name: zipPath });
      fileList.push(zipPath);
    }

    archive.finalize();
  });
}

// ── POST /api/export ──────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const {
      assetIds   = [],
      engine     = 'godot',
      outputName = 'iterforge-export',
    } = req.body;

    if (!assetIds.length) {
      return res.status(400).json({ error: 'assetIds array is required and must not be empty' });
    }

    const structure = ENGINE_STRUCTURE[engine];
    if (!structure) {
      return res.status(400).json({ error: `Unsupported engine: ${engine}. Use godot, unity, unreal, or pygame.` });
    }

    // Load history
    const history = await readHistory();

    // Resolve file paths for each requested asset ID
    const entries = [];
    for (const id of assetIds) {
      const entry = history.find(h => h.id === id);
      if (!entry) continue;

      if (entry.type === '3d') {
        // GLB model
        const modelPath = path.join(MODELS_DIR, entry.filename ?? '');
        if (await fs.pathExists(modelPath)) {
          entries.push({
            srcPath: modelPath,
            zipPath: `${structure.models}/${path.basename(modelPath)}`,
          });
          // Include preview PNG if it exists
          if (entry.previewFilename) {
            const previewPath = path.join(BLENDER_ASSETS_DIR, 'previews', entry.previewFilename);
            if (await fs.pathExists(previewPath)) {
              entries.push({
                srcPath: previewPath,
                zipPath: `${structure.textures}/${entry.previewFilename}`,
              });
            }
          }
        }
      } else if (entry.type === 'sprite-sheet' || entry.sheetPath) {
        // Sprite sheet
        const sheetSrc = entry.sheetPath ?? entry.imagePath;
        if (sheetSrc && await fs.pathExists(sheetSrc)) {
          entries.push({
            srcPath: sheetSrc,
            zipPath: `${structure.sprite_sheets}/${path.basename(sheetSrc)}`,
          });
        }
      } else {
        // Standard 2D image
        const imgPath = entry.imagePath;
        if (imgPath && await fs.pathExists(imgPath)) {
          entries.push({
            srcPath: imgPath,
            zipPath: `${structure.sprites}/${path.basename(imgPath)}`,
          });
        }
      }
    }

    if (!entries.length) {
      return res.status(400).json({ error: 'No asset files found for the given IDs' });
    }

    // Build ZIP
    await fs.ensureDir(EXPORTS_DIR);
    const timestamp  = Date.now();
    const safeOutput = outputName.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || 'iterforge-export';
    const zipName    = `${safeOutput}-${timestamp}.zip`;
    const zipPath    = path.join(EXPORTS_DIR, zipName);

    const fileList = await buildZip(zipPath, entries);

    res.json({
      zipPath,
      downloadUrl: `/api/export/download/${encodeURIComponent(zipName)}`,
      fileList,
      engine,
      assetCount: fileList.length,
    });

  } catch (err) {
    console.error('[Export]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/export/engines ───────────────────────────────────────────────────

router.get('/engines', async (_req, res) => {
  try {
    const detected = await detectEngines();
    res.json({ detected });
  } catch (err) {
    res.status(500).json({ error: err.message, detected: [] });
  }
});

// ── GET /api/export/download/:filename ───────────────────────────────────────

router.get('/download/:filename', async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(EXPORTS_DIR, filename);

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: 'Export file not found' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
