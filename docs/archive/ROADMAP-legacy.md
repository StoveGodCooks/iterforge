# InterForge — Living Roadmap & Dev Journal
**Last Updated:** 2026-04-05 | **Current Phase:** Phase 9 (Direct Inference) In Progress

---

## What Is InterForge?

InterForge is a **fully local, free and open-source AI-powered game asset pipeline** — a desktop app that takes a concept prompt and produces production-ready 3D game assets with textures, LODs, and exports. No subscriptions, no cloud, no data leaving your machine.

**The pipeline has three stages:**

| Stage | Name | What It Does |
|-------|------|-------------|
| 1 | **Prospecting** | Generate concept art images from a text prompt using AI. Pick the best one, lock it in. |
| 2 | **Smelting** | Turn the concept into a structured multi-view package: 4 RGB renders + 4 depth maps + 4 masks + SVG contours. Views: Front (0°), Right (90°), Left (270°), Top/Bird's Eye. |
| 3 | **Forge** | Feed the multi-view package into a full 8-step mesh pipeline: reconstruct → decimate → repair → UV unwrap → bake textures → generate LODs → export (glTF/FBX/OBJ) → save project. |

**Target user:** Game developers, 3D artists, indie studios who need fast asset iteration without paying per-asset or per-generation.

**Why local?** Ownership, privacy, no API costs, works offline, and you can run it as long as you want without subscription lock-in.

---

## Tech Stack & Why We Chose It

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop shell | **Tauri 2** | Lighter than Electron (~10MB vs ~150MB), uses system WebView, Rust backend gives us native process control |
| Frontend | **React + TypeScript + Vite** | Familiar, fast HMR, strong typing for complex pipeline state |
| Backend | **Python FastAPI + uvicorn** | The entire AI/ML ecosystem (ComfyUI, torch, rembg, trimesh) is Python. FastAPI gives us async + SSE with minimal boilerplate |
| Image generation | **ComfyUI** | Node-based workflow API, runs locally, supports ControlNet + IPAdapter + LoRA — exactly what we need |
| Background removal | **rembg** | Best local RGBA extraction, used in Prospecting to prep images for SVG tracing |
| SVG tracing | **vtracer/potrace** | Converts RGBA to SVG contours — feeds ControlNet Lineart in Smelting and shape constraint in Forge |
| 3D reconstruction (organic) | **InstantMesh** | Best local single-model multi-view → mesh reconstruction for organic shapes |
| 3D reconstruction (hard surface) | **Open3D + build123d** | CAD-style reconstruction: point cloud carving + SVG curve snapping + solid extrusion |
| UV unwrap + bake + LOD | **Blender (headless)** | Smart UV Project handles reconstruction mesh topology better than xatlas. Cycles bake for quality textures. |
| Rust toolchain | **GNU (mingw64)** | Avoids the MSVC `link.exe` PATH conflict in bash environments. See Phase 2 dev notes. |
| Python version | **3.11** | All AI/ML wheels (torch, rembg, etc.) are available for 3.11. Python 3.14 is too new — most wheels don't exist yet. |

---

## MasterForge Rules Engine

The brain of the pipeline. Routes every asset type through the correct settings automatically.

**17 Asset Types** → auto-detected or user-selected:
`prop`, `weapon`, `armor`, `character`, `creature`, `vehicle`, `building`, `dungeon_tile`, `environment`, `foliage`, `tileable_texture`, `skybox`, `vfx_element`, `ui_icon`, `logo`, `concept_art`, `sprite`

**8 Art Style Modifiers** (additive layer on top of asset type):
`painterly`, `pixel_art`, `low_poly`, `realistic`, `stylized`, `sketch`, `cel_shaded`, `isometric`

**Reconstruction Paths** (auto-routed by asset type):
- `ORGANIC` → InstantMesh (characters, creatures, foliage, props)
- `HARD_SURFACE` → Open3D + build123d CAD pipeline (weapons, armor, vehicles, buildings)

**Confirmed Rules (Discussion resolved):**
- IPAdapter disabled for: environment, tileable_texture, skybox, vfx_element, ui_icon, logo ✓
- Euler a sampler for tileable_texture ✓
- Logo CFG 8.5 (not too tight) ✓
- Foliage auto-routes to ORGANIC ✓
- Prop keyword detection for auto-type ✓
- Environment → no mesh pipeline (2D output only) ✓
- VFX skips Smelting stage ✓
- Sketch CFG 6.0 stays ✓

**LoRA Strategy:** All required LoRAs bundled in the installer. User doesn't manage them manually.

---

## File Structure

