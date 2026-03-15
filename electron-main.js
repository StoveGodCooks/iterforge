/**
 * InterForge Electron entry point
 * Starts the Express server (localhost) then renders the UI in a BrowserWindow.
 * Users double-click the .exe — no CLI or Node.js installation required.
 */

import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverPort  = null;

// Inline loading page shown while Express + ComfyUI spin up
const LOADING_HTML = `data:text/html,
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: #0f1117;
    color: #94a3b8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 16px;
  }
  .logo { color: #818cf8; font-size: 24px; font-weight: 700; letter-spacing: .05em; }
  .msg  { font-size: 13px; opacity: .6; }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid #1e293b;
    border-top-color: #818cf8;
    border-radius: 50%;
    animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="logo">InterForge</div>
  <div class="spinner"></div>
  <div class="msg">Starting server…</div>
</body>
</html>`;

// ── Start Express + ComfyUI ─────────────────────────────────────────────────
async function startBackend() {
  const { startServer }          = await import('./src/server/app.js');
  const { isPortOpen, isComfyInstalled } = await import('./src/server/comfyui-manager.js');
  const { triggerSetup }         = await import('./src/server/routes/setup.js');

  const { server, port } = await startServer(3000);
  server.ref(); // keep process alive

  const comfyUp = await isPortOpen('127.0.0.1', 8188);
  if (comfyUp) return port;

  // Always run the idempotent setup — it skips completed steps via marker files.
  // On first run this installs Python + ComfyUI + torch + model (~10 GB total).
  // On subsequent runs it verifies torch is present and starts ComfyUI.
  const installed = await isComfyInstalled();
  console.log(`[InterForge] ComfyUI installed: ${installed} — running setup check…`);
  triggerSetup();

  return port;
}

// ── Create the app window ───────────────────────────────────────────────────
function createWindow(port) {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    title:  'InterForge',
    icon:   iconPath,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Show loading page immediately, then swap to the app once Express is ready
  mainWindow.loadURL(LOADING_HTML);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Open the window first so the user sees the loading screen immediately
  createWindow();

  try {
    serverPort = await startBackend();
    // Now swap the loading page for the real app
    if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  } catch (err) {
    console.error('InterForge startup error:', err);
    if (mainWindow) {
      mainWindow.loadURL(`data:text/html,<body style="background:#0f1117;color:#f87171;font-family:sans-serif;padding:40px">
        <h2>Startup error</h2><pre style="margin-top:12px;font-size:12px">${err.message}</pre>
      </body>`);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (serverPort && mainWindow) mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
