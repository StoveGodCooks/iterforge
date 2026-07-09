# InterForge — Roadmap

Last updated: 2026-04-15

---

## Completed

### Phase 1 — Foundation
Locked product rules: onboarding, Anvil concept, TinkerMode, Projects layer.

### Phase 2 — UI Shell
Vertical stage rail, header bar, asset tray, PipelineContext, stage routing.

### Phase 3 — Project Model
`InterForgeProject` schema, disk layout, Projects CRUD, ProjectsContext.

### Phase 4 — Onboarding
Cinematic first-run walkthrough, step visuals, reopenable from settings.

### Phase 5 — Prospect (Image Generation)
SDXL via diffusers, Juggernaut XL, lock mechanism, asset type picker, style reference.

### Phase 6 — Smelt (Multi-View)
Zero123++ 6-view generation, view grid, per-view approve/reject, lock to Forge.

### Phase 7 — Forge UI + Pipeline (Initial)
Mesh pipeline step tracker, SSE streaming, MeshViewer (Three.js GLB), export format picker, Open Folder / Export Save buttons.

### Phase 8 — Direct Inference Engine
Replaced ComfyUI with direct diffusers pipeline. Zero123++ runs natively, no HTTP overhead. Removed all ComfyUI dependencies.

### Phase 9 — Reconstruction Overhaul
Visual hull carving with proper camera matrices, SVG silhouette rasterization, Poisson surface reconstruction, vertex color projection, 35 camera convention unit tests.

### Phase 10 — Reconstruction Quality Pass
Weighted front view carving, Taubin smoothing, Eikonal SDF regularization, front-view depth fusion, cross-view consistency.

### Phase 11 — Pipeline Closure + Publish
Pipeline loop closed (Forge → Publish auto-navigate), Publish SpriteSheet functional, ExportHub open-folder wired, `/api/publish/sprite-atlas` endpoint.

### Phase 12 — Shell Architecture Rebuild (2026-04-10)
Replaced horizontal tab bar with vertical stage rail (160px). StageRail, HeaderBar, AssetTray shell components. PipelineContext + AssetTrayContext replacing App.tsx state. TinkerMode removed — all stages always accessible. Vision and Publish stages wired into shell as stubs.

### Phase 13 — Forge Fire Design System (2026-04-13)
Complete CSS token rebuild across 20+ files. Warm forge-black surfaces, yellow→orange brand gradient, radial ambient lighting on every canvas. LOGO2.png integrated into rail. Rail expanded to 160px with horizontal icon+label buttons. All hardcoded blue-navy values swept and replaced.

---

## Up Next

### Phase 14 — 2D Sprite Pipeline + IP-Adapter ← COMPLETE
2D directional sprite generation using SDXL + IP-Adapter identity conditioning.

**Backend:**
- Swapped Juggernaut XL → DreamShaper XL in `inference/engine.py` + setup wizard
- IP-Adapter (h94/IP-Adapter ViT-H, ~4.1GB auto-download): `load_ip_adapter()` + `generate_with_reference()` on ForgeEngine. txt2img with identity conditioning — no spatial lock, direction prompts freely control pose
- img2img fallback if IP-Adapter unavailable (network, OOM)
- `mode: "2D" | "3D"` in SmeltRequest + smelt_worker routing
- `run_smelt_2d_directions()` — hardcoded direction prompts, IP-Adapter path primary, emits same `view_ready` SSE events
- `api/forge2d.py` + `workers/forge2d_worker.py` — 6-step pipeline: load → rembg → trim → outline → pack → save
- Forge2d router in main.py

**Frontend:**
- Smelting: `2D SPRITE | 3D MULTI-VIEW` mode toggle (defaults to 2D). 2D shows 2×2 grid (Front/Back/Left/Right)
- Forge: "2D Sprite" pipeline card + `TwoDPipeline` component (step tracker, direction previews, sprite sheet download)
- `pipeline.ts`: `SmeltMode`, `TwoDForgeOutput`, `sprite_ready` SSE event type

### Phase 15 — LCM LoRA Speed Mode
Add `latent-consistency/lcm-lora-sdxl` (~200MB) to the setup wizard. Wire into the 2D pipeline as a "Fast" generation mode (12–15 steps instead of 30). At 512px + LCM: ~6–8 seconds for all 4 directions vs ~35 seconds standard. "Quality" mode stays at 30 steps, 1024px.

### Phase 16 — ControlNet OpenPose for 2D Directions
Add pose skeleton control on top of IP-Adapter for precise direction matching.

