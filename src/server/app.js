import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import generationRoutes  from './routes/generation.js';
import statusRoutes      from './routes/status.js';
import historyRoutes     from './routes/history.js';
import modelsRoutes      from './routes/models.js';
import templatesRoutes   from './routes/templates.js';
import comfyuiRoutes     from './routes/comfyui.js';
import setupRoutes       from './routes/setup.js';
import spriteSheetRoutes from './routes/sprite-sheet.js';
import blenderRoutes      from './routes/blender.js';
import masterforgeRoutes  from './routes/masterforge.js';
import diagnosticsRoutes  from './routes/diagnostics.js';
import smeltingRoutes    from './routes/smelting.js';
import mcpRoutes         from './routes/mcp.js';
import exportRoutes      from './routes/export.js';
import triposrRoutes     from './routes/triposr.js';
import settingsRoutes    from './routes/settings.js';
import editorRoutes      from './routes/editor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/api/generate',      generationRoutes);
  app.use('/api/sprite-sheet',  spriteSheetRoutes);
  app.use('/api/status',        statusRoutes);
  app.use('/api/history',       historyRoutes);
  app.use('/api/models',        modelsRoutes);
  app.use('/api/templates',     templatesRoutes);
  app.use('/api/comfyui',       comfyuiRoutes);
  app.use('/api/setup',         setupRoutes);
  app.use('/api/blender',       blenderRoutes);
  app.use('/api/masterforge',   masterforgeRoutes);
  app.use('/api/diagnostics',   diagnosticsRoutes);
  app.use('/api/smelting',      smeltingRoutes);
  app.use('/mcp',               mcpRoutes);
  app.use('/api/export',        exportRoutes);
  app.use('/api/triposr',       triposrRoutes);
  app.use('/api/settings',      settingsRoutes);
  app.use('/api/editor',        editorRoutes);

  // ── Serve built frontend (production) ────────────────────────────────────
  app.use(express.static(FRONTEND_DIST));
  // Express 5 wildcard syntax — serve index.html for all non-API routes (SPA)
  app.get(/.*/, (_req, res) => {
    const indexPath = path.join(FRONTEND_DIST, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) res.status(404).send('Frontend not built. Run: npm run build:frontend');
    });
  });

  return app;
}

export function startServer(port = 3000) {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      resolve({ server, port });
    });
  });
}
