# InterForge — Roadmap

Last updated: 2026-07-10

InterForge is a free, local, open-source AI game-asset pipeline: a Tauri desktop
app that turns a text prompt into concept art, directional sprites, and a
game-ready textured 3D mesh — entirely on your own machine.

> **Architecture note (2026):** The 3D pipeline was rebuilt around **Stable Fast
> 3D (SF3D)** — a single image → UV-textured mesh in one pass. This replaced the
> earlier ComfyUI + Zero123++ multi-view + TSDF/visual-hull reconstruction chain,
> which has been removed. Older phase notes describing that chain are archived in
> `docs/archive/` for history.

---

## Current architecture

| Stage | Engine | Status |
|-------|--------|--------|
| **Prospect** | SDXL (base SDXL default; DreamShaper Turbo optional) via `diffusers`, with IP-Adapter (identity) + ControlNet OpenPose (pose) + LoRA support | ✅ Working |
| **Smelt** | Directional sprite frames — ControlNet OpenPose + IP-Adapter (`run_smelt_sprite_sheet`) or ControlNet-only tiled sheet | ✅ Working |
| **Forge** | **SF3D** single image → UV-textured GLB (primary); plus 2.5D depth relief, flat billboard, and 2D-only (no-mesh) routes | ✅ Working |
| **Anvil** | Sketch / storyboard board | ✅ Working |
| **Publish** | Sprite-atlas packing (`/api/publish/sprite-atlas`) | ✅ Working |

**Cross-cutting systems:** MasterForge asset-type rules engine · pluggable model
registry + switcher (`inference/model_registry.py`) · SSE job manager with
per-subscriber replay · VRAM arbiter (one heavy model resident at a time) ·
Projects layer · onboarding · setup wizard · DevTools.

---

## Completed

- **Foundation & shell** — Tauri 2 + React/Vite, vertical stage rail, header bar,
  asset tray, PipelineContext, ErrorBoundary, Projects CRUD, onboarding.
- **Prospect** — SDXL generation, asset-type picker, style/reference conditioning,
  IP-Adapter, ControlNet OpenPose, LoRA panel, lock-to-next-stage flow.
- **Smelt** — directional/multi-pose sprite generation (ControlNet + IP-Adapter).
- **Forge (SF3D)** — single-image → textured mesh, GLB export, MeshViewer
  (Three.js), 2.5D relief / billboard / 2D routes, sprite-atlas publish.
- **Direct inference** — removed ComfyUI; models run natively via `diffusers`.
- **8 GB baseline hardening** — VRAM arbiter, model offload/on-load, works on an
  RTX 3070-class card.
- **Model registry + switcher** — pluggable adapter; base SDXL is the single
  canonical default; user-dropped checkpoints auto-scanned.
- **Project cleanup (2026-07)** — MIT license, README, honest requirements,
  removed ~1,200 lines of dead code, central API client, job-id path validation,
  Three.js texture disposal, bounded job registry.

---

## Up next

### N1 — Cross-platform support
- **Linux:** already functional with an NVIDIA GPU (the Tauri shell spawns
  `python3.11`). Add a Linux dev launcher to match the Windows `.bat`/`.ps1`, and
  verify an end-to-end run. **Priority: high — closest to done.**
- **macOS:** currently UI-only. The inference stack is CUDA-locked and falls back
  to CPU, not Metal. Needs an **MPS/Metal device path** in `engine.py` /
  `sf3d_engine.py` / `depth.py`, and a non-CUDA mesh-texture bake (SF3D's
  `texture_baker` is a CUDA extension). Larger effort.

### N2 — 16 GB tier: InstantMesh
Multi-view reconstruction (Zero123++ 6-view → FlexiCubes mesh) as an optional
higher-VRAM path that fixes SF3D's flat/shallow back. Validated on a T4 16 GB
(depth 0.48 → 1.97 with real wrap-around detail). Wire as a tier the installer
offers on 16 GB+ cards.

### N3 — Speed mode (LCM LoRA)
Add `latent-consistency/lcm-lora-sdxl` as a "Fast" generation mode (~12–15 steps
vs 30) for Prospect and the 2D sprite pipeline.

### N4 — State persistence
Serialize prospect/smelt/forge stage data so an app restart doesn't lose work;
add `/api/jobs/{id}/files` to resolve outputs independent of the in-memory registry.

### N5 — Frontend SSE hook
Extract the per-tab EventSource state machines (Prospect/Smelt/Forge) into one
`useJobStream` hook. URL/endpoint is already centralized in `src/api/client.ts`;
this needs a live backend to verify streaming behavior.

### N6 — Export & texture quality
- FBX export via headless Blender (trimesh has no FBX writer).
- UV/texture-atlas refinements on the SF3D output for engine import.

---

## Parking lot

| Item | Notes |
|------|-------|
| Higher-VRAM variants | 12 GB / 24 GB tiers; larger reconstructors |
| Sprite animation | Walk cycles, per-frame outline, Godot `.tres` / Unity metadata export |
| Comic strip + tiles | Panel layout + seamless tiling tools |
| Rigging hints | Landmark → proxy-bone export in GLB |
| LoRA fine-tuning | Train on the user's own art style |
| Auto-updater | Tauri updater (needs signing key) |

---

## Platform / hardware summary

| Platform | UI | Image gen (SDXL) | 3D (SF3D) |
|----------|----|------------------|-----------|
| **Windows + NVIDIA (CUDA 12.1)** | ✅ | ✅ | ✅ (baseline target, 8 GB) |
| **Linux + NVIDIA (CUDA 12.1)** | ✅ | ✅ | ✅ (dev launcher pending) |
| **macOS (Apple Silicon / Intel)** | ✅ | ⚠️ CPU-only, very slow | ❌ CUDA-only, needs MPS port |
| **Any, CPU-only** | ✅ | ⚠️ very slow | ❌ SF3D needs CUDA |
