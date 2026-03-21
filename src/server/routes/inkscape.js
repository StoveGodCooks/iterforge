/**
 * inkscape.js route — Inter-Forge Inkscape integration
 *
 *   GET  /api/inkscape/status          — detect Inkscape
 *   POST /api/inkscape/open            — open image in Inkscape GUI + watch for live sync
 *   GET  /api/inkscape/edited/:filename — serve edited PNG results
 */

import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ITERFORGE_HOME } from '../../env/reader.js';
import {
  detectInkscape,
  openGui,
  exportToPng,
  makeSvgWrapper,
  watchFile,
} from '../../backends/inkscape.js';
import { writeHistory, ASSETS_DIR } from './history.js';

const router = express.Router();

// Working directory: SVG wrappers and edited PNGs live here
const INKSCAPE_WORK_DIR = path.join(ITERFORGE_HOME, 'inkscape-work');
await fs.ensureDir(INKSCAPE_WORK_DIR);

// Active Inkscape sessions: svgPath → { watcher, historyId, outputPng, stop() }
const activeSessions = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSettingsPath(req) {
  return req.headers['x-inkscape-path'] || null;
}

// ── GET /api/inkscape/status ──────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const info = await detectInkscape(getSettingsPath(req));
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/inkscape/open ───────────────────────────────────────────────────
// Body: { filename, historyId }
// Opens the image in Inkscape GUI. Watches the SVG for saves and exports to PNG.
router.post('/open', async (req, res) => {
  try {
    const { filename, historyId } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename is required' });

    const inkscapeInfo = await detectInkscape(getSettingsPath(req));
    if (!inkscapeInfo.found) {
      return res.status(503).json({ error: 'Inkscape not found', notFound: true });
    }

    // Resolve source PNG
    const sourcePng = [
      path.join(ASSETS_DIR, filename),
      path.join(ASSETS_DIR, 'frames', filename),
    ].find(p => fs.pathExistsSync(p));

    if (!sourcePng) {
      return res.status(404).json({ error: `Source image not found: ${filename}` });
    }

    // Output paths in working directory
    const stem    = path.basename(filename, path.extname(filename));
    const svgPath = path.join(INKSCAPE_WORK_DIR, `${stem}_edit.svg`);
    const outPng  = path.join(INKSCAPE_WORK_DIR, `${stem}_edited.png`);

    // Create SVG wrapper with the PNG embedded
    await makeSvgWrapper(sourcePng, svgPath);

    // Stop any existing session on this file
    if (activeSessions.has(svgPath)) {
      activeSessions.get(svgPath).watcher.stop();
      activeSessions.delete(svgPath);
    }

    // Open in Inkscape GUI
    const { pid } = openGui({ inkscapeExe: inkscapeInfo.path, filePath: svgPath });

    // Watch SVG for saves — re-export to PNG on each save
    const watcher = watchFile(svgPath, async () => {
      console.log(`[Inter-Forge] Inkscape saved ${svgPath} — re-exporting PNG`);
      try {
        const result = await exportToPng({
          inkscapeExe: inkscapeInfo.path,
          inputPath:   svgPath,
          outputPng:   outPng,
        });

        if (result.success && await fs.pathExists(outPng)) {
          // Copy edited PNG back into assets dir with a new filename
          const editedFilename = `${stem}_edited_${Date.now()}.png`;
          const editedDest     = path.join(ASSETS_DIR, editedFilename);
          await fs.copy(outPng, editedDest);

          // Update history entry if historyId was provided
          if (historyId) {
            await writeHistory(history =>
              history.map(e => {
                if (e.id !== historyId) return e;
                return {
                  ...e,
                  filename:  editedFilename,
                  timestamp: Date.now(),
                  inkscapeEdited: true,
                };
              })
            );
          }
          console.log(`[Inter-Forge] Inkscape export complete → ${editedDest}`);
        } else {
          console.warn('[Inter-Forge] Inkscape export failed:', result.stderr.slice(0, 200));
        }
      } catch (err) {
        console.warn('[Inter-Forge] Inkscape watch export error:', err.message);
      }
    });

    // Register session — auto-cleanup after 4 hours
    const session = { watcher, pid, svgPath, outPng, historyId };
    activeSessions.set(svgPath, session);
    setTimeout(() => {
      if (activeSessions.get(svgPath) === session) {
        watcher.stop();
        activeSessions.delete(svgPath);
      }
    }, 4 * 60 * 60 * 1000);

    res.json({ success: true, pid, svgPath, watchActive: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/inkscape/quick-op ───────────────────────────────────────────────
// Headless quick operations: resize, rotate, flip, export copy
// Body: { filename, historyId, op, params }
//   op: 'resize'  params: { width, height }
//   op: 'rotate'  params: { angle: 90|180|270|-90 }
//   op: 'flip'    params: { axis: 'h'|'v' }
//   op: 'export'  params: {} — just export current as new PNG copy
router.post('/quick-op', async (req, res) => {
  try {
    const { filename, historyId, op, params = {} } = req.body;
    if (!filename || !op) return res.status(400).json({ error: 'filename and op required' });

    const inkscapeInfo = await detectInkscape(getSettingsPath(req));
    if (!inkscapeInfo.found) return res.status(503).json({ error: 'Inkscape not found', notFound: true });

    const sourcePng = [
      path.join(ASSETS_DIR, filename),
      path.join(ASSETS_DIR, 'frames', filename),
    ].find(p => fs.pathExistsSync(p));
    if (!sourcePng) return res.status(404).json({ error: 'Source image not found' });

    const stem     = path.basename(filename, path.extname(filename));
    const outName  = `${stem}_${op}_${Date.now()}.png`;
    const outPng   = path.join(INKSCAPE_WORK_DIR, outName);

    // Build inkscape CLI args for the operation
    const args = [];

    if (op === 'resize') {
      if (params.width)  args.push(`--export-width=${params.width}`);
      if (params.height) args.push(`--export-height=${params.height}`);
    } else if (op === 'rotate') {
      // Inkscape headless rotate: use --actions
      const deg = params.angle ?? 90;
      args.push(`--actions=select-all;transform-rotate:${deg};export-filename:${outPng};export-do`);
    } else if (op === 'flip') {
      const flipAction = params.axis === 'v'
        ? 'select-all;object-flip-vertical'
        : 'select-all;object-flip-horizontal';
      args.push(`--actions=${flipAction};export-filename:${outPng};export-do`);
    }

    // For rotate/flip we use --actions which handles export internally
    const useActions = op === 'rotate' || op === 'flip';
    if (!useActions) {
      args.push(`--export-type=png`, `--export-filename=${outPng}`);
    }
    args.push(sourcePng);

    const result = await exportToPng({
      inkscapeExe: inkscapeInfo.path,
      inputPath:   sourcePng,
      outputPng:   outPng,
      ...(params.width  ? { width:  params.width  } : {}),
      ...(params.height ? { height: params.height } : {}),
    });

    // For rotate/flip, run with raw args via a different approach
    if (op === 'rotate' || op === 'flip') {
      const { spawn } = await import('child_process');
      await new Promise((resolve) => {
        const actionStr = op === 'rotate'
          ? `select-all;transform-rotate:${params.angle ?? 90};export-filename:${outPng};export-do`
          : params.axis === 'v'
            ? `select-all;object-flip-vertical;export-filename:${outPng};export-do`
            : `select-all;object-flip-horizontal;export-filename:${outPng};export-do`;

        const child = spawn(inkscapeInfo.path, [
          `--actions=${actionStr}`,
          sourcePng,
        ], { windowsHide: true });
        child.on('close', resolve);
        child.on('error', resolve);
        setTimeout(resolve, 30_000);
      });
    }

    if (!(await fs.pathExists(outPng))) {
      return res.status(500).json({ error: `Quick-op failed: ${result.stderr?.slice(0, 200) || 'no output file'}` });
    }

    // Copy into assets and optionally update history
    const finalName = outName;
    const finalDest = path.join(ASSETS_DIR, finalName);
    await fs.copy(outPng, finalDest);

    if (historyId) {
      await writeHistory(history =>
        history.map(e => e.id !== historyId ? e : {
          ...e,
          filename:  finalName,
          timestamp: Date.now(),
          inkscapeEdited: true,
        })
      );
    }

    res.json({ success: true, filename: finalName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/inkscape/paint-apply ────────────────────────────────────────────
// Save a browser-side canvas result (base64 PNG) as a new history entry
// Body: { imageData: 'data:image/png;base64,...', filename, historyId }
router.post('/paint-apply', async (req, res) => {
  try {
    const { imageData, filename, historyId } = req.body;
    if (!imageData || !filename) return res.status(400).json({ error: 'imageData and filename required' });

    // Strip data URI prefix and decode
    const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    const stem        = path.basename(filename, path.extname(filename));
    const newFilename = `${stem}_painted_${Date.now()}.png`;
    const newPath     = path.join(ASSETS_DIR, newFilename);

    await fs.outputFile(newPath, buffer);

    if (historyId) {
      await writeHistory(history =>
        history.map(e => e.id !== historyId ? e : {
          ...e,
          filename:  newFilename,
          timestamp: Date.now(),
          inkscapeEdited: true,
        })
      );
    }

    res.json({ success: true, filename: newFilename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/inkscape/edited/:filename — serve edited PNGs ────────────────────
router.get('/edited/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(INKSCAPE_WORK_DIR, filename);
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(filePath);
});

export default router;
