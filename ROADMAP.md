# IterForge — Comprehensive Roadmap

**Current Status:** V1.2 Complete — Final polish pass done (Phase 24), 20 critical fixes shipped, Settings tab added
**Last Updated:** 2026-03-15

---

## Overview

IterForge is a local-first game asset generation pipeline. Users download a single `.exe`, click it, and get a professional web UI for generating sprites, environments, props, characters, etc. via AI (ComfyUI + DreamShaper XL Lightning). Everything stays on their machine — no cloud, no API keys, no telemetry.

**Architecture:** Electron (desktop shell) → Express (Node.js backend) + React/Vite (frontend UI) → ComfyUI (image generation)

---

## Phase Completion Summary

### ✅ COMPLETED PHASES (1–24)

#### **Phase 1: Environment Detection & Setup** ✓
- Detect system capabilities (Python, ComfyUI, GPU, Docker)
- Python 3.11.9 bundled installer
- CUDA detection (torch availability check)
- ComfyUI idempotent installation with marker files
- **Files:** `src/env/detector.js`, `src/env/manager.js`, `src/env/reader.js`

---

#### **Phase 2: Project Context Management** ✓
- Read/write/update `iterforge.json` project config with atomic writes
- Schema validation, atomic writes via `.tmp` → rename pattern
- Support for generation history, custom templates
- **Files:** `src/context/schema.js`, `src/context/manager.js`

---

#### **Phase 3: Prompt Engine** ✓
- Build positive/negative prompts from asset type + art style + subject
- Automatic quality tags + negative prompt building
- **Files:** `src/prompts/engine.js`, `src/prompts/templates.js`

---

#### **Phase 4: ComfyUI Backend Integration** ✓
- Local ComfyUI subprocess management + HTTP API client
- Health check, workflow token injection, polling, image retrieval
- **Files:** `src/backends/comfyui.js`, `src/server/comfyui-manager.js`

---

#### **Phase 5: Express Backend Server** ✓
- Full HTTP API: `/api/generate`, `/api/history`, `/api/templates`, `/api/models`, `/api/status`
- CORS, error handling middleware
- **Files:** `src/server/app.js`, `src/server/routes/`

---

#### **Phase 6: React Frontend — Layout & Components** ✓
- GenerationPanel (left sidebar), PreviewArea (main canvas + history strip), SettingsPanel
- Responsive dark theme, smooth animations
- **Files:** `frontend/src/App.jsx`, `frontend/src/components/`

---

#### **Phase 7: Reference Image Support** ✓
- File upload (max 25MB, PNG/JPG), thumbnail preview
- img2img passed to ComfyUI workflow, temp files auto-cleaned
- **Files:** `frontend/src/components/GenerationPanel.jsx`, `src/server/routes/generation.js`

---

#### **Phase 8: Generation History & Templates** ✓
- History in `%APPDATA%/IterForge/history.json` with metadata
- Thumbnail gallery, custom template CRUD
- **Files:** `src/server/routes/generation.js`, `src/server/routes/templates.js`

---

#### **Phase 9: Model Management** ✓
- Default: DreamShaper XL Lightning (6.94GB)
- Model selector lists all `.safetensors` in checkpoints folder
- **Files:** `src/env/manager.js`

---

#### **Phase 10: ComfyUI Workflow Setup** ✓
- SDXL workflow template with token placeholders
- Euler sampler, optimized for Lightning models
- **Files:** `comfyui-workflows/txt2img-dreamshaper.json`

---

#### **Phase 11: Electron Desktop App Shell** ✓
- Single-click launcher, loading screen, graceful shutdown
- Always calls `triggerSetup()` on launch for idempotent init
- **Files:** `electron-main.js`

---

#### **Phase 12: Windows Installer (NSIS)** ✓
- `InterForge-Setup-1.0.0.exe` with NSIS
- Desktop + Start Menu shortcuts, built via `npm run build:exe`
- **Files:** `package.json` build scripts

---

#### **Phase 13: Settings Panel & Configuration UI** ✓
- Model selection, resolution picker, storage management, privacy notice, version info
- **Files:** `frontend/src/components/SettingsPanel.jsx`

---