- **Model:** `xinsir/controlnet-openpose-sdxl-1.0` (~2.5GB)
- **Pose templates:** 8 pre-built PNG stick figures shipped with the app (front, back, left, right + 4 diagonals). Standard idle T-stance per direction.
- **Pipeline stack:** IP-Adapter (identity) + ControlNet OpenPose (pose) + DreamShaper XL (generation). All three composable.
- **LCM LoRA compat:** yes, at 12–15 steps.
- **Why now:** IP-Adapter solves identity drift but direction accuracy still depends on prompt engineering. ControlNet adds geometric pose certainty.

### Phase 17 — TripoSR for 3D Mesh Pipeline
Replace Zero123++ → TSDF reconstruction chain with TripoSR direct image-to-mesh.

- **Model:** `stabilityai/TripoSR` (~1.56GB) + DINO ViT-B/16 image encoder (~327MB)
- **Total:** ~1.9GB download, 3–4GB VRAM (FP16)
- **Pipeline:** single prospect image → TripoSR → 3D mesh in seconds (no multi-view intermediate)
- **Post-processing:** decimation, vertex color projection, Taubin smoothing (existing forge_worker steps reused)
- **Advantage:** faster, more geometrically consistent than multi-view reconstruction. One forward pass vs 6 views + carving.

### Phase 18 — State Persistence
All pipeline state lives in React useState — app restart loses everything.
- Serialize prospectData, smeltData, forgeData to localStorage on change.
- Restore on mount. Job IDs are stable UUIDs; output files persist on disk.
- Add `/api/jobs/{id}/files` endpoint: resolves job ID → output dir from `project.json` independently of in-memory job registry.

### Phase 19 — UV Unwrap + Texture Atlas
Vertex colors are a stopgap. Game engines expect UV maps + texture PNGs.
- **xatlas** (pip install xatlas): CPU-only UV chart generation. Bake vertex colors → texel lookup. Outputs GLB with TEXCOORD_0 + albedo PNG.
- Add UV step between Refine and LOD in forge_worker.py.
- Update ForgeOutput.texturePaths fields.

### Phase 20 — Validation Run (3D Pipeline)
Run a real asset (barrel, crate, character) through Prospect → Smelt → Forge → Publish. Inspect GLB in Blender. Check: watertight mesh, correct normals, vertex color coverage >80%, face count before/after decimation. Fix whatever breaks. Most important phase before showing the app to anyone.

### Phase 21 — Normal ControlNet for 3D
`controlnet-zp12-normal-gen-v1` (~1.2GB) runs alongside Zero123++ to produce per-view normal maps at no extra generation cost. Wire as optional flag in smelt worker. Per-view normals feed into post-stage consistency checks.

### Phase 22 — Sprite Pipeline Full Build
Current 2D forge packs directional stills. Full animation pipeline:
- Walk cycle generation (multiple smelt runs, blended directions)
- Per-frame outline pass
- Godot `.tres` SpriteFrames resource export
- Unity sprite metadata JSON

### Phase 23 — FBX Export
trimesh has no native FBX writer. Detect Blender on PATH, call headless: `blender --background --python bake_and_export.py`. Input: GLB. Output: FBX 2017+. If Blender not found: show install link, disable FBX button.

### Phase 24 — Comic Strip + Tiles
- Comic Strip: drag panels from Asset Tray, editable speech bubbles, panel layout options, PNG/PDF export.
- Tiles: seamless tiling algorithm, preview viewport, edge-matching validation.

---

## Parking Lot (future consideration)

| Item | Notes |
|------|-------|
| ControlNet OpenPose — 2D sprites | Phase 16. IP-Adapter handles identity; ControlNet adds exact pose control on top. |
| TripoSR — 3D mesh from single image | Phase 17. Direct image→mesh replaces Zero123++ multi-view reconstruction chain. |
| Blender Cycles texture bake | High quality UV + PBR textures. Requires Blender. Gate behind settings flag. |
| Rigging hints | MediaPipe face landmarks → blendshape proxy bones in GLB |
| LoRA fine-tuning | Train on user's own art style, inject into base checkpoint |
| Cloud sync | Optional backup of projects to user-owned storage (S3/R2) |
| Higher VRAM tiers (12GB, 16GB+) | InstantMesh, larger Zero123++ variants, Stable Zero123 |
| Batch generation | Queue multiple assets, run overnight |
| Zero123++ v1.1 + depth ControlNet | ~5.7GB total VRAM. Constrains generation geometry at source. Config flag only — 8GB cards can't run it in standard mode. |
