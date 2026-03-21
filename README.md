# InterForge — Start Here

> **Every session begins with this file.**
> Read this → check ROADMAP.md → skim last DEVLOG entry → then start work.

---

## What Is InterForge?

A local-first AI game asset generation pipeline built for game developers. One `.exe` installer, no cloud accounts, no API keys, no subscriptions. Built on ComfyUI + DreamShaper XL Lightning. The goal is to be the tool game devs actually reach for when they need sprites, characters, environments, and props — fast, offline, and without the setup headache.

**Stack:** Electron → Express (Node.js) → React/Vite/Tailwind → ComfyUI (Python)

---

## Current State

| Area | Status |
|------|--------|
| Desktop App (Electron) | ✅ Stable |
| Backend (Express API) | ✅ Stable |
| Frontend (React UI) | ✅ Stable |
| ComfyUI Integration | ✅ Working |
| Model: DreamShaper XL Lightning | ✅ Active |
| 3D Reconstruction (TripoSR) | ✅ Working — auto-chain, upright mesh, textured |
| 3D Viewer (Babylon.js) | ✅ Working |
| MCP Server (Claude integration) | ✅ Working — full blocking image+3D pipeline |
| Sprite Sheet Generator | ✅ Working |
| Settings Panel | ✅ Working |
| Batch Generation | ⏳ Planned |
| Inpainting / Variations | ⏳ Planned |
| Multi-view Texturing (Zero123++) | ⏳ Planned (V1.2) |

---

## Session Start Checklist

Before writing a single line of code, run through these:

- [ ] Read this file fully
- [ ] Open `ROADMAP.md` — check what's in progress and what's next
- [ ] Read the last entry in `DEVLOG.md` — get back in the headspace
- [ ] Run `npm run gui` — confirm the app boots and ComfyUI dot is green
- [ ] Check git status — know what's staged, what's dirty

---

## Session End Checklist

Before closing out, always do these:

- [ ] Commit working code — specific files, clear message
- [ ] Update `ROADMAP.md` — mark completed phases, update next steps and last session summary
- [ ] Write a `DEVLOG.md` entry — date, what was done, decisions made, problems hit, wins, dead ends
- [ ] Update the Current State table above if anything changed

---

## Key Commands

```bash
npm run gui               # Launch the Electron app
npm run dev:server        # Express backend only (port 3000)
npm run build:frontend    # Rebuild React UI (required after frontend changes)
npm run build:exe         # Full Windows installer build
npm run clean             # Wipe dist/ folder
npm test                  # Run test suite
```

---

## Key Files Map

```
electron-main.js                     # App entry — starts Express + ComfyUI
src/server/app.js                    # Express server setup
src/server/routes/generation.js      # POST /api/generate (core generation logic)
src/server/routes/triposr.js         # POST /api/triposr/generate + polling + file serve
src/server/routes/history.js         # GET /api/history
src/server/routes/status.js          # GET /api/status (ComfyUI + server health)
src/server/comfyui-manager.js        # ComfyUI subprocess manager
src/env/manager.js                   # Python install + model download
src/backends/comfyui.js              # ComfyUI HTTP client
src/backends/triposr.js              # TripoSR subprocess spawner + Python detection
src/mcp/server.js                    # MCP stdio server (Claude integration)
src/mcp/tools.js                     # MCP tool handlers — generate_asset (full pipeline)
src/3d/inference/triposr_infer.py    # TripoSR pipeline: preprocess → infer → UV → GLB
frontend/src/App.jsx                 # Main UI layout
frontend/src/components/
  GenerationPanel.jsx                # Left sidebar — controls + silent 3D auto-chain
  PreviewArea.jsx                    # Main canvas + history strip + 3D viewer
  ModelViewer.jsx                    # Babylon.js GLB viewer component
  SettingsPanel.jsx                  # Config + TripoSR prefetch panel
comfyui-workflows/
  txt2img-dreamshaper.json           # Base workflow template
```

---

## Where Things Live on Disk

| Asset | Path |
|-------|------|
| Models (checkpoints) | `%APPDATA%\IterForge\comfyui\models\checkpoints\` |
| Generation history | `%APPDATA%\IterForge\history.json` |
| ComfyUI output images | `%APPDATA%\IterForge\comfyui\output\` |
| TripoSR weights (~1GB) | `%APPDATA%\IterForge\3d\weights\triposr\` |
| TripoSR source package | `%APPDATA%\IterForge\3d\tsr_pkg\TripoSR\` |
| 3D output (GLBs) | `%APPDATA%\IterForge\3d\triposr-out\` |
| Built installer | `dist\InterForge-Setup-x.x.x.exe` |

---

## Reference Files

- 📋 **[ROADMAP.md](ROADMAP.md)** — All phases, completion status, what's next, last session summary
- 📓 **[DEVLOG.md](DEVLOG.md)** — Session journal, architectural decisions, dead ends, wins