#### **Phase 14: Error Handling & User Feedback** ✓
- Error codes, red banner UI, actionable fixes, OOM detection, timeout handling
- All errors logged to console

---

#### **Phase 15: CLI Entry Point** ✓
- `npm start` launcher, `iterforge doctor` health check
- **Files:** `bin/iterforge.js`, `src/cli/doctor.js`

---

#### **Phase 16: Vite Build Pipeline** ✓
- `npm run build:frontend` → minified React, CSS bundling, code splitting
- **Files:** `frontend/vite.config.js`

---

#### **Phase 17: Cleaning & File Organization** ✓
- Removed old launcher.js, spec.docx, duplicate installers
- Added `npm run clean` script
- **Session:** 2026-03-14

---

#### **Phase 18: Asset Type & Art Style Refactor** ✓
- Moved from arena/card presets to general game dev pipeline
- Type dropdown + Style dropdown + Subject input in GenerationPanel
- **Session:** 2026-03-14

---

#### **Phase 19: DreamShaper XL Lightning Upgrade** ✓
- Replaced SDXL base with DreamShaper XL Lightning (6.94GB)
- Steps=6, CFG=2, euler sampler — generation confirmed working
- Model: `%APPDATA%\IterForge\comfyui\models\checkpoints\DreamShaperXL_Lightning.safetensors`
- **Session:** 2026-03-14

---

#### **Phase 20: Regeneration Bug Fix** ✓
- **Problem:** Re-generating same prompt always returned the same image
- **Root cause 1:** Seed check `seed !== null` passed for empty string `''`, so `Number('') = 0` → always seed 0
- **Fix:** Full null/empty/undefined guard: `(seed !== null && seed !== '' && seed !== undefined)`
- **Root cause 2:** Filename collision when seed happened to repeat
- **Fix:** Appended short jobId hash to filename: `` `${slug}_${seed}_${jobId.slice(-6)}.png` ``
- **Root cause 3:** Browser cached image URL between generations
- **Fix:** Cache-bust via `?t=${entry.timestamp}` on all image URLs; `Cache-Control: no-store` header on image route
- **Files:** `src/server/routes/generation.js`, `frontend/src/components/PreviewArea.jsx`
- **Session:** 2026-03-15

---

#### **Phase 21: Sprite Sheet Generator** ✓
- Batch-generate N frames with different seeds, stitch into grid PNG via Sharp
- `POST /api/sprite-sheet` → generates frames in batches of 2 (VRAM safe) → composites grid
- Grid layouts: 2×2, 3×3, 4×4, 2×4, 4×2
- Individual frames saved to `ASSETS_DIR/frames/`, accessible via `/api/sprite-sheet/frame/:filename`
- SpriteSheetPanel tab in GenerationPanel with grid size picker + VRAM warnings
- PreviewArea shows individual frames in expandable "⊞ Individual Frames" section
- History strip shows ⊞ badge on sprite sheet entries
- **Files:** `src/server/routes/sprite-sheet.js`, `frontend/src/components/SpriteSheetPanel.jsx`, `frontend/src/components/PreviewArea.jsx`
- **Session:** 2026-03-15

---

#### **Phase 22: Preset Library Expansion** ✓
- **Asset types expanded:** 16 types (added Particle Effect, Tileset, Icon/Badge, Skybox, VFX/Spell, Portrait, Building/Structure, Item/Weapon)
- **Art styles expanded:** 14 styles (added Watercolor, Cartoon, Dark Fantasy, Isometric, Sci-Fi, Chibi, Painterly, Ink/Sketch)
- **Game genre selector:** 9 genres (Fantasy RPG, Sci-Fi, Horror, Platformer, Top-Down, Metroidvania, Puzzle, Strategy, Cyberpunk) — each adds genre-specific quality terms to prompt
- **Pro Tools toggles:** 6 toggles (Seamless/Tiling, Clean Cutout, Char. Sheet, High Detail, Game Ready, Concept Lined) — each adds/removes specific prompt terms
- **Template preview:** selecting a template shows prompt, negative, steps/CFG/resolution pills before generating
- **Files:** `frontend/src/components/GenerationPanel.jsx`, `src/server/routes/generation.js`
- **Session:** 2026-03-15

---