```
interforge-NEW/
│
├── ROADMAP.md                          ← You are here
│
├── package.json                        ← npm workspace root
├── vite.config.ts                      ← Vite config (port 1420, dev server)
├── tsconfig.json
│
├── .cargo/
│   └── config.toml                     ← Rust linker config (GNU toolchain, mingw64)
│
├── src/                                ← React frontend (TypeScript)
│   ├── App.tsx                         ← Root: tab state, stage locking, data flow
│   ├── App.css
│   │
│   ├── types/
│   │   └── pipeline.ts                 ← ALL shared types (Stage, AssetType, ArtStyle,
│   │                                      ProspectingOutput, SmeltingOutput, ForgeOutput,
│   │                                      InterForgeProject, BackendStatus, SSEEvent)
│   │
│   ├── tabs/
│   │   ├── Prospecting/
│   │   │   ├── Prospecting.tsx         ← Concept gen UI, SVG overlay, image gallery
│   │   │   └── Prospecting.css
│   │   ├── Smelting/
│   │   │   ├── Smelting.tsx            ← Multi-view UI (Front/Right/Left/Top), lock flow
│   │   │   └── Smelting.css
│   │   └── Forge/
│   │       ├── Forge.tsx               ← 8-step mesh pipeline UI, export controls
│   │       └── Forge.css
│   │
│   ├── components/
│   │   └── SetupWizard/
│   │       └── SetupWizard.tsx         ← Phase 8: setup wizard modal panel
│   │
│   └── styles/
│       ├── setup.css                   ← Phase 8: setup wizard styles
│
├── src-tauri/                          ← Tauri 2 / Rust desktop shell
│   ├── Cargo.toml                      ← Rust dependencies (tauri, shell, fs, dialog plugins)
│   ├── build.rs                        ← tauri-build entry point
│   ├── tauri.conf.json                 ← App config (window size, bundle ID, devUrl)
│   │
│   ├── src/
│   │   ├── main.rs                     ← Binary entry → calls lib::run()
│   │   └── lib.rs                      ← App setup, backend process manager,
│   │                                      window event handler (kill backend on close)
│   │
│   ├── capabilities/
│   │   └── default.json                ← Tauri permission declarations
│   │                                      (fs read/write, shell spawn, dialog)
│   │
│   └── icons/                          ← All app icon sizes
│       ├── 32x32.png
│       ├── 128x128.png
│       ├── 128x128@2x.png
│       ├── icon.icns                   ← macOS
│       ├── icon.ico                    ← Windows
│       └── ...                         ← Windows Store / iOS / Android sizes
│
├── interforge-backend/                 ← Python FastAPI backend (port 7842)
│   ├── main.py                         ← App entry, CORS, route registration
│   ├── requirements.txt                ← Python deps (fastapi, uvicorn, pydantic, psutil...)
│   ├── .python-version                 ← Pins to Python 3.11
│   │
│   ├── api/
│   │   ├── status.py                   ← GET /api/status (backend/ComfyUI/GPU/models health)
│   │   ├── setup.py                    ← GET /api/setup/status + POST /api/setup/install (Phase 8)
│   │   ├── jobs.py                     ← GET|DELETE /api/jobs/* + SSE stream
│   │   ├── prospect.py                 ← POST /api/prospect (Phase 5 ✅)
│   │   ├── smelt.py                    ← POST /api/smelt/view (Phase 6 ✅)
│   │   └── forge.py                    ← POST /api/forge   (Phase 7 ✅)
│   │
│   ├── core/
│   │   ├── job_manager.py              ← Async job queue, checkpoint/resume, status tracking
│   │   └── sse.py                      ← SSE event formatters (progress, done, error, log)
│   │
│   └── workers/
│       ├── prospect_worker.py          ← Phase 5: concept gen pipeline
│       ├── smelt_worker.py             ← Phase 6: per-view render pipeline
│       ├── forge_worker.py             ← Phase 7: 6-step mesh pipeline
│       └── setup_worker.py             ← Phase 8: pip install + model download
│
└── interforge-projects/                ← User project saves (created at runtime)
    └── {project-name}/
        ├── project.json                ← Full project state (InterForgeProject type)
        ├── prospect/                   ← Generated concept images + SVG
        ├── smelt/                      ← Multi-view renders, depth maps, masks
        └── forge/                      ← Mesh, textures, LODs, exports
```

---

## Phase Status

| Phase | Name | Status |
|-------|------|--------|
| Phase 1 | Frontend UI — All Three Tabs | ✅ Complete |
| Phase 2 | Tauri Configuration | ✅ Complete |
| Phase 3 | Backend Skeleton | ✅ Complete |
| Phase 4 | MasterForge Rules Engine (Python) | ✅ Complete |
| Phase 5 | ComfyUI Bridge + Prospecting Live | ✅ Complete |
| Phase 6 | Smelting Pipeline Live | ✅ Complete |
| Phase 7 | Mesh Pipeline Live | ✅ Complete |
| Phase 8 | Installer + Setup Wizard | ✅ Complete |
| Phase 9 | Direct Inference (Zero123++ / SDXL via diffusers) | 🔄 In Progress |
| Phase 10 | Mesh Quality Validation + End-to-End Test | 🔲 Next |
| Phase 11 | Texture Baking (UV Unwrap + Atlas) | 🔲 Pending |
| Phase 12 | Sprite Sheet Pipeline | 🔲 Pending (design discussion first) |
| Phase 13 | MCP Server / API | 🔲 Pending |

---

## Phase 1 — Frontend UI: All Three Tabs
**Status:** ✅ Complete

### What It Is
Built the complete React frontend for all three pipeline stages. The UI is fully functional with a locked/unlocked state machine — each stage must be completed before the next unlocks.

### What We Built
- **Prospecting tab** — prompt input, image gallery, SVG overlay system, art style selector, lock button
- **Smelting tab** — 4-view canvas (Front/Right/Left/Top), per-view lock controls, source image from Prospecting
- **Forge tab** — 8-step pipeline display, export format selector, poly count controls
- **Shared types** (`src/types/pipeline.ts`) — single source of truth for all pipeline data types end-to-end
- **App.tsx** — stage state machine with generic `lockStage<T>()`, proper typed data flow

