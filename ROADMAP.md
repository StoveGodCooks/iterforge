# IterForge — Comprehensive Roadmap

**Current Status:** V1.1 Rebuild Complete — Standardized Pipeline & Three-Tab Flow shipped
**Last Updated:** 2026-03-21

---

## Overview

IterForge is a local-first game asset generation pipeline. It treats 2D artwork as a mathematical blueprint to create high-fidelity "Solid 3D Data" and professional animation assets.

**Architecture:** Electron → Express (Node.js) → React/Vite (UI) → MasterForge Orchestrator (JS) → MasterForge Engine (Python)

---

## Phase Completion Summary

### ✅ COMPLETED (V1.1 REBUILD)

#### **Phase 0 — Config Foundation** ✓
- Implemented `assetTypes.js` registry with IPA weights and LoRA hints.
- Standards for identity locking across all asset categories.

#### **Phase 1 — Environment Upgrade** ✓
- Installed `imagehash` for perceptual drift detection.
- Deployed `Advanced-ControlNet` for per-step weight scheduling.
- Integrated `FaceID` model for high-fidelity character consistency.

#### **Phase 2 — Python Core Tools** ✓
- **quality.py:** IdentityLock scoring (phash + SSIM + Color Histogram).
- **multiview.py:** Side-view depth extraction and merged Z-profiling.
- **sprite_post.py:** Normalization, grid packing, and Godot 4 metadata.
- **export.py:** Vertex-color GLB projection and Open3D Laplacian smoothing.

#### **Phase 3 — 3D Engine (run.py)** ✓
- Added multiview CLI arguments and side-image depth routing.
- Integrated Open3D mesh smoothing into the primary STL/GLB path.
- Fixed shadow-bleeding via mask-aware nearest-foreground sampling.

#### **Phase 4 — Smelting Route** ✓
- `/api/smelting` backend for asynchronous view generation.
- Automated quality gate checks after each view is generated.

#### **Phase 5 — Pipeline Orchestrator** ✓
- Unified `MasterForgePipeline` class standardizing Generate, Multiview, Forge, and Deliver stages.
- Robust sprite sheet loop with auto-retries and structured diagnostic reports.
- Secure JSON Args IPC pattern for all Python subprocess calls.

#### **Phase 6 — Frontend (Three Tab Flow)** ✓
- **Tab 1 (FORGE):** Concept locking and identity source freezing.
- **Tab 2 (SMELTING):** Orthographic view generation with live quality scoring.
- **Tab 3 (MASTERFORGE):** Final output selection (Mesh vs Sprites) with previews.

---

### 🔨 NEXT UP — V1.2

#### **Phase 25: Manual Path Editing**
- **Status:** Planned
- **What:** Direct integration with Inkscape SVG editor to allow manual coordinate tweaking before mesh forging.
- **Scope:**
  - `POST /api/inkscape/edit` → opens current trace in Inkscape.
  - File watcher re-imports numerical coordinates on save.

#### **Phase 26: Materials Engine**
- **What:** Generate PBR maps (Metallic, Roughness, Normal) from 2D artwork.
- **Status:** Planned

---

### ⏸️ PLANNED — V2

#### **Phase 27: Godot Bridge**
- **What:** Real-time sync into active Godot projects via Editor Plugin.

---

## Key Technical Stack

| Layer | Tech | Status |
|-------|------|--------|
| **Desktop** | Electron 30.x | ✓ Stable |
| **Backend** | Express 5.x + MasterForge Orchestrator | ✓ Standardized |
| **Frontend** | React + Three-Tab Flow | ✓ Complete |
| **3D Kernel** | CadQuery (OCC) | ✓ Active |
| **Mesh Tools** | Open3D + Trimesh | ✓ Integrated |
| **AI Engine** | ComfyUI (SDXL Lightning) | ✓ Active |
| **Quality** | Perceptual Hashing + SSIM | ✓ Active |

---

## Build & Run Commands

```bash
npm run gui               # Launch Electron app (Three-Tab Flow)
npm run build:frontend    # Minify React UI
npm test                  # Run full test suite
node test/diagnostic_runner.js # Run deep pipeline diagnostics
```

**Status:** ✅ **V1.1 Rebuild complete. Ready for manual path integration.**