#### **Phase 23: UI/UX Polish Pass** ✓
- **Cancel button:** mid-generation cancel via `cancelRef` flag pattern + interval clear
- **Ctrl+Enter shortcut:** global keydown listener triggers generate
- **localStorage persistence:** all panel settings auto-saved under key `interforge_panel_v1`
- **Reuse settings:** ↩ Reuse button on any history entry reloads all its params into GenerationPanel
- **Copy seed:** clickable pill, copies to clipboard, shows ✓ for 1.5s
- **Copy prompt:** button next to prompt text, same pattern
- **Expand prompt:** click prompt text to toggle truncate/full
- **Model loading feedback:** elapsed ≤12s → "Generating…", ≤30s → "Loading model into VRAM…", else → "Almost there…"
- **FREE → LOCAL badge fix:** `status.js` default tier changed from `'free'` to `'local'`
- **Bulk history clear:** "Clear all" button in history strip header → `DELETE /api/history/all`
- **Layout fix:** `min-h-0` on scrollable container keeps Generate button always visible
- **Improved EmptyState:** explains workflow, lists asset type chips, shows Ctrl+Enter tip
- **Bigger history strip:** 144px (was 128px) for better thumbnail visibility
- **Files:** `frontend/src/components/GenerationPanel.jsx`, `frontend/src/components/PreviewArea.jsx`, `src/server/routes/status.js`, `src/server/routes/history.js`
- **Session:** 2026-03-15

---

#### **Phase 24: Final Polish Pass** ✓
- **9 Backend critical fixes:**
  - Job map TTL cleanup — `jobs` and `sheetJobs` Maps now auto-delete completed/failed entries after 10min
  - Path traversal hardening — `path.basename()` on all 3 file-serving routes (`/image/:filename`, `/frame/:filename`, compose `frameFilenames`)
  - `req._styleNeg` hack removed — lifted to local variable before the mode branch
  - History write race condition — `writeHistory()` serializes concurrent writes via promise queue
  - Seed NaN guard — `Number.isFinite()` check after conversion before sending to ComfyUI
  - Input range validation — steps (1–50), CFG (1–20), width/height (128–2048)
- **11 Frontend fixes:**
  - `window.confirm()` → inline confirm row (Confirm/Cancel) for delete buttons
  - `window.prompt()` → inline text input for template save (with auto-focus, Enter/Escape handling)
  - Disabled button visual states (opacity-40 + cursor-not-allowed) on Clear All + Compose
  - Image loading skeleton — grey pulse rect while image loads, fades when `onLoad` fires
  - Escape key closes zoom modal — `useEffect` keydown listener
  - Clipboard copy failure shows `✗` (red) instead of `✓` for 1.5s
  - History loading skeleton — 3 shimmer boxes while initial history fetch is in-flight
  - Status polling re-acceleration — if ComfyUI goes offline after being up, poll re-accelerates to 2s
  - SettingsPanel.jsx created — Blender path input, model selector, storage dir, system status, version info
  - Settings tab wired into App.jsx tab bar (✦ Single | ⊞ Sheet | ⚙ Settings)
  - Compose disabled visual fixed in SpriteSheetPanel
- **Files:** `generation.js`, `sprite-sheet.js`, `history.js`, `PreviewArea.jsx`, `GenerationPanel.jsx`, `SpriteSheetPanel.jsx`, `App.jsx`, `SettingsPanel.jsx` (new)
- **Session:** 2026-03-15

---

### 🔨 NEXT UP — V1.3

#### **Phase 25: Blender Integration**
- **Status:** Not Started
- **What:** Apply generated textures to 3D meshes via headless Blender subprocess; view result in Babylon.js 3D viewer
- **Scope:**
  - `POST /api/blender/texture-mesh` → orchestrates ComfyUI texture → Blender apply → export GLB
  - Auto-detect Blender at common Windows install paths (+ user-set path from Settings)
  - Base mesh library: 15 CC0 GLBs (characters, props, environment, architecture)
  - Python bpy script: import mesh → apply texture material → export GLB
  - Frontend: new "⬡ 3D" tab — mesh picker, texture source selector, export format
  - Babylon.js web component for GLB preview in PreviewArea
  - VRAM queue: serializes Blender and ComfyUI jobs to avoid 8-10GB conflict
