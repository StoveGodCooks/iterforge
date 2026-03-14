/**
 * IterForge Electron entry point
 * Starts the Express server (localhost) then renders the UI in a BrowserWindow.
 * Users double-click the .exe — no CLI or Node.js installation required.
 */

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverPort  = null;

// ── Start Express + ComfyUI check ──────────────────────────────────────────
async function startBackend() {
  const { startServer }               = await import('./src/server/app.js');
  const { isPortOpen, startComfyUIBackground } = await import('./src/server/comfyui-manager.js');

  const { server, port } = await startServer(3000);
  server.ref(); // keep process alive

  const comfyUp = await isPortOpen('127.0.0.1', 8188);
  if (!comfyUp) await startComfyUIBackground();

  return port;
}

// ── Create the app window ───────────────────────────────────────────────────
function createWindow(port) {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    title:  'IterForge',
    icon:   iconPath,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    serverPort = await startBackend();
    createWindow(serverPort);
  } catch (err) {
    console.error('IterForge startup error:', err);
    app.quit();
  }

  app.on('activate', () => {
    // macOS: re-open window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(serverPort);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
