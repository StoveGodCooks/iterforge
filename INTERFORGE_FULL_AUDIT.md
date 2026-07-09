# InterForge — Full Technical Audit Document

> **Version**: 0.1.0
> **Date**: 2026-04-05
> **Target**: External technical review and feedback
> **Stack**: Tauri 2 + React 18 + FastAPI + PyTorch/diffusers
> **Hardware**: RTX 3070 (8GB VRAM), Python 3.11, CUDA 12.1

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Tauri Desktop Shell](#4-tauri-desktop-shell)
5. [Backend Architecture](#5-backend-architecture)
6. [API Reference](#6-api-reference)
7. [Stage 1: Prospecting (Text-to-Image)](#7-stage-1-prospecting)
8. [Stage 2: Smelting (Multi-View Synthesis)](#8-stage-2-smelting)
9. [Stage 3: Forging (3D Reconstruction)](#9-stage-3-forging)
10. [MasterForge Configuration Engine](#10-masterforge-configuration-engine)
11. [GPU/VRAM Management](#11-gpuvram-management)
12. [Job System & Real-Time Events](#12-job-system--real-time-events)
13. [File System & Project Structure](#13-file-system--project-structure)
14. [Dependencies & Versions](#14-dependencies--versions)
15. [Security Model](#15-security-model)
16. [Known Issues & Recent Fixes](#16-known-issues--recent-fixes)
17. [Audit Questions for Reviewers](#17-audit-questions-for-reviewers)

---

## 1. System Overview

InterForge is a desktop AI game asset generator that converts text prompts into game-ready 3D meshes through a 3-stage pipeline:

| Stage | Name | Input | Output | AI Model |
|---|---|---|---|---|
| 1 | **Prospecting** | Text prompt | 2D concept image (RGBA + SVG) | SDXL (Juggernaut XL v9) |
| 2 | **Smelting** | Single concept image | 6 multi-view images | Zero123++ v1.2 |
| 3 | **Forging** | 6 RGBA views + SVG masks | 3D mesh (GLB/OBJ) | Visual hull + Open3D Poisson |

The pipeline is **gate-locked**: each stage must be completed and approved before the next unlocks. **Tinker Mode** bypasses all gates for rapid iteration.

---

## 2. Architecture Diagram

```
                     INTERFORGE ARCHITECTURE

    +----------------------------------------------------------+
    |  TAURI 2 DESKTOP SHELL (Rust)                             |
    |  - Window management (1200x760, custom titlebar)          |
    |  - Backend process spawner (py -3.11 uvicorn)             |
    |  - File dialogs, shell commands                           |
    |  - IPC: window controls only (no custom commands)         |
    +----------------------------------------------------------+
              |                              |
              v                              v
    +--------------------+      +----------------------------+
    |  REACT FRONTEND    |      |  FASTAPI BACKEND           |
    |  (Vite, port 1420) | SSE  |  (Uvicorn, port 7842)      |
    |                    |<---->|                              |
    |  Tabs:             | HTTP |  Routes:                    |
    |  - Prospecting     |      |  - /api/prospect            |
    |  - Smelting        |      |  - /api/smelt               |
    |  - Forge           |      |  - /api/forge               |
    |  - Projects        |      |  - /api/jobs/{id}/stream    |
    |  - DevTools        |      |  - /api/setup               |
    |                    |      |  - /api/masterforge         |
    |  3D Viewer:        |      |  - /dev/*                   |
    |  - Three.js        |      |                              |
    +--------------------+      +----------------------------+
                                          |
                                          v
                              +-------------------------+
                              |  GPU (RTX 3070, 8GB)    |
                              |                         |
                              |  Singletons:            |
                              |  - ForgeEngine (SDXL)   |
                              |  - Zero123Engine        |
                              |  - Depth pipeline       |
                              |                         |
                              |  asyncio.Lock prevents  |
                              |  concurrent GPU access  |
                              +-------------------------+
                                          |
                                          v
                              +-------------------------+
                              |  DISK                    |
                              |  ~/interforge-projects/  |
                              |  {APPDATA}/IterForge/    |
                              |    models/               |
                              +-------------------------+
```

---

## 3. Frontend Architecture

### 3.1 Tech Stack
| Component | Version | Purpose |
|---|---|---|
| React | 18.3.1 | UI framework |
| TypeScript | 5.5.3 | Type safety |
| Three.js | 0.183.2 | 3D mesh viewer |
| Vite | 5.4.8 | Build tool, dev server (port 1420) |
| Tauri API | 2.0.0 | Desktop integration (files, dialogs, shell) |

### 3.2 Application Entry & State

**Entry**: `src/main.tsx` renders `<App />` into `#root`

**App-Level State** (all local React hooks, no Redux/Zustand):
```typescript
activeTab: "prospecting" | "smelting" | "forge" | "projects" | "devtools"
tinkerMode: boolean                    // Gate bypass
showSetup: boolean                     // Setup wizard overlay
showOnboarding: boolean                // First-run walkthrough
stages: {
  prospecting: { locked: boolean, data: ProspectingOutput | null }
  smelting:    { locked: boolean, data: SmeltingOutput | null }
  forge:       { locked: boolean, data: unknown | null }
}
```

**Gate Logic**:
- Smelting unlocks when `prospecting.locked === true || tinkerMode`
- Forge unlocks when `smelting.locked === true || tinkerMode`

**localStorage Keys**:
- `interforge.onboarding.seen` — boolean
- `interforge.projects.v1` — JSON projects array
- `interforge.projects.activeProjectId` — string

### 3.3 Tab Components

| Tab | File | Purpose |
|---|---|---|
| Prospecting | `src/tabs/Prospecting/Prospecting.tsx` | Text-to-image generation |
| Smelting | `src/tabs/Smelting/Smelting.tsx` | Multi-view synthesis review |
| Forge | `src/tabs/Forge/Forge.tsx` | 3D mesh pipeline + viewer |
| Projects | `src/components/Projects/ProjectsShell.tsx` | Project management |
| DevTools | `src/tabs/DevTools/DevTools.tsx` | Diagnostics (Tinker Mode only) |

### 3.4 Type Definitions

**`src/types/pipeline.ts`**:
```typescript
type Stage = "prospecting" | "smelting" | "forge"
type ViewAngle = "front" | "front_right" | "right" | "back" | "left" | "front_left"
type AssetType = "concept" | "character" | "creature" | "animal" | "weapon" | "armor" |
                 "shield" | "prop" | "vehicle" | "building" | "environment" |
                 "tileset" | "vfx" | "ui" | "portrait" | "logo" | "background"
type ArtStyle = "painterly" | "pixel_art" | "low_poly" | "realistic" |
                "stylized" | "sketch" | "cel_shaded" | "isometric"
type ExportFormat = "GLB" | "FBX" | "OBJ"
type ReconstructionPath = "organic" | "hard_surface" | "none"
```

**ProspectingOutput**:
```typescript
{
  imagePath: string
  rgbaPath: string | null
  svgPath: string | null
  svgData: string | null
  prompt: string
  negPrompt: string
  seed: number
  assetType: AssetType | null
  artStyle: ArtStyle | null
  lightingPreset: string | null
  reconstructionPath: ReconstructionPath | null
  prospectJobId: string | null
  lockedImageIndex: number
}
```

**SmeltingOutput**:
```typescript
{
  views: Record<ViewAngle, string>           // image URLs
  depthMaps: Record<ViewAngle, string | null>
  masks: Record<ViewAngle, string | null>    // RGBA URLs
  smeltJobId: string | null
  prompt: string
  prospectingData: ProspectingOutput | null
}
```

**ForgeOutput**:
```typescript
{
  meshPath: string
  lodPaths: Record<string, string>
  texturePaths: { albedo: string | null, normal: string | null, roughness: string | null }
  exportFormat: ExportFormat
  polyCount: number
  projectFolder: string
  completedAt: string
}
```

### 3.5 Prospecting Tab — Detailed

**User Controls**:
- Prompt textarea (positive + negative)
- Asset type selector (17 types)
- Art style selector (8 styles)
- Generation settings: steps (10-60), CFG (1-20), sampler (6 options), seed, batch (1/2/4)
- LoRA list with enable/weight toggles
- Img2img toggle with source image and denoise strength
- SVG overlay with detail slider

**API Calls**:
- `POST /api/prospect` → `{ job_id }` → SSE on `/api/jobs/{job_id}/stream`
- `POST /api/prospect/svg` → `{ svg_data }` (re-generate SVG)

**SSE Events**: `progress`, `log`, `image_ready`, `svg_ready`, `done`, `error`

**Output Gallery**: Multiple images with select, SVG overlay toggle, Anvil workspace

### 3.6 Smelting Tab — Detailed

**Layout**: 3x2 grid showing 6 views (front, front_right, right, back, left, front_left)

**Per-View State**: `{ status, imageSrc, rgbaUrl, error }`
- Status flow: `idle → generating → done → approved/rejected`

**2D-Only Types** (disabled): concept, environment, tileset, vfx, ui

**API**: `POST /api/smelt/all-views` → SSE stream → `view_ready` events

**Approve/Lock Flow**: All 6 views must be approved → "Lock In Smelt" button

### 3.7 Forge Tab — Detailed

**Pipeline Picker**: "3D Mesh" or "Sprite Sheet"

**Mesh Pipeline Steps**:
1. Build Geometry — visual hull reconstruction
2. Decimation — quadric error metric
3. Refine — smooth + manifold repair
4. LOD Generation — 4 levels (100/50/25/10%)
5. Export — GLB/FBX/OBJ
6. Save Project — write project.json

**3D Mesh Viewer** (`src/components/MeshViewer/MeshViewer.tsx`):
- Three.js with GLTFLoader + OrbitControls
- Camera: 45 deg FOV, position (0, 0.8, 2.5)
- Lighting: ambient (0.6) + directional (1.0) + fill (0.3)
- ACES Filmic tone mapping
- Auto-centers and scales loaded mesh
- Grid: 4x4, 20 divisions

**Export**: Fetch GLB → Tauri save dialog → writeFile()

### 3.8 Projects Tab

**Storage**: localStorage-backed (ready for disk migration)
**Features**: Notes, references, links, anvil boards (coming)
**Project Lifecycle**: create → ideation → prospecting → smelting → forge → complete

### 3.9 Anvil Workspace (Drawing Tool)

**Canvas**: 1400x900px
**Tools**: Sketch (brush, pen, eraser), Lines/Shapes (line, curve, rect, ellipse), Notes (text, sticker)
**History**: 40-frame undo/redo
**Export**: PNG via Tauri save dialog

### 3.10 Setup Wizard & Onboarding

**Setup**: Checks hardware, Python deps, models. Installs missing via pip/download.
**Onboarding**: 6-step walkthrough explaining the pipeline.

### 3.11 Design System

**Color Palette**:
- Backgrounds: `#080909` (void) → `#0c0d0f` (base) → `#111316` (raised) → `#181b1f` (overlay)
- Forge Yellow: `#c8960a` (core) → `#e8b020` (bright) → `#f5c842` (glow)
- Ember Orange: `#c94f1a` (core) → `#e86030` (bright)
- Status: success `#2ecc71`, warn `#f39c12`, error `#e74c3c`, info `#3498db`

**Typography**: Inter (sans), JetBrains Mono (mono)
**Spacing**: 8px grid system
**CSS Files**: global.css, app.css, components.css, prospecting.css, smelting.css, forge.css, anvil.css, setup.css, onboarding.css, projects.css

---

## 4. Tauri Desktop Shell

### 4.1 Configuration
```
Product:     InterForge
Identifier:  com.interforge.studio
Version:     0.1.0
Window:      1200x760px (min 1100x700), custom titlebar, no OS decorations
Dev URL:     http://localhost:1420
Bundle:      Windows, macOS, Linux
CSP:         null (relaxed for dev — REVIEW FOR PRODUCTION)
```

### 4.2 Rust Backend Launcher (`src-tauri/src/lib.rs`)

**Backend Spawn Strategy**:
1. Check if port 7842 already in use → skip spawn (external backend)
2. Resolve backend directory:
   - `INTERFORGE_BACKEND_DIR` env var
   - `../interforge-backend` (dev)
   - Bundled alongside exe (release)
3. Spawn: `py -3.11 -m uvicorn main:app --host 127.0.0.1 --port 7842 --log-level warning`
4. On window close → kill backend subprocess

**State**: `BackendProcess(Arc<Mutex<Option<CommandChild>>>)`

### 4.3 Capabilities (Tauri 2 Permission Model)

**Allowed Operations**:
- Window: minimize, maximize, unmaximize, close, is-maximized
- Filesystem: read/write files and dirs, mkdir, remove, rename, exists
- Dialogs: open, save
- Shell: open URLs, spawn `py`/`python`/`python3`/`blender` with any args, kill processes

### 4.4 Rust Dependencies
```toml
tauri = "2"
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

---

## 5. Backend Architecture

### 5.1 FastAPI Application (`main.py`)

**Server**: Uvicorn on `127.0.0.1:7842`

**CORS Origins**:
```python
["http://localhost:1420", "http://127.0.0.1:1420",
 "tauri://localhost", "https://tauri.localhost"]
```

**GPU Memory Config**: `PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128`

**Static Mount**: `/outputs` → `~/interforge-projects/`

**Route Modules** (8):
- `api.status` — Health checks
- `api.setup` — Environment installer
- `api.jobs` — Job lifecycle + SSE
- `api.prospect` — Concept generation
- `api.smelt` — Multi-view synthesis
- `api.forge` — Mesh pipeline
- `api.masterforge` — Config introspection
- `api.dev` — Diagnostics (dev only)

### 5.2 Module Organization
```
interforge-backend/
  main.py                    # FastAPI entry + CORS + static mount
  requirements.txt           # Pinned dependencies
  api/
    status.py                # GET /api/status
    setup.py                 # GET/POST /api/setup/*
    jobs.py                  # GET/DELETE /api/jobs/*, SSE stream
    prospect.py              # POST /api/prospect, /api/prospect/svg
    smelt.py                 # POST /api/smelt/all-views
    forge.py                 # POST /api/forge
    masterforge.py           # GET /api/masterforge/*
    dev.py                   # GET /dev/* diagnostics
  core/
    config.py                # Env vars, paths, constants
    job_manager.py           # Job class, GPU lock, run_job()
    sse.py                   # EventType enum, event formatters
    profiler.py              # PipelineProfiler timing
    postprocess.py           # rembg + vtracer
  inference/
    engine.py                # ForgeEngine (SDXL singleton)
    zero123.py               # Zero123Engine (multi-view singleton)
    depth.py                 # Depth Anything V2 (not in active pipeline)
    reconstruct.py           # 4-stage visual hull + Poisson pipeline
  engine/
    export.py                # Vertex colors, LOD, multi-format export
  workers/
    prospect_worker.py       # SDXL generation + rembg + vtracer
    smelt_worker.py          # Zero123++ generation + per-view rembg
    forge_worker.py          # Mesh reconstruction + cleanup + export
    setup_worker.py          # pip install + model download
  masterforge/
    asset_configs.py         # Per-asset-type generation parameters
    prompt_templates.py      # Prompt prefix/suffix templates
    style_modifiers.py       # Art style parameter deltas
    negative_prompts.py      # Per-asset-type negative prompts
    lighting_presets.py      # 8 lighting environments
  tests/
    ...                      # pytest test suite
```

---

## 6. API Reference

### 6.1 Public Endpoints

| Method | Path | Purpose | Request | Response |
|---|---|---|---|---|
| GET | `/api/status` | System health | — | `{overall, backend, gpu, models}` |
| GET | `/api/setup/status` | Environment check | — | `{hardware, python_deps, models}` |
| POST | `/api/setup/install` | Install deps/models | `{items: [ids]}` | `{job_id, status}` |
| GET | `/api/jobs` | List all jobs | `?stage=` | `[{id, stage, status, ...}]` |
| GET | `/api/jobs/{id}` | Job snapshot | — | `{id, status, result, ...}` |
| GET | `/api/jobs/{id}/stream` | SSE live stream | — | `text/event-stream` |
| DELETE | `/api/jobs/{id}` | Cancel job | — | `{cancelled: true}` |
| POST | `/api/prospect` | Generate concept | See 6.2 | `{job_id, status}` |
| POST | `/api/prospect/svg` | Regen SVG | `{image_path, detail}` | `{svg_data}` |
| POST | `/api/smelt/all-views` | Generate 6 views | See 6.3 | `{job_id, status}` |
| POST | `/api/forge` | Run mesh pipeline | See 6.4 | `{job_id, status}` |
| GET | `/api/masterforge/asset-types` | List asset configs | — | `[{id, name, ...}]` |
| GET | `/api/masterforge/styles` | List style modifiers | — | `[{id, name, ...}]` |
| GET | `/api/masterforge/lighting-presets` | List lighting | — | `[{id, name, ...}]` |
| GET | `/api/masterforge/describe` | Full config | `?asset_type&art_style` | Combined config |

### 6.2 ProspectRequest
```json
{
  "prompt": "a battle-worn orc warrior",
  "neg_prompt": "",
  "asset_type": "character",
  "art_style": "stylized",
  "lighting_preset": null,
  "seed": -1,
  "batch_size": 2,
  "reference_image_path": null
}
```

### 6.3 SmeltRequest
```json
{
  "prospect_job_id": "abc-123",
  "image_index": 0,
  "prompt": "a battle-worn orc warrior",
  "asset_type": "character",
  "art_style": "stylized"
}
```

### 6.4 ForgeRequest
```json
{
  "smelt_job_id": "def-456",
  "prospect_job_id": "abc-123",
  "image_index": 0,
  "tinker_mode": false,
  "reconstruction_path": "organic",
  "export_format": "glb",
  "target_poly_count": 15000,
  "resume_from_step": 0
}
```

### 6.5 Dev Endpoints (prefix `/dev`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/dev/jobs` | Browse job folders |
| GET | `/dev/job/{id}` | Full job detail + file sizes |
| GET | `/dev/profile/{id}` | Raw profiler JSON |
| GET | `/dev/health` | Python, GPU, disk status |
| POST | `/dev/tests/run` | Run pytest (SSE output) |
| GET | `/dev/mesh-stats/{id}` | Mesh analysis (verts, faces, watertight, volume) |
| GET | `/dev/e2e-profile/{id}` | Combined prospect+smelt+forge timing |
| GET | `/dev/config` | All INTERFORGE_* env vars |
| GET | `/dev/active-jobs` | In-memory job list |
| GET | `/dev/loft-debug/{id}` | Loft pipeline debug data |

---

## 7. Stage 1: Prospecting

### 7.1 SDXL Engine (`inference/engine.py`)

**Model**: Juggernaut XL v9 (RunDiffusion Photo v2, safetensors)
**Class**: `ForgeEngine` (singleton via `ForgeEngine.get()`)

**Checkpoint Search Order**:
1. `INTERFORGE_SDXL_CHECKPOINT` env var
2. `{APPDATA}/IterForge/models/checkpoints/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors`
3. HuggingFace fallback: `stabilityai/stable-diffusion-xl-base-1.0`

**VRAM Optimizations**:
- `enable_model_cpu_offload()` — Only active component on GPU
- `enable_vae_slicing()` — Slice VAE processing
- `enable_vae_tiling()` — Tiled VAE for large batches

**Scheduler Options**:
| Name | Class |
|---|---|
| `euler_a` / `euler_ancestral` | `EulerAncestralDiscreteScheduler` |
| `dpm_2` / `dpm_2_ancestral` | `DPMSolverMultistepScheduler` |
| `dpmpp_2m` | `DPMSolverPlusPlusMultistepScheduler` (approx) |

**txt2img Signature**:
```python
engine.txt2img(
    prompt, negative_prompt,
    width, height,           # SDXL: 1024x1024, 832x1216, 1216x832
    steps, cfg_scale, seed,
    batch_size, scheduler,
    on_progress              # Callback for SSE updates
) -> list[PIL.Image]
```

### 7.2 Prospect Worker Pipeline
1. Load SDXL engine → VRAM
2. Build prompt from MasterForge templates (prefix + user prompt + suffix + style + lighting)
3. Merge negative prompts (base + asset-specific + user)
4. Generate images (SDXL diffusion)
5. Save raw PNGs
6. Run rembg (U2Net) → RGBA PNGs
7. Run vtracer → SVG silhouettes
8. Unload engine
9. Export profiler

### 7.3 Post-Processing (`core/postprocess.py`)

**rembg**: U2Net model (~175MB), lazy-loaded singleton
**vtracer**: Binary colormode SVG tracing

| vtracer Parameter | Value |
|---|---|
| `colormode` | `"binary"` |
| `layer_difference` | 16 |
| `corner_threshold` | 60 |
| `length_threshold` | 4.0 |
| `max_iterations` | 10 |
| `splice_threshold` | 45 |
| `filter_speckle` | `max(1, int(20 * (1 - detail)))` |
| `color_precision` | `max(4, int(6 + detail * 2))` |
| `path_precision` | `max(3, int(3 + detail * 5))` |

---

## 8. Stage 2: Smelting

### 8.1 Zero123++ Engine (`inference/zero123.py`)

**Model**: `sudo-ai/zero123plus-v1.2`
**Custom Pipeline**: `sudo-ai/zero123plus-pipeline`
**Class**: `Zero123Engine` (singleton)
**VRAM**: ~3GB FP16
**Local Cache**: `{APPDATA}/IterForge/models/zero123pp`

### 8.2 Input Preprocessing

```python
def _preprocess_reference(img: Image.Image) -> Image.Image:
    # 1. Convert to RGBA
    # 2. Find foreground bounding box (alpha > 32)
    # 3. Crop to bounding box
    # 4. Canvas size = max(crop_w, crop_h) / 0.75  (object fills ~75%)
    # 5. Center on gray (127, 127, 127) canvas
    # Matches official gradio_app.py preprocessing
```

### 8.3 Inference Parameters
| Parameter | Value |
|---|---|
| `num_inference_steps` | 40 |
| `guidance_scale` | 4.0 |
| Output size | `width=640, height=960` (pipeline default) |
| Grid layout | 2 columns x 3 rows = 320x320 per cell |
| Output FoV | 30 deg (unified in v1.2) |

### 8.4 Camera Poses (Zero123++ v1.2 Official)

| Grid Position | View Name | Azimuth | Elevation | Radius |
|---|---|---|---|---|
| Top-left (0) | `front` | 30 deg | +20 deg | 1.5 |
| Top-right (1) | `front_right` | 90 deg | -10 deg | 1.5 |
| Mid-left (2) | `right` | 150 deg | +20 deg | 1.5 |
| Mid-right (3) | `back` | 210 deg | -10 deg | 1.5 |
| Bot-left (4) | `left` | 270 deg | +20 deg | 1.5 |
| Bot-right (5) | `front_left` | 330 deg | -10 deg | 1.5 |

**Pattern**: Left column = high elevation (+20 deg), right column = low elevation (-10 deg). Azimuth increments 60 deg per view in reading order. All azimuths are relative to the input view.

### 8.5 Grid Splitting
```python
# Output is width=640, height=960
cell_w = w // 2   # 320
cell_h = h // 3   # 320
col = idx % 2
row = idx // 2
```

### 8.6 RGBA Handling
The Zero123++ pipeline's `to_rgb_image()` composites RGBA onto gray (127) background. We pass the image as-is (RGBA) and let the pipeline handle conversion — NOT `.convert("RGB")` which would fill transparency with black.

---

## 9. Stage 3: Forging

### 9.1 Reconstruction Pipeline Overview

```
6 RGBA views + 6 SVG silhouettes
         |
   [SVG Mask Rasterization] → 1024px binary masks (sharper than raster alpha)
         |
   [Visual Hull Carving] → 256^3 voxel grid, silhouette intersection
         |
   [Photo-Consistency] → RGB variance carving for concavities
         |
   [Surface Extraction] → Gaussian smooth + marching cubes
         |
   [Poisson Reconstruction] → Open3D, depth=8, density trimming
         |
   [Vertex Color Projection] → Average RGB from views onto mesh
         |
   [Cleanup] → trimesh repair + Laplacian smooth + decimation
         |
   [LOD Generation] → 100%/50%/25%/10% face count
         |
   [Export] → GLB/OBJ + project.json
```

### 9.2 Camera Matrix Construction

**Intrinsic Matrix K (3x3)**:
```
focal = (image_size / 2) / tan(FoV / 2)
      = (768 / 2) / tan(15 deg)
      = 1433.1 pixels

K = [[1433.1,    0,  384],
     [    0, 1433.1, 384],
     [    0,     0,    1]]
```

**Extrinsic Matrix (4x4 world-to-camera)**:
```python
ext = Rx(-elevation) @ Ry(azimuth)
ext[2, 3] = radius  (1.5)
ext[1, :] *= -1      # Y-flip: world Y-up → camera Y-down (OpenCV convention)
```

**Projection**: `P (3x4) = K @ ext[:3, :]`

### 9.3 SVG Mask Rasterization

- Parse SVG `<path d="...">` attributes (M, L, C, Z commands)
- Cubic Bezier curves subdivided into 10 line segments
- Rasterize to 1024x1024 binary mask using PIL.ImageDraw
- Skip white/none fills (background paths)
- Scale from source (768x768) to target (1024x1024) for sharper boundaries

### 9.4 Visual Hull Carving

```python
_carve_visual_hull(cameras, image_size=768, resolution=256, vol_bounds=(-0.8, 0.8))
```

- Initialize 256^3 voxels to 1.0 (all occupied)
- For each of 6 camera views:
  - Project all voxels to 2D via P matrix
  - Check against silhouette mask
  - Voxels outside silhouette in ANY view → multiply by 0 (carved)
  - Voxels outside image frame → KEPT (no information = don't carve)
- Result: intersection of all 6 silhouettes = visual hull

### 9.5 Photo-Consistency Refinement

```python
_photo_consistency_refine(volume, view_images, cameras,
                          threshold=30.0, shell_depth=3)
```

- Find surface shell: `binary_erosion(volume > 0.3, iterations=3)` XOR with volume
- For each shell voxel, project into all 6 views, sample RGB
- Compute per-voxel RGB standard deviation (need >= 2 views)
- If `std_dev > 30.0` → concavity → multiply voxel by 0.1

### 9.6 Surface Extraction

1. Gaussian smooth (sigma=0.8) on voxel volume
2. Marching cubes at level=0.3 → vertex positions + triangles
3. Gradient normals from smoothed volume, negate for outward direction
4. Normalize, replace degenerate normals (< 1e-6) with marching cubes normals

### 9.7 Poisson Reconstruction (Open3D)

```python
_poisson_reconstruct(points, normals, depth=8, scale=1.1, density_quantile=0.01)
```

- `create_from_point_cloud_poisson(depth=8, scale=1.1, linear_fit=True)`
- Density-based trimming: remove vertices below 1% quantile (eliminates "skirt" artifacts)
- Recompute vertex normals
- Convert to trimesh

### 9.8 Vertex Color Projection

- Project each mesh vertex into all 6 camera views
- Sample RGB from foreground pixels (alpha > 128)
- Average across all views that see the vertex
- Fallback: search expanding neighborhood up to 3px radius
- Uncolored vertices → gray (128, 128, 128)

### 9.9 Mesh Cleanup

```python
cleanup_mesh(mesh, smooth_iterations=3, target_faces=None)
```

- `trimesh.repair.fix_winding()`
- `trimesh.repair.fix_normals()`
- `trimesh.repair.fill_holes()`
- Laplacian smoothing: 3 iterations (organic) / 0 iterations (hard_surface)
- Optional quadric decimation to target face count

### 9.10 Alpha Centroid Alignment (pre-reconstruction)

Before reconstruction, each view is shifted so the object's alpha centroid is at image center. Compensates for Zero123++ object drift between views. Threshold: only shift if > 5px off center.

### 9.11 SVG Path Wiring (forge_worker.py)

```python
# Resolve SVGs from smelt output
for angle in view_rgbas:
    svg_path = PROJECTS_ROOT / smelt_job_id / "smelt" / angle / "image_00.svg"
    if svg_path.exists():
        svg_data[angle] = svg_path.read_text(encoding="utf-8")

# Pass to reconstruction
mesh = visual_hull_reconstruct(
    alpha_masks=alpha_masks,
    view_images=view_rgbas,
    svg_data=svg_data,        # SVG silhouettes for sharper carving
    resolution=256,
    image_size=768,
)
```

### 9.12 Reconstruction Route Options

| Route | Build Method | Smoothing | Use Case |
|---|---|---|---|
| `hard_surface` | Visual hull + Poisson | 0 Laplacian (sharp edges) | Weapons, architecture |
| `organic` | Visual hull + Poisson | 3 Laplacian + 10 Taubin | Characters, creatures |
| `none` | No mesh generation | — | 2D assets, pass-through |

### 9.13 LOD Generation

| LOD | Face % | Min Faces |
|---|---|---|
| LOD0 | 100% | — |
| LOD1 | 50% | 4 |
| LOD2 | 25% | 4 |
| LOD3 | 10% | 4 |

### 9.14 Export Formats

- **GLB**: Primary. Native trimesh support with vertex colors.
- **OBJ**: Vertex colors as vertex attributes.
- **FBX**: Not natively supported. Falls back to GLB with warning.

---

## 10. MasterForge Configuration Engine

### 10.1 Asset Configs (`masterforge/asset_configs.py`)

Each asset type has tuned generation parameters:

| Asset Type | Resolution | Reconstruction | Batch | CFG | Steps |
|---|---|---|---|---|---|
| prop | 1024x1024 | ORGANIC | 2 | 6.5 | 30 |
| weapon | 832x1216 | HARD_SURFACE | 2 | 6.5 | 30 |
| armor | 832x1216 | HARD_SURFACE | 2 | 6.5 | 30 |
| character | 832x1216 | ORGANIC | 2 | 6.5 | 30 |
| creature | 1024x1024 | ORGANIC | 2 | 6.5 | 30 |
| vehicle | 1216x832 | HARD_SURFACE | 2 | 6.5 | 30 |
| building | 832x1216 | HARD_SURFACE | 2 | 6.5 | 30 |
| environment | 1216x832 | NONE | 2 | 6.5 | 30 |
| vfx_element | 1024x1024 | NONE | 2 | 6.5 | 30 |
| ui_icon | 1024x1024 | NONE | 4 | 6.5 | 30 |

### 10.2 Style Modifiers (`masterforge/style_modifiers.py`)

| Style | CFG Delta | Steps Delta | Sampler Override |
|---|---|---|---|
| painterly | +0.5 | +2 | — |
| pixel_art | +1.5 | +5 | dpm_2 |
| low_poly | +1.0 | 0 | — |
| realistic | -0.5 | +10 | dpm_2_ancestral |
| stylized | 0 | +5 | — |
| sketch | -1.5 | -5 | — |
| cel_shaded | +1.0 | +3 | — |
| isometric | +1.5 | +3 | — |

### 10.3 Lighting Presets (8)

studio, outdoor_day, outdoor_dusk, dungeon, magical, overcast, night, interior

Each preset adds specific prompt tokens (e.g., "three-point studio lighting, neutral gray background, soft shadows").

### 10.4 Negative Prompts

Base universal negatives + per-asset-type negatives merged at generation time.

### 10.5 Prompt Validation

Rejects plural patterns (two, pair, collection) for 3D asset types. Prevents multi-object generation that would break single-object reconstruction.

---

## 11. GPU/VRAM Management

### 11.1 Singleton Pattern

| Engine | Model | VRAM | Strategy |
|---|---|---|---|
| `ForgeEngine` | SDXL (Juggernaut XL) | ~5-6GB with offload | cpu_offload + VAE slicing |
| `Zero123Engine` | Zero123++ v1.2 | ~3GB FP16 | Full GPU (no offload) |
| Depth pipeline | Depth Anything V2 | ~2GB | Lazy singleton (not in active pipeline) |

### 11.2 GPU Lock

```python
# core/job_manager.py
_gpu_lock = asyncio.Lock()

async def run_job(job, worker_fn, gpu=True):
    if gpu:
        async with _gpu_lock:    # Only ONE GPU job at a time
            await worker_fn(job, params)
    else:
        await worker_fn(job, params)
```

### 11.3 Lifecycle

Each worker follows: **load → use → unload** in try/finally. `torch.cuda.empty_cache()` called after every unload.

---

## 12. Job System & Real-Time Events

### 12.1 Job Class (`core/job_manager.py`)

```python
@dataclass
class Job:
    id: str                          # UUID
    stage: str                       # "prospect" | "smelt" | "forge"
    status: JobStatus                # PENDING → RUNNING → DONE/FAILED/CANCELLED
    last_step: int                   # Checkpoint for resume
    result: dict | None              # Output data on completion
    error_code: str | None           # ERROR_<STAGE>_<CODE>
    error_message: str | None
    created_at: float
    _subscribers: list[asyncio.Queue]  # SSE subscribers
    _event_log: list[str]              # Buffered for late joiners
```

### 12.2 SSE Event Types (`core/sse.py`)

| Event | Stage | Payload |
|---|---|---|
| `progress` | All | `{step, total, message, pct}` |
| `step_active` | Forge | `{step_id, description}` |
| `step_done` | Forge | `{step_id, output}` |
| `image_ready` | Prospect | `{index, image_url, rgba_url, raw_path}` |
| `svg_ready` | Prospect | `{index, rgba_url, svg_data}` |
| `view_ready` | Smelt | `{view_angle, image_url, rgba_url}` |
| `mesh_ready` | Forge | `{mesh_url}` |
| `log` | All | `{message}` |
| `done` | All | `{...result data}` |
| `error` | All | `{code, message}` |

### 12.3 Checkpoint Resume

Workers support `resume_from_step`. If a forge job fails at step 3, it can resume from step 3 without re-running steps 0-2. Implemented via `job.checkpoint(step)`.

### 12.4 Error Codes

```
ERROR_PROSPECT_UNKNOWN
ERROR_SMELT_SOURCE_NOT_FOUND
ERROR_SMELT_ENGINE_LOAD
ERROR_SMELT_GENERATE
ERROR_SMELT_REMBG_FAILED
ERROR_FORGE_NO_VIEWS
ERROR_FORGE_BUILD
ERROR_FORGE_DECIMATE
ERROR_FORGE_MISSING_DEP
ERROR_FORGE_EXPORT
ERROR_FORGE_MESH_RECONSTRUCT
```

---

## 13. File System & Project Structure

### 13.1 Runtime Directories

| Path | Purpose | Env Override |
|---|---|---|
| `~/interforge-projects/` | Job outputs, exports | `INTERFORGE_PROJECTS_DIR` |
| `{APPDATA}/IterForge/models/` | AI model weights | `INTERFORGE_MODELS_DIR` |
| `{APPDATA}/IterForge/models/zero123pp/` | Zero123++ cache | — |
| `{APPDATA}/IterForge/models/checkpoints/` | SDXL checkpoints | `INTERFORGE_SDXL_CHECKPOINT` |

### 13.2 Job Output Structure

```
~/interforge-projects/
  {job_id}/
    prospect/
      image_00.png           # Raw SDXL output
      image_00_rgba.png      # After rembg (RGBA)
      image_00.svg           # vtracer silhouette
      profile_{id}.json      # Timing data
      profile_{id}.md        # Human-readable timing
    smelt/
      front/
        image_00.png         # Raw Zero123++ view (320x320)
        image_00_rgba.png    # After rembg
        image_00.svg         # vtracer silhouette
      front_right/           # Same structure per view
      right/
      back/
      left/
      front_left/
    forge/
      mesh_raw.ply           # Visual hull output
      mesh_decimated.ply     # After quadric decimation
      mesh_repaired.ply      # After repair pass
      lod0.obj - lod3.obj    # LOD chain
      asset.glb              # Final export
      project.json           # Manifest
      profile_{id}.json
```

### 13.3 Static File Serving

Generated files are served via FastAPI static mount:
```
http://127.0.0.1:7842/outputs/{job_id}/prospect/image_00.png
```

---

## 14. Dependencies & Versions

### 14.1 Python Backend (Pinned, Tested 2026-04-05)

| Package | Version | Purpose |
|---|---|---|
| diffusers | 0.37.1 | Zero123++ + SDXL pipeline |
| torch | 2.5.1+cu121 | GPU inference |
| transformers | 5.3.0 | CLIP encoder for Zero123++ |
| open3d | 0.19.0 | Poisson reconstruction, decimation |
| trimesh | 4.11.4 | Mesh I/O, repair, smoothing, export |
| scipy | 1.17.1 | gaussian_filter, binary_erosion |
| scikit-image | 0.26.0 | marching_cubes |
| numpy | 2.3.5 | Numerical computation |
| Pillow | 12.1.1 | Image I/O, resizing |
| rembg | 2.0.73 | Background removal (U2Net) |
| vtracer | (latest) | SVG silhouette tracing |

### 14.2 Frontend (npm)

| Package | Version | Purpose |
|---|---|---|
| react | ^18.3.1 | UI framework |
| react-dom | ^18.3.1 | DOM renderer |
| three | ^0.183.2 | 3D mesh viewer |
| @tauri-apps/api | ^2.0.0 | Desktop integration |
| @tauri-apps/plugin-dialog | ^2.0.0 | File dialogs |
| @tauri-apps/plugin-fs | ^2.0.0 | File system access |
| @tauri-apps/plugin-shell | ^2.0.0 | Shell commands |
| typescript | ^5.5.3 | Type safety |
| vite | ^5.4.8 | Build tool |

### 14.3 Rust (Cargo.toml)

| Crate | Version | Purpose |
|---|---|---|
| tauri | 2 | Desktop framework |
| tauri-plugin-shell | 2 | Process spawning |
| tauri-plugin-fs | 2 | File system |
| tauri-plugin-dialog | 2 | Native dialogs |
| serde / serde_json | 1 | Serialization |

---

## 15. Security Model

### 15.1 Tauri 2 Capabilities
- **Shell spawn**: Whitelisted to `py`, `python`, `python3`, `blender` only
- **Filesystem**: Full read/write access (needed for project files)
- **CSP**: Currently `null` (relaxed) — **should be tightened for production**
- **No custom IPC commands**: All business logic runs through HTTP to FastAPI

### 15.2 Network
- Backend binds to `127.0.0.1:7842` (localhost only — not exposed)
- CORS restricted to localhost origins + Tauri WebView
- No authentication (single-user desktop app)

### 15.3 Model Licensing
- **SDXL / Juggernaut XL**: Open-source, permissive
- **Zero123++ v1.2**: Code is Apache 2.0, weights are CC-BY-NC 4.0
  - Model cannot be sold or embedded in commercial product
  - Outputs CAN be used commercially
  - Hosted service (non-commercial model use) likely acceptable
- **rembg / U2Net**: MIT license
- **Depth Anything V2**: Apache 2.0

---

## 16. Known Issues & Recent Fixes

### 16.1 Bugs Fixed (2026-04-05)

| Bug | Impact | Fix |
|---|---|---|
| Grid splitting was 3x2 instead of 2x3 | Every smelting view was a mangled fragment | Changed to `cell_w = w // 2, cell_h = h // 3` |
| Camera poses wrong (0/60/120/180/240/300 at 30 deg) | Projection matrices misaligned with actual views | Updated to 30/90/150/210/270/330 with alternating +20/-10 deg |
| Focal length `image_size * 1.2` wrong for 30 deg FoV | Projections 1.56x too wide, wrong pixel locations | Derived from FoV: `focal = (size/2) / tan(fov/2)` = 1433px |
| No Y-axis flip in extrinsics | Top of object projected to bottom of image | Added `ext[1,:] *= -1` for world Y-up to camera Y-down |
| `silhouette_val = np.zeros()` | All voxels carved away (empty mesh) | Changed to `np.ones()` — out-of-frame voxels kept |
| Input image `.convert("RGB")` | Transparency filled with black, not gray 127 | Pass RGBA as-is, let pipeline handle conversion |
| Missing input preprocessing | Object filled entire frame, views zoomed in | Added crop + 75% fill + gray canvas preprocessing |

### 16.2 Known Limitations

| Issue | Status | Impact |
|---|---|---|
| Vertex colors only (no UV/textures) | Current | Lower visual quality in engines |
| FBX export not supported | Current | Falls back to GLB |
| Photo-consistency threshold (30.0) uncalibrated | Current | May over/under-carve |
| No seed capture in job manifest | Current | Non-reproducible results |
| `vtracer` version not pinned | Current | Potential breakage |
| CSP is null | Current | Should be tightened for production |
| No quantitative evaluation metrics | Current | Can't measure improvement |

---

## 17. Audit Questions for Reviewers

We are seeking feedback on the following areas. Please provide specific, actionable recommendations.

### Architecture & Design

1. Is the 3-stage pipeline (prospect → smelt → forge) the right architecture, or would a 2-stage (image → mesh directly via InstantMesh/FlexiCubes) be better?
2. Is the gate-locked stage progression (with Tinker Mode bypass) good UX, or does it create unnecessary friction?
3. Should we migrate from localStorage to disk-backed project storage now, or wait until the project system matures?
4. Is the singleton GPU engine pattern the right approach for 8GB VRAM management, or should we look at model quantization / pipeline parallelism?

### Reconstruction Quality

5. Is visual hull + photo-consistency + Poisson the right reconstruction approach for 6 views at 320x320px, or should we invest in a learned reconstructor (InstantMesh, TripoSR, etc.)?
6. How should we calibrate the photo-consistency threshold (currently 30.0)? What metrics should we track?
7. Is 256^3 voxel resolution sufficient, or should we scale to 384^3 / 512^3?
8. Are there better alternatives to marching cubes + Poisson for surface extraction from a carved volume?
9. How should we handle the alternating elevation (+20 deg / -10 deg) in reconstruction — does it cause systematic bias?

### Camera Model

10. Is our extrinsic construction correct? `Rx(-el) @ Ry(az)` with Y-flip and Z-translate by radius?
11. Is the focal length derivation from FoV correct for Zero123++ v1.2's output?
12. Are the azimuths truly relative to the input view, or absolute? How do we verify this?
13. Should we account for lens distortion, or is the pinhole model sufficient?

### Performance & Scalability

14. What is the realistic VRAM ceiling for this pipeline on 8GB? Where are the bottlenecks?
15. Should the reconstruction run on GPU (CUDA tensors) instead of CPU (numpy)?
16. How can we reduce the total pipeline time (currently prospect ~30s + smelt ~45s + forge ~60s)?

### Production Readiness

17. What security hardening is needed beyond Tauri capabilities? (CSP, input validation, etc.)
18. Should we implement deterministic seeding for reproducibility?
19. What CI/CD pipeline would you recommend for this stack?
20. What quantitative evaluation framework should we adopt? (Chamfer distance, IoU, user studies?)

### Future Direction

21. Should we prioritize UV unwrap + texture baking, or move to a learned reconstructor first?
22. Is Gaussian Splatting relevant for game asset generation, or is mesh-first the correct approach?
23. Should we add ControlNet depth guidance to Zero123++ for better view consistency?
24. What's the path to scene-level generation (multiple objects, environments)?

---

## Appendix A: Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `INTERFORGE_PROJECTS_DIR` | `~/interforge-projects` | Output root |
| `INTERFORGE_BACKEND_HOST` | `127.0.0.1` | API host |
| `INTERFORGE_BACKEND_PORT` | `7842` | API port |
| `INTERFORGE_MODELS_DIR` | `{APPDATA}/IterForge/models` | Model storage |
| `INTERFORGE_SDXL_CHECKPOINT` | (auto-search) | SDXL path override |
| `INTERFORGE_DEPTH_MODEL` | `vits` | Depth model variant |
| `INTERFORGE_RECON_MODE` | `auto` | Reconstruction mode |
| `INTERFORGE_BACKEND_DIR` | (auto-resolve) | Backend directory override |
| `PYTORCH_CUDA_ALLOC_CONF` | `max_split_size_mb:128` | GPU memory config |

## Appendix B: SSE Event Flow (Forge Pipeline)

```
Client connects: GET /api/jobs/{id}/stream

← event: step_active    {step_id: "build", description: "Construct base mesh..."}
← event: log            {message: "Running visual hull reconstruction..."}
← event: log            {message: "After 'front': 12,345 voxels remain"}
← event: log            {message: "After 'front_right': 8,901 voxels remain"}
← ...
← event: step_done      {step_id: "build", output: "mesh_raw.ply"}
← event: step_active    {step_id: "decimate", description: "Reduce polygon count..."}
← event: step_done      {step_id: "decimate", output: "mesh_decimated.ply"}
← event: step_active    {step_id: "refine", description: "Smooth geometry..."}
← event: step_done      {step_id: "refine", output: "mesh_repaired.ply"}
← event: step_active    {step_id: "lod", description: "Generate LOD chain..."}
← event: step_done      {step_id: "lod", output: "4 LODs generated"}
← event: step_active    {step_id: "export", description: "Package geometry..."}
← event: mesh_ready     {mesh_url: "http://...outputs/{id}/forge/asset.glb"}
← event: step_done      {step_id: "export", output: "asset.glb"}
← event: step_active    {step_id: "save", description: "Write project manifest..."}
← event: step_done      {step_id: "save", output: "project.json"}
← event: done           {mesh_url: "...", export_format: "glb", lod_paths: {...}}
```

## Appendix C: Build & Run Commands

```bash
# Development
npm run dev                          # Vite dev server (port 1420)
npm run tauri dev                    # Full app (Tauri + Vite + backend)

# Production
npm run build                        # TypeScript + Vite → dist/
npm run tauri build                  # Full desktop bundle

# Backend standalone
cd interforge-backend
py -3.11 -m uvicorn main:app --host 127.0.0.1 --port 7842

# Tests
cd interforge-backend
py -3.11 -m pytest tests/
```