### Key Design Decisions
- **Top view instead of Back view** — Back view provides almost zero useful geometric data for reconstruction. Top (Bird's Eye) gives us the silhouette shape and top-surface detail, which is critical for roof structures, head shapes, vehicle tops.
- **SVG overlay on Prospecting images** — After generation, backend runs rembg → potrace/vtracer to extract SVG contours. These SVGs travel through the entire pipeline: ControlNet Lineart input in Smelting, shape constraint in mesh reconstruction. Currently mocked (MOCK_SVG_INNER).
- **No browser canvas/potrace** — We investigated doing SVG extraction client-side but it created rendering issues and produced inconsistent results. All SVG work happens server-side in Phase 5.
- **Shared types over local declarations** — Originally each tab had its own type definitions. Consolidated into `pipeline.ts` to eliminate type drift between stages.

### Dev Notes
**Issue:** SVG overlay kept breaking the preview server — screenshots would time out.
**Answer:** We were trying to use browser canvas + potrace in the frontend. This caused the preview to hang. Solution: mock the SVG statically, do real SVG server-side in Phase 5.

**Issue:** `ProspectingOutput.assetType` TypeScript error — state was `string | null` but type expected `AssetType | null`.
**Fix:** Added `as AssetType | null` and `as ArtStyle | null` casts in `handleLock`. Imported enum types from shared `pipeline.ts`.

**Issue:** Smelting had local type declarations that duplicated pipeline.ts.
**Fix:** Removed all local type declarations across all three tabs. Everything imports from `src/types/pipeline.ts`.

**Pivot:** Originally used picsum.photos for placeholder images. These are random per-load which looks wrong. Phase 5 replaces with real ComfyUI output.

**Question:** Should art style be per-view in Smelting or inherited from Prospecting?
**Answer:** Inherited from Prospecting. Smelting should be consistent with the locked concept, not a new style.

**Known Remaining Issues:**
- Min/maximize window buttons don't work → we set `decorations: false` in tauri.conf.json (custom frameless window). Native OS buttons are disabled. Need to implement custom window controls in the titlebar. **Pinned for fix.**
- Image generation shows random picsum photos regardless of prompt → waits for Phase 5 (ComfyUI).
- SVG overlay shows same hardcoded paths on every image → waits for Phase 5 (rembg → potrace).

---

## Phase 2 — Tauri Configuration
**Status:** ✅ Complete

### What It Is
Built the entire `src-tauri/` directory from scratch. This is the Rust layer that wraps our React app as a native desktop window, manages the Python backend process lifecycle, and handles file system / dialog permissions.

### What We Built
- `Cargo.toml` — Rust project definition, Tauri plugin deps
- `build.rs` — Tauri build script entry point
- `src/main.rs` — binary entry point → calls `lib::run()`
- `src/lib.rs` — full app setup: plugin registration, backend process manager (Arc<Mutex>), window destroy hook to kill backend cleanly
- `tauri.conf.json` — window config (1200×760, min 1100×700, frameless, devUrl, bundle ID)
- `capabilities/default.json` — all permission declarations
- App icons — generated all sizes from SVG source via `@tauri-apps/cli icon`

### Key Design Decisions
- **Frameless window (`decorations: false`)** — Custom dark UI design requires full control over the titlebar area. Trade-off: must implement our own min/max/close buttons.
- **Backend as child process** — Tauri spawns the Python backend on startup via `shell.spawn()`. On window destroy, we kill the backend. Non-fatal if backend fails to start — the frontend shows an offline state.
- **Arc<Mutex> for process state** — Avoids Rust borrow checker issues with `AppHandle` lifetimes in the window event closure. Store an Arc before the builder, clone it into the event handler.
- **Port 7842** — Not a common port, unlikely to conflict with developer tools.

### Dev Notes
**Issue:** `tauri.conf.json` schema error — `notarizationCredentials` property rejected.
**Fix:** Removed `signingIdentity` and `notarizationCredentials` from macOS bundle config. Keep only `minimumSystemVersion`. Code signing is a Phase 8 concern.

**Issue:** MSVC toolchain needs `link.exe` — but in Git Bash, `link` resolves to the Unix hard-link utility, causing "link: extra operand" errors on every proc-macro build.
**Diagnosis:** The Windows PATH had `C:\Program Files\Git\usr\bin\link.exe` (Unix tool) before any MSVC path.
**Attempted fix 1:** Switch to GNU toolchain (`stable-x86_64-pc-windows-gnu`). Hit new error: `export ordinal too large: 95210` — GNU `ld` has a hard 65535 DLL export limit.
**Attempted fix 2:** Use `lld` (LLVM linker) via `-fuse-ld=lld`. Required `dlltool.exe` (not installed), then installed MSYS2 + mingw64 to get it. Still hit the ordinal limit because `rust-lld` in GNU mode has the same limit.
**Attempted fix 3:** Switch back to MSVC + use `lld-link.exe` from Rust toolchain. Failed because `kernel32.lib` and other Windows SDK `.lib` files require VS Build Tools — not installed.
**Actual fix:** Remove `cdylib` from `crate-type`. The 65535 limit only affects DLL (`cdylib`) builds. Desktop-only builds only need `rlib`. Without the DLL, GNU `ld` links the executable fine. `.cargo/config.toml` sets `linker = "x86_64-w64-mingw32-gcc"`.

**Issue:** `windres: program not found` when running from PowerShell.
**Cause:** `C:\msys64\mingw64\bin` was not in the Windows user PATH.
**Fix:** Added permanently via `[Environment]::SetEnvironmentVariable(...)`.

**Issue:** VS Build Tools installer exited with code 1602 (user cancelled / dialog not answered).
**Note:** VS Build Tools eventually installed successfully via a background PowerShell process. Now available if needed for future MSVC builds, but not required for our current GNU setup.

**Issue:** `capabilities/default.json` used invalid permission names: `fs:allow-create-dir`, `fs:allow-remove-file`.
**Fix:** Replaced with correct Tauri 2 names: `fs:allow-mkdir`, `fs:allow-remove`.

**Lesson:** Rust borrow checker requires careful design with `AppHandle` in closure contexts. The pattern `let arc = Arc::clone(&managed_arc); move |...| { arc.lock()... }` is the reliable approach over trying to call `.state::<T>()` inside event handlers.

**Pinned:** Bundle identifier ends with `.app` — Tauri warns this conflicts with macOS bundle extension. Change `com.interforge.app` → `com.interforge.studio` before Phase 8 release build.

---

## Phase 3 — Backend Skeleton
**Status:** ✅ Complete

### What It Is
The Python FastAPI server that runs on port 7842. This is the backbone all AI pipeline stages will connect to. Provides health monitoring, async job management, SSE streaming infrastructure, and stub endpoints for Phases 5–7.

### What We Built
- `main.py` — FastAPI app, CORS config (allows Tauri WebView + Vite dev server origins), route registration
- `api/status.py` — `GET /api/status` checks: backend (always ok), ComfyUI (port 8188 ping), GPU (torch VRAM or psutil RAM fallback), models (checkpoint file detection)
- `api/jobs.py` — `GET/DELETE /api/jobs/*` + `GET /api/jobs/{id}/stream` SSE endpoint
- `core/job_manager.py` — async job queue with checkpoint/resume. Each job tracks `last_step` so on crash/retry it restarts from the last successful step, not from zero.
- `core/sse.py` — SSE event formatters: `progress_event`, `done_event`, `error_event`, `log_event`
- `api/prospect.py` — stub, returns 503 with phase info
- `api/smelt.py` — stub, returns 503 with phase info
- `api/forge.py` — stub, returns 503 with phase info

### Key Design Decisions
- **SSE over WebSocket** — Simpler for one-way server→client streaming. The pipeline only needs to push progress to the frontend, not receive messages mid-job.
- **Job system with checkpoints** — If Phase 7 Forge crashes at step 4 (UV unwrap), the user shouldn't have to re-run reconstruction from scratch. `last_step` tracks the checkpoint. `resume_from_step` in ForgeRequest lets the frontend request a resume.
- **Error codes** — Format `ERROR_<STAGE>_<CODE>` (e.g. `ERROR_FORGE_MESH_RECONSTRUCT`). These surface in the UI so users know exactly what failed and can report it or retry intelligently.
- **Non-fatal backend launch** — If the Python backend fails to start, the Tauri app still opens. The frontend detects the offline state via `/api/status` and shows a banner. User can start backend manually.

### Dev Notes
**Issue:** Python 3.14 (system default) couldn't install `pydantic==2.10.6` — `pydantic-core` had no wheel for 3.14 and source compilation failed.
**Fix:** Pinned to Python 3.11 via `.python-version` file. Used `py -3.11` (Windows Python Launcher). Updated `lib.rs` to spawn `py -3.11` on Windows, `python3.11` on macOS/Linux.
**Lesson:** Always pin Python version for AI/ML projects. The ecosystem lags 1–2 major versions behind CPython releases. 3.11 is the sweet spot for 2025/2026 — all major wheels (torch, transformers, rembg, etc.) have 3.11 builds.

**Verified working:**
- `GET /` → `{"service": "InterForge Backend", "version": "0.1.0", "status": "ok"}`
- `GET /api/status` → detected RTX 3070 with 8GB VRAM ✓
- `GET /api/jobs` → `[]` ✓
- `POST /api/prospect` → 503 with phase message ✓
- Swagger UI at `http://127.0.0.1:7842/docs` ✓

---

## Phase 4 — MasterForge Rules Engine
**Status:** 🔲 Next

### What It Is
The Python-side intelligence layer. Translates an asset type + art style + prompt into a fully configured ComfyUI workflow — with the correct samplers, CFG, steps, ControlNet stack, IPAdapter settings, LoRA bundle, negative prompts, and lighting presets applied automatically.

### What Needs Building
```
interforge-backend/
└── masterforge/
    ├── asset_configs.py      ← Per asset type: sampler, CFG, steps, neg prompts, LoRAs, reconstruction path
    ├── style_modifiers.py    ← 8 art style overlays: adjustments to CFG, steps, prompt tokens
    ├── negative_prompts.py   ← Curated negative prompt libraries per asset type
    ├── lighting_presets.py   ← Lighting prompt modifiers (studio, outdoor, dungeon, etc.)
    ├── lora_registry.py      ← LoRA name → file path mapping, weight defaults
    └── workflow_builder.py   ← Assembles all the above into a ComfyUI API workflow JSON
```

### What We Built
```
interforge-backend/
└── masterforge/
    ├── asset_configs.py      ← 17 asset types: sampler, CFG, steps, resolution, IP/CN flags, reconstruction path
    ├── style_modifiers.py    ← 8 art styles: prompt prefix/suffix, CFG/steps delta, sampler override
    ├── negative_prompts.py   ← BASE_NEGATIVE + per-type curated negative prompts
    ├── lighting_presets.py   ← 8 presets with prompt tokens + per-type defaults
    ├── lora_registry.py      ← LoRA filename/weight registry + per-type stacks
    └── workflow_builder.py   ← Assembles full ComfyUI node graph JSON
```
Also added `api/masterforge.py` — introspection endpoints:
- `GET /api/masterforge/describe?asset_type=weapon&art_style=painterly`
- `GET /api/masterforge/asset-types`
- `GET /api/masterforge/styles`
- `GET /api/masterforge/lighting-presets`
- `GET /api/masterforge/loras`

### Key Design Decisions (confirmed)
All decisions confirmed in earlier discussion sessions.

### Verified Output (weapon + painterly)
```json
{
  "asset_type": "weapon", "art_style": "painterly",
  "sampler": "dpm_2_ancestral", "cfg": 7.5, "steps": 30,
  "resolution": "512×768", "ip_adapter": true, "controlnet": true,
  "reconstruction": "HARD_SURFACE", "loras": ["weapon_detail", "painterly"]
}
```
ComfyUI workflow node graph: 9 nodes (checkpoint → 2 LoRAs → CLIP encode × 2 → latent → KSampler → VAEDecode → SaveImage)

### Dev Notes
**Design:** `workflow_builder.py` uses a stable node ID layout (1=checkpoint, 2=pos, 3=neg, 4=KSampler, 5=VAEDecode, 6=SaveImage, 7=latent, 10+=LoRA chain, 20+=IPAdapter, 40+=ControlNet Lineart, 50+=ControlNet Depth). Node IDs are strings per ComfyUI API spec.

**Decision:** LoRA chain order: asset-type LoRAs first, style LoRA last. Last LoRA in chain has highest effective influence — style should win over asset-type detail when they conflict.

**Decision:** Depth ControlNet strength = lineart strength × 0.8. Depth should guide structure but not override the lineart silhouette.

**Decision:** Prospecting never uses ControlNet (no source image exists yet). ControlNet only activates in Smelting where we have the locked reference.

**Note:** Module path issue — `masterforge` must be imported with `sys.path` including the backend root, or run from the backend directory. This is handled correctly by uvicorn launching from `interforge-backend/`.

---

## Phase 5 — ComfyUI Bridge + Prospecting Live
**Status:** ✅ Complete

### What It Is
Wires real image generation into the Prospecting tab. ComfyUI runs locally on port 8188. We POST workflows to it, stream progress via WebSocket, stream results back to frontend via SSE. rembg removes backgrounds → vtracer traces SVG contours.

### What We Built
```
interforge-backend/
├── comfyui/
│   ├── client.py          ← async ComfyUI HTTP + WebSocket client
│   └── output.py          ← rembg background removal + vtracer SVG extraction
└── workers/
    └── prospect_worker.py ← full prospecting pipeline orchestrator
```
- `api/prospect.py` — replaced 503 stub with real job creation + worker dispatch
- `main.py` — added `/outputs` static file mount (serves `~/interforge-projects/`)
- `Prospecting.tsx` — real fetch + SSE stream, live progress bar, real images, real SVG

### Data Flow
```
User clicks Generate
  → POST /api/prospect → job created → 202 {job_id}
  → EventSource /api/jobs/{id}/stream
  → Worker: MasterForge workflow → ComfyUI /prompt → WebSocket progress
  → SSE: progress events (step/total/pct) → frontend progress bar
  → ComfyUI done → download images → rembg → RGBA → vtracer → SVG
  → SSE: IMAGE_READY (url) → image appears in gallery immediately per image
  → SSE: SVG_READY (svg_data) → SVG overlay auto-activates on selected image
  → SSE: DONE → generation complete
```

### Dev Notes
**Discovery:** rembg, vtracer, httpx, Pillow were already installed in the user's `IterForge` Python environment. No new downloads needed.

**Discovery:** ComfyUI was already running on port 8188 (confirmed by `/api/status` showing "ok" from Phase 3).

**Decision:** Images served via FastAPI `/outputs` static mount pointing to `~/interforge-projects/`. Frontend receives `http://127.0.0.1:7842/outputs/...` URLs — works in both dev (Vite) and production (Tauri WebView).

**Decision:** `IMAGE_READY` emitted per-image as soon as it's downloaded and processed — frontend shows images as they arrive, not all at once at the end.

**Decision:** `SVG_READY` emitted after rembg+vtracer per image. If processing fails, raw image still shows. SVG overlay silently skips if vtracer errors.

**Decision:** "Regen SVG" button hits `POST /api/prospect/svg` synchronously (no SSE) — vtracer is fast enough (~1-2s) for a direct response.

**Pinned:** `handleRegenSvg` passes the relative path to the backend but backend needs to resolve it against `PROJECTS_ROOT`. Path handling needs a cleanup pass in Phase 7 when the full project folder system is wired.

---

## Phase 6 — Smelting Pipeline Live
**Status:** ✅ Complete

### What It Is
Generates the structured multi-view package. For each of the 4 views (Front, Right, Left, Top), runs a ComfyUI workflow with IPAdapter (reference image) + ControlNet Lineart (SVG from prospect) — one job per view angle so the user can regenerate individual views without re-running all four.

### What Was Built
- `interforge-backend/workers/smelt_worker.py` — per-view worker: resolves prospect RGBA + SVG paths, calls `build_smelt_workflow`, streams ComfyUI progress, runs rembg for mask, emits `VIEW_READY` SSE event
- `interforge-backend/api/smelt.py` — `POST /api/smelt/view` endpoint (replaced 503 stub)
- `src/types/pipeline.ts` — added `prospectJobId` + `lockedImageIndex` to `ProspectingOutput` so Smelting can resolve file paths from the backend
- `src/tabs/Prospecting/Prospecting.tsx` — added `currentJobId` state, wired into `handleLock`
- `src/tabs/Smelting/Smelting.tsx` — replaced picsum placeholder with real API call + SSE stream. `VIEW_READY` event fires per view → sets `imageSrc` + `rgbaUrl`. `generateAll()` runs all 4 sequentially. `regen()` re-fires a single view.

### API Design Decision: One Job Per View (not batch)
**Why:** The Smelting UI is designed around per-view approval/regen. If the user doesn't like the Left view they just regen that one — they shouldn't have to wait for all four to finish again. One job per view gives full control. The `generateAll()` helper loops through all four sequentially on the frontend.

### Path Resolution Pattern
Smelt worker uses `prospect_job_id` + `image_index` (not URLs) to resolve file paths:
```
~/interforge-projects/{prospect_job_id}/prospect/image_00_rgba.png
~/interforge-projects/{prospect_job_id}/prospect/image_00.svg
```
This avoids parsing URLs and keeps the backend self-contained.

### Dev Notes
- **Masks from rembg:** Phase 6 runs rembg on every view render. The RGBA output IS the mask — alpha channel = silhouette. Stored as `rgbaUrl` in view state and passed to `SmeltingOutput.masks`. Phase 7 can use these directly for InstantMesh multi-view reconstruction.
- **Depth maps:** Not generated in Phase 6 (no depth ControlNet in the smelt workflow currently). Set to `null` in `SmeltingOutput.depthMaps`. Phase 7's reconstruction pipeline can derive depth from the RGBA set.
- **Fallback for missing RGBA:** If the prospect job had rembg failure, worker falls back to raw RGB as IPAdapter reference. Job continues — user still gets a view, just less controlled silhouette guidance.

---

## Phase 7 — Mesh Pipeline Live
**Status:** ✅ Complete

### What It Is
The full 8-step 3D mesh pipeline. Each step streams `step_active` / `step_done` SSE events to the frontend so the user sees the pipeline advancing in real time.

### What Was Built
- `workers/forge_worker.py` — 8 steps: reconstruct → decimate → repair → unwrap → bake → lod → export → save
- `api/forge.py` — `POST /api/forge` (replaced 503 stub), takes `smelt_job_ids` dict
- `core/sse.py` — added `STEP_ACTIVE` event type + `step_active_event` / `step_done_event` helpers
- `src/types/pipeline.ts` — `SmeltingOutput.smeltJobIds: Record<ViewAngle, string | null>`
- `src/tabs/Smelting/Smelting.tsx` — `ViewState.jobId` tracks per-view job ID, passed in `handleLock`
- `src/tabs/Forge/Forge.tsx` — replaced mock setTimeout with real `POST /api/forge` + SSE stream. Steps advance in real time via `step_active` / `step_done` events. Error box for missing deps / failed steps. Export button downloads from backend `/outputs` URL.

### Reconstruction Approach (Phase 7)
**DPT monocular depth estimation** (Intel/dpt-hybrid-midas via HuggingFace transformers) + **multi-view Poisson surface reconstruction** (open3d). No Blender required. No InstantMesh required.

Per-view camera transform (orthographic, 4 canonical views):
- Front → camera at +Z, looking -Z
- Right → camera at +X, looking -X
- Left  → camera at -X, looking +X
- Top   → camera at +Y, looking -Y

Each view builds a masked point cloud. All 4 merge → voxel downsample → normal estimation → Poisson reconstruction depth=8.

### Required pip packages (auto-installed by Phase 8 installer)
```
open3d>=0.18    trimesh[all]>=4.0    xatlas>=0.0.4
transformers>=4.35    Pillow>=10.0    numpy
```
DPT-hybrid-midas model (~400MB) auto-downloads from HuggingFace on first run.

### Dev Notes
- **Blender deferred**: Blender headless for UV+bake+LOD was the original plan. Replaced with `xatlas` (pip-installable, no external binary) + trimesh decimation for LOD. Produces comparable results without requiring Blender installation. Blender Cycles bake can be added as Phase 8+ quality upgrade.
- **InstantMesh deferred**: Single-model multi-view reconstruction. Phase 7 uses DPT+Poisson which works without downloading 3GB+ weights. InstantMesh can be added as an ORGANIC path upgrade in Phase 8.
- **Texture bake is placeholder**: Currently copies front view RGBA as albedo texture. Real UV-space rasterization (projecting all 4 views onto the atlas using mesh triangle-UV mapping) is a future improvement.
- **UV + Texture skipped (v2 decision)**: After discussion, decided to skip UV unwrap and texture bake entirely for v1. xatlas was added but was doing work that nothing downstream used (bake was just copying front view image). The half-wired code was removed. Forge now exports clean geometry-only meshes. Artists texture in Blender, Substance, or their engine. This is pinned item #8 for v2.
- **LOD non-fatal**: If LOD generation fails (trimesh edge case), pipeline continues with LOD0=base mesh. Non-blocking.

---

## Phase 8 — Installer + Setup Wizard
**Status:** ✅ Complete

### What It Is
Environment checker and one-click installer accessible from a ⚙ Setup button in the titlebar. Shows hardware info, ComfyUI status, Python dep checklist, and model file checklist. Streams SSE progress while pip-installing packages and downloading model files.

### What Was Built
- `interforge-backend/api/setup.py` — `GET /api/setup/status` (hardware tier, ComfyUI ping + path detection, Python dep imports, model file existence) + `POST /api/setup/install` (kicks off install job, returns `job_id`)
- `interforge-backend/workers/setup_worker.py` — pip install + model download worker. Downloads via `urllib` in a thread with chunked progress. Pushes `step_active` / `step_done` / `progress` SSE events. Uses `asyncio.run_coroutine_threadsafe` to push progress from download thread back to async event loop.
- `src/components/SetupWizard/SetupWizard.tsx` — modal overlay with 4 sections: Hardware, ComfyUI, Python Dependencies, AI Models. Streams install SSE events to a live log. "Install All Missing" button auto-collects all missing dep IDs + model IDs into one install job.
- `src/styles/setup.css` — dark-theme styles with green/red status dots, download progress bars, manual download links, install log panel, `.setup-btn` titlebar button style.
- `src/App.tsx` — added `showSetup` state + `onSetup` prop to Titlebar. ⚙ Setup button in titlebar controls area. `<SetupWizard>` modal conditionally rendered.
- `src-tauri/tauri.conf.json` — bundle ID changed: `com.interforge.app` → `com.interforge.studio` ✓

### Hardware Tiers
| Tier | Threshold | Label |
|------|-----------|-------|
| high | ≥ 8 GB VRAM | High-End — full pipeline |
| mid  | 4–8 GB VRAM | Mid-Range |
| low  | < 4 GB VRAM | Low-End — slow |
| cpu  | No GPU / torch | CPU Mode — very slow |

### Python Deps Checked
`rembg[gpu]`, `vtracer`, `open3d>=0.18`, `trimesh[all]>=4.0`, `transformers>=4.35`, `Pillow>=10.0`, `numpy`

### Models Checked & Downloaded
| ID | Name | Size | Dest |
|----|------|------|------|
| sd15 | SD 1.5 Checkpoint | ~3.97 GB | `~/ComfyUI/models/checkpoints/` |
| controlnet_lineart | ControlNet Lineart | ~1.45 GB | `~/ComfyUI/models/controlnet/` |
| controlnet_depth | ControlNet Depth | ~1.45 GB | `~/ComfyUI/models/controlnet/` |
| ipadapter | IPAdapter SD1.5 | ~849 MB | `~/ComfyUI/models/ipadapter/` |
| clip_vision | CLIP Vision Encoder | ~1.6 GB | `~/ComfyUI/models/clip_vision/` |

### Dev Notes
- **ComfyUI auto-detection:** Searches common paths (`~/ComfyUI`, `~/Desktop/ComfyUI`, `C:/ComfyUI`, `D:/ComfyUI`, etc.). No path config required if ComfyUI is in a standard location.
- **HuggingFace gating:** Some models (SD1.5) may require authentication. If download fails, the log says "place manually in ~/ComfyUI/models/…" and a "↗ manual" link opens the HF page. Status refreshes via ↺ button after manual placement.
- **Progress from threads:** `urllib.request.urlopen` runs in `asyncio.to_thread()`. Progress events use `asyncio.run_coroutine_threadsafe(job.push(event), loop)` to safely cross the thread boundary without blocking the download.
- **Bundle ID:** `com.interforge.app` → `com.interforge.studio` — resolves pinned item #2 from Phase 2.

---

## Phase 9 — MCP Server
**Status:** 🔲 Pending (design discussion needed before Phase 10)

### What It Is
Expose InterForge as an MCP (Model Context Protocol) server so AI agents and IDEs can call the pipeline programmatically. A game AI in Cursor or Claude could generate an asset by calling InterForge tools.

---

## Phase 10 — Sprite Sheet Pipeline
**Status:** 🔲 Pending (design discussion required first)

### What It Is
A separate pipeline branch for 2D game assets. Takes a character/prop → generates a full sprite sheet with animation frames. Design discussion needed before building.

---

## Pinned Items (Unresolved / Future)

| # | Item | Pinned In | Priority |
|---|------|-----------|----------|
| 1 | **Min/maximize buttons don't work** — `decorations: false` disables native OS controls. Need custom titlebar buttons (drag region + min/max/close). | Phase 2 | High — fix before Phase 5 |
| 2 | ~~**Bundle ID warning**~~ — ✅ Fixed in Phase 8. Changed to `com.interforge.studio`. | Phase 2 | ✅ Done |
| 3 | **App icon artwork** — Current icon is a placeholder hex ring + I lettermark. Replace with final brand artwork. | Phase 2 | Before Phase 8 |
| 4 | **Sprite Sheet pipeline design** — Discussion needed: frame layout, animation states, spritesheet packing algorithm. | Phase 10 | Before Phase 10 |
| 5 | **MCP Server design** — Discuss tool surface area before Phase 9 build. | Phase 9 | Before Phase 9 |
| 6 | **`tauri.conf.json` — production signing** — macOS notarization, Windows Authenticode. Skip until Phase 8. | Phase 2 | Phase 8 |
| 7 | **Blender path detection** — `lib.rs` spawns Blender via shell. Need auto-detect of Blender install path across OS. | Phase 7 | Before Phase 7 |
| 8 | **UV Unwrap + Texture Bake (v2)** — Decided to skip texturing in v1. Forge exports geometry-only mesh. v2 will add: xatlas UV parameterization + multi-view texture projection onto UV atlas (proper rasterization, not just front-view copy). See Phase 7 dev notes. | Phase 7 | v2 |

---

## Items for Discussion

| # | Topic | Context |
|---|-------|---------|
| 1 | **Sprite sheet pipeline design** — How do we handle animation states? Do we generate each frame individually or use a motion LoRA? What's the sheet layout spec? | Phase 10 |
| 2 | **MCP tool surface** — What tools does the MCP server expose? `generate_asset(prompt, type)`? `get_project(id)`? Full pipeline or just prospect? | Phase 9 |
| 3 | **Model download strategy** — Do we host our own model CDN or direct-link HuggingFace/CivitAI? What if a model is removed? | Phase 8 |
| 4 | **Project format versioning** — `project.json` schema will evolve. How do we handle old projects opening in new versions? | Phase 8 |
| 5 | **Multi-project UI** — Right now it's one asset at a time. Do we want a project browser/dashboard? | Phase 8+ |
| 6 | **Custom titlebar implementation** — What controls do we want? Just min/max/close, or also a menu bar? Drag region behavior on multi-monitor? | Fix before Phase 5 |

---

## How to Run InterForge (Development)

**Prerequisites:**
- Node.js 18+
- Python 3.11 (via Windows Python Launcher `py -3.11`)
- Rust (GNU toolchain: `stable-x86_64-pc-windows-gnu`)
- MSYS2 + mingw64 (for `windres`, `gcc`, linker tools)
- `C:\msys64\mingw64\bin` in system PATH

**Start the app (PowerShell):**
```powershell
cd "C:\Users\beebo\OneDrive\Desktop\interforge-NEW"
npx @tauri-apps/cli dev
```

**Start backend only (for API testing):**
```powershell
cd "C:\Users\beebo\OneDrive\Desktop\interforge-NEW\interforge-backend"
py -3.11 -m uvicorn main:app --host 127.0.0.1 --port 7842 --reload
```

**API docs:** `http://127.0.0.1:7842/docs`

**If port 1420 is in use:**
```powershell
taskkill /IM node.exe /F
```

**Build for distribution:**
```powershell
npx @tauri-apps/cli build
```
Output: `src-tauri/target/release/bundle/`

---

---

## Phase 9 — Direct Inference: Zero123++ + SDXL via diffusers
**Status:** 🔄 In Progress
**Started:** 2026-04-04

### What It Is
Replacing ComfyUI entirely with direct `diffusers` inference. ComfyUI required a separate process on port 8188, its own model management, its own workflow JSON format, and added ~90s startup overhead. Direct inference eliminates all of that — models load on demand, run in-process, and are released when done.

### What We Eliminated
- `comfyui/` client module — ~800 lines of WebSocket + workflow JSON management
- External ComfyUI process dependency (port 8188)
- ComfyUI workflow JSON files
- Per-stage ComfyUI model loading/caching
- `setup_worker.py` ComfyUI-specific install logic

### What We Built

**`inference/zero123.py` — Zero123++ Multi-View Engine**

Singleton engine. Loads Zero123++ v1.2 (`sudo-ai/zero123plus-v1.2`) via diffusers on first use. Runs 6-view generation in a single forward pass. Unloads after each job to free VRAM.

Key specs:
- Model: `sudo-ai/zero123plus-v1.2` with `sudo-ai/zero123plus-pipeline` custom class
- VRAM: ~3GB FP16 — runs fully on GPU, no cpu_offload needed on RTX 3070
- Output: 640×960 composite image → split into 6 × 320×320 views
- Camera poses: az 30/90/150/210/270/330°, elevation alternating +20°/−10°, radius 1.5, FoV 30°
- Inference: 40 steps, guidance scale 4.0

```python
CAMERA_POSES = {
    "front":       {"azimuth":  30.0, "elevation":  20.0, "radius": 1.5},
    "front_right": {"azimuth":  90.0, "elevation": -10.0, "radius": 1.5},
    "right":       {"azimuth": 150.0, "elevation":  20.0, "radius": 1.5},
    "back":        {"azimuth": 210.0, "elevation": -10.0, "radius": 1.5},
    "left":        {"azimuth": 270.0, "elevation":  20.0, "radius": 1.5},
    "front_left":  {"azimuth": 330.0, "elevation": -10.0, "radius": 1.5},
}
VIEW_ORDER = ["front", "front_right", "right", "back", "left", "front_left"]
```

**`workers/smelt_worker.py` — Rebuilt for Zero123++**

Old: 4 separate SDXL img2img calls, one per view angle.
New: Single Zero123++ forward pass → 6 views at once → rembg + vtracer on each view.

The RGBA prospect image is passed as-is to the engine (not `.convert("RGB")`). Zero123++'s internal `to_rgb_image()` composites onto gray (127, 127, 127) background — matching training distribution. Calling `.convert("RGB")` before passing fills transparency with black and corrupts the input.

**`inference/reconstruct.py` — Full 4-Stage Reconstruction Pipeline**

New file. Replaces the old depth-estimation approach (Depth Anything V2 + TSDF fusion) with:

1. **SVG mask rasterization** — parse vtracer SVG paths, rasterize at 1024×1024 (sharper than 768px raster alpha)
2. **Visual hull carving** — project 256³ voxel grid through 6 camera matrices, carve using silhouette masks
3. **Photo-consistency refinement** — use RGB agreement across views to carve concavities (arms gaps, hollows)
4. **Open3D Poisson surface reconstruction** — depth=8, density trimming at 1% quantile

Key camera parameters (corrected during Sessions 05–06):
```python
# Intrinsic — derived from actual 30° FoV, not a guessed multiplier
focal = (image_size / 2) / tan(fov / 2)   # = 1433px for 768px image

# Extrinsic — Y-flip required for world-Y-up → image-Y-down
ext = Rx(-elevation) @ Ry(azimuth)
ext[2, 3] = radius
ext[1, :] *= -1   # OpenCV convention

# Volume bounds — auto-computed from FoV (critical fix)
bounds = ±(tan(fov/2) × radius × 0.95) = ±0.382
# (was hardcoded ±0.8 — 50% of voxels fell outside camera view, never carved)
```

**`workers/forge_worker.py` — SVG Wiring**

Smelt output SVGs now flow into reconstruction:
```python
svg_data = {}
for angle in view_rgbas:
    svg_path = PROJECTS_ROOT / smelt_job_id / "smelt" / angle / "image_00.svg"
    if svg_path.exists():
        svg_data[angle] = svg_path.read_text(encoding="utf-8")
```

**`requirements.txt` — Pinned Dependencies**

All inference dependencies pinned to tested exact versions. Critical: `diffusers==0.37.1` (0.38+ has breaking return type changes), `transformers==5.3.0` (CLIP compatibility).

### Bugs Fixed This Phase

| # | Bug | Root Cause | Fix |
|---|-----|------------|-----|
| 15 | Grid split 3×2 instead of 2×3 | Transposed `idx // 2` / `idx % 2` | `cell_w=w//2, cell_h=h//3` |
| 16 | Black background in Zero123++ | `.convert("RGB")` fills alpha with 0 | Pass RGBA, let `to_rgb_image()` handle |
| 17 | Focal length wrong (45° not 30°) | `image_size × 1.2` has no geometric basis | `(image_size/2) / tan(fov/2)` |
| 18 | Y-axis inverted in projection | Missing world→camera Y convention flip | `ext[1,:] *= -1` |
| 19 | Volume bounds 5× too large | `(-0.8, 0.8)` vs visible ±0.402 | Auto-compute: `±tan(fov/2)×r×0.95` |
| 20 | Shadow pixels in alpha masks | Threshold `> 32` caught shadow (30–100) | Raise to `> 128`, add component cleanup |

### Open Items (Phase 9)

- [ ] End-to-end validation run — visual inspect mesh output after all fixes
- [ ] Rotation convention verification — `Rx(-el)@Ry(az)` vs `Ry(az)@Rx(-el)`
- [ ] Confirm 30° FoV and radius 1.5 are Zero123++ training values, not just inference defaults
- [ ] SDXL direct inference for Prospecting (currently may still use old path)
- [ ] InstantMesh evaluation — purpose-built Zero123++ → mesh, may fit in 5GB remaining VRAM

---

## Phase 10 — Mesh Quality Validation + End-to-End Test
**Status:** 🔲 Next

### What Needs To Happen
After 6 bugs fixed in Phase 9, we need a structured validation pass:
1. Full pipeline run: text prompt → prospect → smelt → forge → GLB
2. Visual inspection of mesh in 3D viewer
3. Verify silhouettes are carving correctly (log "N voxels remain" per view)
4. Verify photo-consistency is carving some voxels (N > 0)
5. Verify Poisson mesh is watertight (trimesh.is_watertight)
6. Export and import into Blender — check normals, UV coverage, vertex colors
7. Test with different asset types: character, weapon, prop

### Quality Gates
- Mesh is manifold / watertight
- Vertex colors cover > 80% of vertices (not gray fallback)
- Face count between 5,000–50,000 before decimation
- No floating islands (connected components = 1)

---

## Phase 11 — Texture Baking (UV Unwrap + Atlas)
**Status:** 🔲 Pending

Vertex colors are a stopgap. Game engines (Unity, Godot, Unreal) expect UV-mapped texture atlases. Plan:
- `xatlas` or Blender headless for UV unwrap
- Bake vertex colors → texture atlas (512×512 or 1024×1024)
- Output: mesh.glb with TEXCOORD_0 UVs + albedo texture PNG
- Bonus: bake normal map from high-poly to low-poly

---

## Session Log

| Date | Session Summary |
|------|----------------|
| Pre-context | Built all three tab UIs (Prospecting, Smelting, Forge). Resolved architecture discussions 1–7. Drafted MasterForge rules for all 17 asset types. |
| 2026-03-28 | Completed Phase 1 final changes (Top view, SVG overlay, shared types). Built Phase 2 (src-tauri from scratch). Built Phase 3 (backend skeleton). Resolved GNU toolchain + linker issues. Pinned Python 3.11. Fixed windres PATH. |
| 2026-04-02 | Session 01 — Full pipeline audit (23 issues). Fixed: inverted depth map, ring taper destroyed, STL precision loss, bilinear vertex colors. Built 3D mesh viewer (Three.js). Improved loft resolution and conditional smoothing. |
| 2026-04-04 | Session 02 — Remaining audit fixes: SSE multi-subscriber, monotonic checkpoint, FBX fallback, ComfyUI timeout, EventSource leak cleanup, error boundary, cancel button, download dialog. |
| 2026-04-04 | Session 03 — Phase 9 launch. Killed ComfyUI dependency. Built Zero123++ direct inference engine. Fixed grid splitting (3×2→2×3), camera poses (guessed→official), RGBA black background bug. Added 75% fill preprocessing. |
| 2026-04-04 | Session 04 — Full reconstruction pipeline: SVG rasterization, visual hull carving, photo-consistency refinement, Poisson reconstruction, vertex color projection. SVG wiring through forge_worker. First mesh output (fragmented — bugs remain). |
| 2026-04-05 | Session 05 — External audit: Gemini rubber-stamped wrong values, ChatGPT correctly found focal length error (45°→30°), missing Y-axis flip, volume bounds issue. Applied focal + Y-flip fixes. Pinned all dependencies. |
| 2026-04-05 | Session 06 — Volume bounds root cause analysis: (-0.8,0.8) meant 50% of voxels never carved. Fixed to auto-compute from FoV: ±0.382. Shadow artifact fix: raised alpha threshold to >128, added connected-component cleanup. |
| 2026-04-05 | Session 07 — Dependency pinning deep-dive. Created INTERFORGE_FULL_AUDIT.md (700-line comprehensive audit doc with 24 review questions). Updated INTERFORGE_PIPELINE_CONTEXT.md with all fixes. Git push. |