- **CLI:** `iterforge 3d:apply`, `3d:render`, `3d:batch`, `doctor:blender`
- **Files to create:** `src/server/routes/blender.js`, `src/backends/blender-utils.js`, `src/3d/templates/apply_texture.py`, `src/3d/templates/render_preview.py`, `src/3d/base-meshes/`, `frontend/src/components/BlenderPanel.jsx`, `frontend/src/components/ModelViewer.jsx`
- **npm:** `npm install @babylonjs/viewer`

---

### ⏸️ PLANNED — V2

#### **Phase 26: MCP (Model Context Protocol) Server**
- **What:** Expose IterForge as Claude/Gemini CLI plugin
- **Status:** Not Started
- **Priority:** Medium
- **Scope:**
  - Tools: `generate_asset`, `read_project_context`, `write_project_context`, `get_backend_status`, `get_generation_history`
  - Stdio JSON-RPC interface
  - Command: `iterforge mcp` starts server
- **Files to create:** `src/mcp/server.js`, `src/mcp/tools/`

---

#### **Phase 27: Godot Editor Plugin**
- **What:** Auto-import generated assets into Godot 4 projects
- **Status:** Not Started
- **Priority:** Medium
- **Scope:**
  - EditorPlugin dock widget in Godot
  - Polls `iterforge.json` every 2s
  - Auto-imports new assets from `pending_assets` list
  - Write collision safety via `.lock` files
- **Files to create:** `godot-plugin/addons/iterforge/`

---

#### **Phase 28: Batch Generation Queue**
- **What:** Queue multiple generation jobs, run sequentially with progress tracking
- **Status:** Deferred to V2
- **Priority:** Medium
- **Scope:**
  - Queue UI: add N jobs, each with independent prompt/settings
  - Per-job progress bar, pause/cancel support
- **Files to create:** `frontend/src/components/BatchPanel.jsx`, `src/server/routes/batch.js`

---

#### **Phase 29: Inpainting & Asset Variations**
- **What:** Edit specific regions of generated images; generate N variations
- **Status:** Deferred to V2
- **Priority:** Medium
- **Scope:** Draw mask on image, reprompt region; variation mode via different seeds
- **Files to modify:** `comfyui-workflows/`, `src/server/routes/generation.js`, frontend

---

#### **Phase 30: Documentation & Examples**
- **What:** Quickstart guide, API reference, example Godot project
- **Status:** Not Started
- **Priority:** Medium (before public release)
- **Scope:**
  - `docs/quickstart.md`
  - `docs/api-reference.md`
  - `docs/troubleshooting.md`
  - `example-projects/godot-game/`

---

#### **Phase 30: Public Release & Beta**
- **What:** Publish on GitHub, installer downloads, community setup
- **Status:** Not Started
- **Priority:** Critical (after V1.2 stable)
- **Scope:**
  - GitHub release with `.exe` download
  - Privacy policy page
  - Discord/community setup
  - Bug report template

---

## Most Recent Session Summary (2026-03-15 — Session 2)

### What Was Done (Phase 24: Final Polish Pass)

**Backend critical fixes (9 items):**
1. Job map TTL cleanup — both `jobs` and `sheetJobs` Maps now auto-delete after 10min
2. Path traversal hardening — `path.basename()` on all file-serving endpoints
3. `req._styleNeg` mutation removed — lifted to clean local variable
4. History write race condition — `writeHistory()` queue serializes concurrent writes
5. Seed NaN guard — `Number.isFinite()` check added
6. Input range validation — steps (1–50), CFG (1–20), dimensions (128–2048)

**Frontend fixes (11 items):**
7. Inline delete confirm (Confirm/Cancel row) replaces `window.confirm()`
8. Inline template name input replaces `window.prompt()`
9. Disabled visual states on Clear All + Compose buttons
10. Image loading skeleton — grey pulse until `onLoad` fires
11. Escape key closes zoom modal
12. Clipboard failure shows `✗` in red for 1.5s
13. History loading skeleton — 3 shimmer boxes on startup
14. Status polling re-acceleration when ComfyUI goes offline after being up
15. SettingsPanel.jsx created (Blender path, model selector, storage dir, status, version)
16. Settings tab wired into sidebar tab bar
17. Compose button disabled visual fixed in SpriteSheetPanel

