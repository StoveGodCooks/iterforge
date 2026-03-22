# InterForge — Start Here

> **Every session begins with this file.**
> Read this → check ROADMAP.md → skim last DEVLOG entry → then start work.

---

## What Is InterForge?

A local-first AI game asset generation pipeline built for game developers. One `.exe` installer, no cloud accounts, no API keys, no subscriptions. Built on ComfyUI + DreamShaper XL Lightning. The goal is to be the tool game devs actually reach for when they need sprites, characters, environments, and props — fast, offline, and without the setup headache.

**Architecture:** Electron → Express (Node.js) → React/Vite/Tailwind → ComfyUI + MasterForge (Python)

---

## The Three Tab Flow

IterForge v1.1 implements a professional engineered pipeline:

1.  **✦ FORGE:** Generate 2D concept art. Lock an identity source.
2.  **♨ SMELTING:** Generate 3-4 orthographic views (Front, Side, Back) with identity locking.
3.  **⬡ MASTERFORGE:** Forge high-fidelity 3D meshes (GLB/STL/DXF) or packed Sprite Sheets with Godot metadata.

---

## Current State (v1.1)

| Area | Status |
|------|--------|
| Desktop App (Electron) | ✅ Stable |
| Backend (Express API) | ✅ Standardized via MasterForgePipeline |
| Frontend (React UI) | ✅ Three Tab Flow (Forge -> Smelt -> MasterForge) |
| Identity Locking | ✅ IP-Adapter + Quality Gate scoring |
| 3D Reconstruction | ✅ CadQuery Lofting + Open3D Smoothing |
| GLB Export | ✅ Vertex-Color Projection (Shadow-bleed fix) |
| Sprite Sheets | ✅ Normalized frames + Godot .tres support |
| License Gating | ✅ Tier-aware feature locking |
| Security | ✅ Secure JSON Args IPC pattern |
| Optimization | ✅ Lazy-loaded 3D ModelViewer |

---

## Technical Contracts

### Identity Quality Gates
The pipeline uses a structured error response when an AI-generated view fails to match the locked identity source. This allows the UI to render a "Diagnostic Card" with actionable suggestions.

**Error Shape:** `QUALITY_GATE_FAILURE`
- `score`: The combined phash + color score achieved.
- `threshold`: The target score for the specific asset type.
- `diagnosis`: List of specific failure reasons (e.g., color drift).
- `suggestion`: List of fixes (e.g., increase IP-Adapter weight).

---

## Session Start Checklist

Before writing a single line of code, run through these:

- [x] Read this file fully
- [x] Open `ROADMAP.md` — check what's in progress and what's next
- [x] Read the last entry in `DEVLOG.md` — get back in the headspace
- [x] Run `npm run gui` — confirm the app boots and ComfyUI dot is green
- [ ] Check git status — know what's staged, what's dirty

---

## Key Commands

```bash
npm run gui               # Launch the Electron app
npm run dev:server        # Express backend only (port 3000)
npm run build:frontend    # Rebuild React UI (required after frontend changes)
npm run build:exe         # Full Windows installer build
npm test                  # Run test suite
node test/diagnostic_runner.js <image> # Deep pipeline diagnostic
```

---

## Key Files Map

```
electron-main.js                     # App entry — starts Express + ComfyUI
src/pipeline/orchestrator.js         # MasterForgePipeline — Standardized orchestrator
src/server/app.js                    # Express server setup
src/server/routes/smelting.js        # Multiview identity locking routes
src/server/routes/masterforge.js     # 3D pipeline routes
src/3d/masterforge/run.py            # 3D Generative Engine entry point
src/3d/masterforge/quality.py        # IdentityLock & alignment scoring
src/3d/masterforge/sprite_post.py    # Sprite normalization & packing
frontend/src/App.jsx                 # Main layout & Three Tab logic
frontend/src/components/
  SmeltingPanel.jsx                  # Tab 2 UI — View generation & Quality Gates
  MasterForgeOutputPanel.jsx         # Tab 3 UI — Mesh & Sprite forks
  ModelViewer.jsx                    # Babylon.js GLB viewer
```

---

## Reference Files

- 📋 **[ROADMAP.md](ROADMAP.md)** — All phases, completion status, what's next, last session summary
- 📓 **[DEVLOG.md](DEVLOG.md)** — Session journal, architectural decisions, dead ends, wins
- 📘 **[MASTERFILE.md](MASTERFILE.md)** — Master Architectural Blueprint
