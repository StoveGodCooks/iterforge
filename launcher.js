#!/usr/bin/env node
/**
 * InterForge Desktop Launcher
 * Starts the Express server, ensures ComfyUI is running, opens the browser.
 * Usage: node launcher.js  OR  npm run app
 */

import { startServer }  from './src/server/app.js';
import { isPortOpen, startComfyUIBackground } from './src/server/comfyui-manager.js';
import { exec }         from 'child_process';

const PORT = 3000;

/** Open URL in default browser — Windows-native fallback, no extra deps */
function openBrowser(url) {
  // cmd /c start is the most reliable way on Windows (works in all PS versions)
  exec(`cmd /c start "" "${url}"`, (err) => {
    if (err) {
      console.log(`  ⚠ Could not open browser automatically.`);
      console.log(`  → Open manually: ${url}`);
    }
  });
}

async function main() {
  console.log('\n  InterForge  🎨\n');

  // 1. Start Express — server.listen keeps the process alive
  console.log('  Starting server…');
  const { server, port } = await startServer(PORT);
  console.log(`  ✓ Server running on http://127.0.0.1:${port}`);

  // 2. Ensure ComfyUI
  const comfyUp = await isPortOpen('127.0.0.1', 8188);
  if (comfyUp) {
    console.log('  ✓ ComfyUI already running on :8188');
  } else {
    console.log('  Starting ComfyUI (this may take a minute)…');
    await startComfyUIBackground();
  }

  // 3. Open browser
  const url = `http://127.0.0.1:${port}`;
  console.log(`\n  Opening ${url}`);
  console.log('  Press Ctrl+C to stop.\n');
  openBrowser(url);

  // Keep process alive (server.listen already does this, but belt-and-suspenders)
  server.ref();

  process.on('SIGINT', () => {
    console.log('\n  Shutting down InterForge…');
    server.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('  Launcher error:', err.message);
  process.exit(1);
});
