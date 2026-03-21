/**
 * Dev-mode Express server (no browser open, no ComfyUI spawn).
 * Run alongside `npm run dev:frontend` for hot-reload development.
 * The Vite dev server proxies /api → this server (see vite.config.js).
 */
import { startServer } from './app.js';

const PORT = 3000;
const { port } = await startServer(PORT);
console.log(`Inter-Forge API server running on http://127.0.0.1:${port}`);
console.log('Run `npm run dev:frontend` in another terminal for the Vite dev server.');