**Exe rebuilt, ROADMAP + DEVLOG updated.**

---

## Previous Session Summary (2026-03-15 — Session 1)

### What Was Done

1. **Regeneration bug fixed (Phase 20)**
   - Seed was always 0 because `Number('') === 0` slipped through the null check
   - Fixed: full `null/empty/undefined` guard on seed input
   - Added jobId hash suffix to filenames to prevent collision on same seed
   - Added `Cache-Control: no-store` header + `?t=timestamp` cache-bust on image URLs

2. **Sprite Sheet Generator shipped (Phase 21)**
   - Already fully scaffolded from a prior session — polished UI and wired it up
   - VRAM-safe batch generation (2 frames at a time), Sharp compositing
   - Individual frames accessible in expandable panel below image metadata
   - History strip badges for sprite sheet entries

3. **Preset library expanded (Phase 22)**
   - 16 asset types, 14 art styles, 9 game genres
   - Pro Tools toggles (6 toggles adding prompt modifiers)
   - Template preview before generating

4. **Full UI/UX polish pass (Phase 23)**
   - Cancel button, Ctrl+Enter, localStorage persistence, Reuse settings
   - Copy seed/prompt with ✓ feedback, expand prompt
   - Model loading lag messages (3 tiers based on elapsed time)
   - FREE badge renamed to LOCAL
   - Bulk history clear
   - Layout fix (Generate button always pinned visible)

5. **Session docs updated**
   - `README.md` — start-here briefing
   - `DEVLOG.md` — session journal + architectural decisions
   - `ROADMAP.md` — this file, now fully up to date

6. **New exe built**
   - `dist/InterForge-Setup-1.0.0.exe` rebuilt with all V1.1 changes

### Next Session
- Phase 25: Blender Integration — subprocess + Babylon.js 3D viewer

---

## Key Technical Stack

| Layer | Tech | Status |
|-------|------|--------|
| **Desktop** | Electron 30.x | ✓ Complete |
| **Backend** | Express 5.x + Node 20+ | ✓ Complete |
| **Frontend** | React + Vite + TailwindCSS | ✓ Complete |
| **AI Engine** | ComfyUI + DreamShaper XL Lightning | ✓ Complete |
| **Python** | Python 3.11.9 (bundled) | ✓ Complete |
| **Installer** | Electron-builder + NSIS | ✓ Complete |
| **Image Stitching** | Sharp 0.33.3 | ✓ Complete (sprite sheets) |
| **Batch Queue** | — | ⏳ Phase 24 |
| **Inpainting** | — | ⏳ Phase 25 |

---

## Build & Run Commands

```bash
# Development
npm run gui              # Launch Electron app (dev mode)
npm run dev:server       # Express only on :3000
npm run build:frontend   # Minify React

# Production
npm run build:exe        # Clean + build Windows .exe → dist/InterForge-Setup-1.0.0.exe
npm run clean            # Wipe dist/ folder only
```

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| `electron-main.js` | Electron shell, triggers setup on every launch |
| `src/server/app.js` | Express server, all route registration |
| `src/server/routes/generation.js` | Job creation, polling, image serving, filename logic |
| `src/server/routes/sprite-sheet.js` | Batch generation + Sharp compositing |
| `src/server/routes/history.js` | History persistence + bulk clear |
| `src/server/routes/status.js` | Health status, tier badge |
| `src/backends/comfyui.js` | ComfyUI HTTP client, workflow injection |
| `src/env/manager.js` | Python + model setup |
| `frontend/src/App.jsx` | Layout, history state, reuseSettings wiring |
| `frontend/src/components/GenerationPanel.jsx` | All generation controls, presets, Pro Tools |
| `frontend/src/components/SpriteSheetPanel.jsx` | Sprite sheet mode UI |
| `frontend/src/components/PreviewArea.jsx` | Image display, history strip, frames panel |
| `comfyui-workflows/txt2img-dreamshaper.json` | Workflow template with token placeholders |

---

**Status:** ✅ **V1.2 complete. Phases 1–24 done. Next: Phase 25 (Blender Integration).**
