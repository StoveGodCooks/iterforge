# InterForge — Dev Log

Reverse-chronological. Each entry covers a session or phase of significant change.

---

## 2026-04-15 — Phase 14: IP-Adapter + 2D Pipeline Build

### What shipped

**IP-Adapter integration for 2D direction generation**
Replaced broken img2img approach with IP-Adapter identity conditioning. Root problem: img2img preserves *spatial layout* from the source image, not character identity. At any denoising strength there's an unsolvable tradeoff — low strength = pose doesn't change, high strength = character drifts. IP-Adapter solves both problems by encoding the reference image as a CLIP visual embedding (identity/outfit/proportions) and using txt2img with free pose generation from the direction prompt.

- `ForgeEngine.load_ip_adapter()` — loads `h94/IP-Adapter` ViT-H variant (~4.1GB, auto-downloads on first 2D smelt run, cached in `~/.cache/huggingface/`)
- `ForgeEngine.generate_with_reference()` — txt2img + `ip_adapter_image` conditioning. `ip_adapter_scale` (0.4–0.7) controls identity↔prompt balance
- `run_smelt_2d_directions()` rewritten: IP-Adapter path primary, img2img as fallback if adapter fails to load
- White-background RGB composite for CLIP encoder input (was gray for img2img)

**DreamShaper XL fully wired**
Juggernaut XL replaced everywhere: `engine.py`, `api/setup.py`, `workers/setup_worker.py`, `api/status.py`, `masterforge/asset_configs.py`. Setup Wizard now downloads DreamShaper. Legacy Juggernaut paths kept as fallback for existing installs.

**2D Forge pipeline bug fix**
`_add_outline()` in `forge2d_worker.py` was missing `from PIL import Image` — only imported `ImageFilter`. Caused `NameError: name 'Image' is not defined` on the outline step.

**Neocities overwrite recovery**
Previous session's neocities work overwrote `index.html` at project root with a static marketing page. Tauri WebView loaded the marketing site instead of mounting React. Restored from git (`git show HEAD:index.html`). Stray `style.css` and `main.html` neocities files remain in root as untracked clutter.

### Architecture decisions

- **IP-Adapter scale 0.6 default** — empirical sweet spot. 0.5 gives more direction freedom but slight identity softening. 0.7+ can fight the direction prompt. Exposable as a slider later.
- **Same seed across all directions** — reduces inter-view variance. Each direction uses the same base noise lattice; only the prompt differs.
- **DPM++ 2M scheduler for directions** — more prompt-faithful than Euler Ancestral. Better direction adherence.
- **TripoSR pinned for Phase 17** — single-image-to-3D (~1.9GB, 3-4GB VRAM FP16) replaces Zero123++ → TSDF chain. Different pipeline from 2D sprites. Uses DINO ViT-B/16 not CLIP.
- **ControlNet OpenPose pinned for Phase 16** — stacks on top of IP-Adapter for geometric pose certainty. ~2.5GB download.

### Tech debt

- 2 git commits total, everything else uncommitted. Need a checkpoint commit.
- `img2img()` method still in ForgeEngine — kept as fallback, may be useful for other purposes (style transfer, etc.)

---

## 2026-04-14 — Phase 13: Forge Fire Design System + 2D Pipeline Planning

### What shipped

**Model swap — Juggernaut XL → DreamShaper XL (planned, not yet built)**
Juggernaut XL was the initial checkpoint. Audit found DreamShaper XL covers 100% of asset types (characters, creatures, props, environments, backgrounds, concept art) with no category gaps. Juggernaut is stronger on photorealism which is irrelevant to game art production. DreamShaper is more consistent across stylized output. Decision: swap checkpoint, no prompt system changes needed (DreamShaper doesn't require Pony-style quality tags).

**Forge Fire color system — complete CSS token rebuild**
All 20+ CSS files audited and rebuilt around a unified warm token system. Key decisions:
- `--bg-void: #0E0C0A` — warm-tinted forge black (not pure black, not blue-black)
- `--yellow-core: #D4920F` / `--yellow-bright: #F0B828` — from the "I" in the logo
- `--ember-core: #E8621A` / `--ember-bright: #F07838` — from the "F" in the logo
- `--forge-gradient: linear-gradient(135deg, #F0B828, #E8621A)` — brand signature
- Radial ambient lighting on every canvas area: yellow crown glow (top) + ember floor glow (bottom)
- Surface elevation replaces border-heavy bento grid — depth via lightness, not 1px rules

Root cause of the broken lighting: hardcoded `rgba(9,13,22,0.86)` blue-navy values in anvil.css and Prospecting.css predated the token system and were fighting it silently. Swept all files with sed and verified 0 stale values remaining.

**Shell rebuild — Phase 12 (vertical rail architecture)**
Replaced horizontal tab bar + titlebar with:
- `src/shell/StageRail.tsx` — 160px vertical left rail with LOGO2.png + 7 stage buttons
- `src/shell/HeaderBar.tsx` — 44px top bar with stage title, project pill, window controls
- `src/shell/AssetTray.tsx` — 260px right sidebar (collapsible)
- `src/contexts/PipelineContext.tsx` — active stage state, `navigateTo()`, replaces App.tsx tab state
- `src/contexts/AssetTrayContext.tsx` — tray items, open/close

Logo: LOGO2.png — riveted forge plate "IF" logo, gorget/plate shape, amber-to-deep-orange gradient. Loaded via Vite asset import (`src/assets/logo.png`). Created `src/vite-env.d.ts` for TypeScript PNG module type support.

Rail width expanded to 160px (was 72px) to accommodate horizontal icon+label layout. Logo renders at 144px with `drop-shadow(0 0 18px rgba(212,154,16,0.5))`.

**2D pipeline architecture decisions**
Extended research session. Key decisions locked:

1. **Skip Zero123++ for 2D** — Zero123++ generates fixed camera-orbit angles (0°/60°/120°/180°/240°/300°) baked for 3D reconstruction. Wrong angles for 2D game sprites. Cannot change them — baked into v1.2 weights.

2. **img2img for directional generation** — SDXL img2img at strength 0.4–0.6 preserves art style/colors while changing facing direction. Prompts are hardcoded per direction (user never touches them). Negative prompts hardcoded. User controls: directions (4-way or 8-way), gen resolution (512 fast / 1024 quality), export size (64/128/256/512px).

3. **ControlNet OpenPose deferred** — Architecturally correct (pose skeleton → exact body position per direction) but requires ~1.5GB extra download and pre-made skeleton PNGs. Deferred to Phase 15. v1 ships with img2img.

4. **LCM LoRA for speed** — `latent-consistency/lcm-lora-sdxl` (~200MB) drops img2img from 30 steps → 12-15 steps. At 512px: all 4 directions in ~8-10 seconds vs ~35 seconds without. Part of Phase 14 setup checklist.

5. **Smelt 2D toggle defaults to 2D** — Smelting page gets a `3D | 2D` mode pill. 2D mode replaces the 3×2 Zero123++ view grid with a 2×2 directional grid (Front/Back/Left/Right). Defaults to 2D since most game assets are 2D sprites.

### Key decisions

**Why not ControlNet for v1?**
Speed is the same (full diffusion either way). ControlNet adds a model download, pose skeleton assets, and setup complexity. img2img at 0.5 strength handles stylized sprites well. ControlNet deferred to when we can measure where img2img actually fails on real assets.

**Why DreamShaper over Pony Diffusion XL?**
Pony's edge on stylized game art (~10% better on sprites/characters) doesn't justify the trade-offs: requires quality tags (`score_9, score_8_up`) in every prompt, weaker on environments/backgrounds (20-30% gap), NSFW training bias needs filtering. DreamShaper covers 100% of asset types without special prompting.

**Why remove the is2DOnly hard block in Smelting?**
Previously blocked 2D asset types from entering Smelting entirely. With 2D mode, these types now have a valid path. Block removed — routing is handled by the mode toggle instead.

### Not yet built (Phase 14 scope)
- DreamShaper XL checkpoint download in setup wizard
- img2img `engine.py` method
- Smelt 2D mode backend worker (`run_smelt_2d_directions`)
- Smelt 2D toggle in frontend (4-panel 2×2 grid)
- `api/forge2d.py` + `workers/forge2d_worker.py`
- `TwoDPipeline` component in Forge.tsx
- LCM LoRA integration

---

## 2026-04-13 — Phase 12c: Logo + Rail Polish

### What shipped

**Logo integration**
Replaced the plain "IF" text badge in the rail with LOGO2.png — a riveted forge plate logo, gorget/plate shape, amber-to-deep-orange gradient on the "F". Loaded via Vite asset import (`import logoUrl from "../assets/logo.png"`). Created `src/vite-env.d.ts` with `/// <reference types="vite/client" />` to give TypeScript proper module types for PNG imports (without this, `import foo from "*.png"` is a type error).

Rail container: 148px, logo image: 144px with `drop-shadow(0 0 18px rgba(212,154,16,0.5))` amber glow. Logo sits flush at the top of the rail, full-width.

**Rail width expansion — 72px → 160px**
At 72px the rail buttons were icon-only. User requested labels alongside icons. Expanded rail to 160px, rebuilt button layout as horizontal (icon left + label right). Active button gets the forge gradient left stripe indicator + forge glow background. Rail buttons are 140px wide, 44px tall.

**Forge Fire token foundation — global.css**
Designed and locked the warm color system. Every surface, text, and accent token rebuilt from scratch:

```
--bg-void:   #0E0C0A   (warm-tinted forge black — not pure, not blue)
--bg-base:   #141210
--bg-raised: #1C1916
--bg-overlay: #252018
--yellow-core:   #D4920F  (the "I" — deeper amber)
--yellow-bright: #F0B828  (the "I" — bright yellow)
--ember-core:    #E8621A  (the "F" — forge orange)
--ember-bright:  #F07838  (the "F" — bright ember)
--forge-gradient: linear-gradient(135deg, #F0B828, #E8621A)
```

Added `--forge-gradient-h` (horizontal), `--forge-glow-bg`, `--forge-glow-strong`, `--shadow-forge`, `--shadow-ember`, `--shadow-yellow-strong` for use across all components. Added `forge-pulse` keyframe animation.

**shell.css + components.css**
- Rail active state: `var(--forge-glow-bg)` background, forge gradient left stripe with `box-shadow` glow
- Header project pill: forge glow background, `--yellow-bright` text
- Primary buttons: `var(--forge-gradient)` background, black text, forge shadow
- Lock buttons: ember gradient, white text
- Progress fills: `var(--forge-gradient-h)` with dual yellow glow
- Scrollbar: 4px, transparent track, silver thumb → amber on hover

### Key decisions
- Logo file copied to `src/assets/logo.png` (not public/) so Vite processes it through the asset pipeline and content-hashes the filename for cache busting.
- `vite-env.d.ts` is a single line — just the triple-slash reference. No custom declarations needed because Vite's built-in `ImportMeta` types cover `*.png` once the reference is present.

---

## 2026-04-12 — Phase 12b: Cross-Stage Flow + Context Menu

### What shipped

**ContextMenu — portal-based right-click system**
`src/shell/ContextMenu.tsx` — fixed-position context menu rendered into a portal at `document.body`. `useContextMenu()` hook exposes `open(x, y, entries)` and `close()`. Entries are `{ label, icon?, action }` objects. Closes on outside click or Escape.

VisionBoard wires right-click on every card: "Pin to Prospect", "Send to Anvil", "Send to Smelt", "Remove". Clicking "Pin to Prospect" sets `pinned: true` on the card; the Prospect stage banner reads pinned cards from PipelineContext.

**AssetTray wired up**
AssetTray renders thumbnails from `AssetTrayContext`. Right-click on any thumbnail opens the context menu with "Send to Prospect", "Send to Anvil", "Send to Smelt". Smelt stage auto-adds approved views to the tray via `addToTray()` from context.

**Vision Board — full implementation**
`VisionBoard.tsx` — add card (blank or from tray), pin/unpin (star toggle), tag editing (inline chips), note editing (click-to-edit), remove. Cards show image thumbnail if `imageSrc` is set, placeholder icon otherwise. Pinned cards render with a yellow-bright star and forge border glow.

**Vision Sequence — scrollable frame strip**
`VisionSequence.tsx` — horizontal scrolling strip of frame cards. Each frame has `imageSrc`, `caption` (click-to-edit inline). Frames can be reordered (drag intent tracked but snap-reorder not yet wired). "Add Frame" button appends blank frame at end.

**Publish stage — all four modes stubbed**
`PublishStage.tsx` — mode tab bar (Comic Strip / Sprite Sheet / Tiles / Export Hub). Sprite Sheet reads actual smelt view images from PipelineContext. Comic Strip: 2×2 panel grid with placeholder speech bubble overlays. Tiles: 3×3 tiling preview stub. Export Hub: format cards (Godot, Unity, PNG Atlas) — Export Hub and Comic Strip are interactive stubs, Sprite Sheet fully functional (re-uses existing `/api/publish/sprite-atlas`).

### Key decisions
- Context menu uses `ReactDOM.createPortal` to `document.body` — avoids z-index stacking context issues with any parent `overflow: hidden` container.
- VisionBoard state is local (not persisted to PipelineContext yet) — cards reset on navigation. Phase 16 wires this to `InterForgeProject.visionBoard` on disk.
- "Send to" in context menu calls `navigateTo(target)` only — it doesn't yet pass the asset data. Full data handoff is Phase 16.

---

## 2026-04-11 — Phase 12a: Stage Wrappers + Anvil Promotion

### What shipped

**Stage wrappers — ProspectStage, SmeltStage, ForgeStage**
`src/stages/Prospect/ProspectStage.tsx` — bridges `usePipeline()` context to Prospecting.tsx props. Reads `prospectData` from context, passes `onLock` callback that calls `lockStage("prospect", data)` then auto-navigates to Smelt.

`src/stages/Smelt/SmeltStage.tsx` — same pattern. Reads `prospectData.data` from context and passes as `prospectingData` prop. `onLock` calls `lockStage("smelt", data)` then auto-navigates to Forge.

`src/stages/Forge/ForgeStage.tsx` — 14-line connector. Reads smelt + prospect data from context, passes `onLock` that calls `lockStage("forge", data)` then navigates to Publish.

**Anvil promoted to full stage**
`src/stages/Anvil/AnvilStage.tsx` — full stage layout: canvas (center) + sidebar (right). Sidebar has three panels stacked vertically: Layers (stub), AI Tools (stub), Send-to buttons.

`AnvilLayers.tsx` — visual layers panel. Static list of layer rows (Background, Sketch, Lineart, Color, Effects). Toggle visibility icon, layer name, drag handle icon. Not wired to canvas layer model — visual scaffold for Phase 16.

`AnvilAITools.tsx` — three action buttons: Inpaint, Outpaint, Upscale. Each opens a toast: "Coming in Phase 16." Button layout matches the mockup — icon + label + keyboard shortcut badge.

`AnvilWorkspace.tsx` — removed hardcoded `1400 × 900` canvas dimensions. Now reads `containerRef` bounding rect and resizes canvas to fill parent. Avoids the overflow bleed that was clipping content in the old embedded panel layout.

**Forge placeholder**
`src/stages/Forge/ForgeStage.tsx` — bridges PipelineContext to Forge.tsx. Forge.tsx internally renders the pipeline picker → Mesh or Sprite pipeline. The old Phase 17 placeholder stub was replaced with a real bridge — same component, no stub message.

**App.tsx rebuilt**
Old: Titlebar component + horizontal tab bar + `tinkerMode` boolean + `stages` array + stage gating logic.  
New: `PipelineProvider > ProjectsProvider > AssetTrayProvider > .app-shell > [StageRail | .app-main > [HeaderBar | .content-wrap > stage workspace]]`. Tinker Mode removed entirely — all stages always accessible. Window controls moved from Titlebar into HeaderBar right side.

### Key decisions
- `tinkerMode` removed from all Props interfaces. The one backend payload field `tinker_mode: true` is kept hardcoded in forge_worker since the backend still reads it.
- Stage gating removed: the rail is always fully clickable. No lock icons, no disabled states. User navigates freely.
- `AnvilWorkspace` `embedded` prop added — when `true`, removes the outer chrome (title bar, close button) that was designed for the old floating panel layout.

---

## 2026-04-10 — Phase 12: Shell Architecture

### What shipped

**Vertical rail replacing horizontal tab bar**
`src/shell/StageRail.tsx` — 160px left rail. Logo at top, stage buttons stacked vertically, Projects pinned at bottom, DevTools below that (only renders when `devToolsEnabled`). Each button: SVG icon + label, 140×44px, horizontal layout. Active state: forge gradient left stripe + forge glow background.

`src/shell/HeaderBar.tsx` — 44px top bar. Left: stage title + subtitle (from `STAGE_META` in pipeline.ts). Center: project name pill (forge glow, amber text). Right: tray toggle button + Tauri window controls (minimize / maximize / close). `-webkit-app-region: drag` on the bar background, `-webkit-app-region: no-drag` on all buttons.

`src/shell/AssetTray.tsx` — 260px right sidebar. Collapsible via tray toggle in HeaderBar. Thumbnail grid with placeholder empty state. Right-click context menu per item. Collapse animation: CSS `width` transition from 260px → 0.

**PipelineContext**
`src/contexts/PipelineContext.tsx` — replaces all App.tsx stage state. Exposes: `activeView`, `navigateTo()`, `prospectData`, `smeltData`, `forgeData`, `lockStage()`, `devToolsEnabled`, `setDevToolsEnabled`. Singleton provider wraps the entire app tree.

**AssetTrayContext**
`src/contexts/AssetTrayContext.tsx` — tray item list, `addToTray(item)`, `removeFromTray(id)`, `clearTray()`, `isTrayOpen`, `setTrayOpen()`. Each tray item: `{ id, imageSrc, label, sourceStage, addedAt }`.

**Vision + Publish stages — initial stubs**
`src/stages/Vision/VisionStage.tsx` — Board/Sequence toggle at the top. Routes to `VisionBoard` or `VisionSequence` sub-component.

`src/stages/Publish/PublishStage.tsx` — mode tab bar (Comic Strip / Sprite Sheet / Tiles / Export Hub). Initial render: each mode shows a placeholder card with an icon and "coming soon" note.

**CSS additions**
`src/styles/shell.css` — rail, header bar, asset tray, layout skeleton.  
`src/styles/vision.css` — board grid, sequence strip, card styles.  
`src/styles/publish.css` — mode tab bar, panel grid, export card grid.  
`src/styles/context-menu.css` — fixed-position menu, entry hover state.  
`src/styles/anvil-stage.css` — stage-level layout for Anvil sidebar.

**pipeline.ts type expansions**
Added `VisionCard`, `VisionFrame`, `PublishMode`. Expanded `AppView` to include `"vision"`, `"anvil"`, `"publish"`. Added `STAGE_META` record with title + subtitle per view.

### Key decisions
- `STAGE_META` lives in pipeline.ts (not shell components) — it's data about the pipeline stages, not UI logic. Header bar just reads it.
- `AssetTrayContext` is separate from `PipelineContext` — tray is a UI affordance, not a pipeline contract. Keeping them separate makes both easier to reason about.
- Vision and Publish start as stubs wired into the shell — the shell architecture is validated before the content is built. Don't build content into a shell that isn't confirmed to work.

---

## 2026-04-09 — Phase 11: Pipeline Closure + Publish

### What shipped
- **ForgeStage restored**: Replaced the Phase 17 placeholder stub with a real PipelineContext bridge. ForgeStage.tsx is now 14 lines — just a connector between usePipeline() and the 748-line Forge.tsx. Pattern mirrors SmeltStage.tsx.
- **tinkerMode removed**: The concept was a gate-bypass from before the vertical rail existed. Now that all stages are always accessible, the flag is meaningless. Removed from Props/MeshPipelineProps/SpritePipelineProps interfaces throughout Forge.tsx. The one backend payload field `tinker_mode: true` is kept hardcoded since the backend still reads it.
- **Reconstruction consolidated**: forge_worker.py had two diverging codepaths — `_step_reconstruct` (230-line orthographic carving, no camera matrices, Phase 7 era) and `_step_reconstruct_tsdf` (perspective projection, delegates to reconstruct.py, Phase 9 era). After Phase 9 added proper camera handling, the fallback was never updated. Replaced the entire fallback body with a 50-line delegate to `visual_hull_reconstruct()`. Single codebase going forward.
- **Pipeline loop closed**: Forge.tsx SSE `done` handler now calls `onLock(ForgeOutput)` → PipelineContext `lockStage("forge")` → `setActiveView("publish")`. The chain from Prospect → Smelt → Forge → Publish is now fully automatic.
- **Publish — SpriteSheet**: Rewrote from placeholder to real implementation. Reads `smeltData.data.views` from PipelineContext, renders actual view images. "Export PNG Atlas" and "Export + JSON Metadata" wired to `POST /api/publish/sprite-atlas` with Tauri save dialog + writeFile.
- **Publish — ExportHub**: "Open Project Folder" and "Individual Files" both call `open(projectFolder)` via Tauri shell plugin. Status line shows mesh filename, export format, poly count from forgeData.
- **`/api/publish/sprite-atlas`**: New backend endpoint. Loads 6 smelt RGBA views (`image_00_rgba.png` with `.png` fallback), packs into 3×2 PIL atlas at uniform cell size. Default: returns PNG directly. `?include_json=true`: returns JSON with `atlas_url` + per-frame `{name, label, x, y, w, h}`.

### Key decisions
- `onLock` prop added to Forge.tsx (optional, not required) so it compiles cleanly when rendered outside a pipeline context.
- `polyCount: 0` placeholder in ForgeOutput — the worker doesn't currently return vert/face count. Phase 12 should populate this from `trimesh.faces.shape[0]` after load.
- Sprite "Export for Godot" button exists in the UI but is disabled. Phase 17 will wire it.

---

## 2026-04-09 — Phase 10: Reconstruction Quality Pass

### What shipped
- **Weighted front view**: Front image (user's actual Prospect photo) gets carving weight 1.0. The 5 AI-generated side views soft-carve at 0.4–0.6. Prevents Zero123++ inconsistencies from destroying geometry the front view confirms is solid.
- **Taubin smoothing**: Replaced Laplacian with Taubin (λ=0.5, μ=-0.53). Alternating positive/negative steps smooth without volume shrinkage. Organic assets — characters, creatures — keep proportions instead of deflating.
- **Eikonal SDF regularization**: `_occupancy_to_sdf()` uses `scipy.ndimage.distance_transform_edt` to convert raw occupancy to a signed distance field where interior = negative, exterior = positive, surface = 0. Enforces |∇SDF|=1, eliminating jagged spikes from view inconsistency. Isosurface extracted at `level=0.0` instead of the old 0.3 threshold.
- **Front-view depth fusion**: DepthAnything V2 runs on the front image only (real ground truth). Depth reprojected into voxel space, votes to keep/reduce occupancy based on proximity to depth surface. Blended at weight 0.3 — refines rather than overrides silhouette hull.
- **Cross-view consistency**: Vectorized silhouette expansion ensures geometry confirmed by the front view isn't silently carved away by misaligned side views. Silhouette shrinking deliberately excluded — the front view only covers ~120° of object surface. It cannot authoritatively rule out geometry it can't see.
- **`depth_to_normals()` utility**: Finite-difference surface normals from depth map. `nz = -2.0/focal_length`, normalized to unit float32 (H,W,3). Available for future normal consistency checks (Phase 15 ControlNet).

### Key decisions — depth design

**Why front-view depth only, not all 6?**

DepthAnything V2 estimates depth from a single image. Running it on 5 AI-generated views produces hallucinated depth from hallucinated images — the model is estimating depth in a synthetic world that never existed. The front image is the one real image the user provided. It's the only ground truth in the pipeline.

Running depth estimation on all 6 views was initially implemented, then removed after this question: *"estimate_depth_batch why are we estimating?"* Correct answer: we're not estimating — we're measuring one real image and using it to constrain the rest.

**Why not cross-view depth alignment?**

`align_depth_to_reference()` was implemented (least-squares scale+shift via `np.linalg.lstsq`). The function exists in reconstruct.py but is not called. Reason: DepthAnything V2 outputs relative disparity (1/Z), not metric Z-distance. Treating it as metric Z and unprojecting it as if it were a real point cloud is mathematically invalid. Useful only when a metric depth source is available (stereo, LiDAR, structured light). Kept as a utility for Phase 16.

---

## 2026-04-08 — Phase 9: Direct Inference + Camera Math

### What shipped
- Zero123++ running natively via diffusers (no ComfyUI, no HTTP overhead).
- All ComfyUI dependencies removed.
- Visual hull carving with proper perspective projection using Zero123++ camera matrices: `Rx(-el) @ Ry(az)` convention.
- SVG silhouette rasterization via vtracer (sharper masks than bitmap erosion).
- Alpha mask cleanup to remove shadow artifacts.
- Photo-consistency refinement (RGB-based concavity carving) — currently disabled due to Zero123++ lighting variance between views. Re-enable when per-view color normalization lands (Phase 16).
- Oriented point cloud + Open3D Poisson surface reconstruction.
- Vertex color projection from views.
- 35 camera convention unit tests confirming Rx(-el) @ Ry(az) produces correct orientations for all 6 Zero123++ views.

### Key decisions
- RECON_MODE env var (was: `"tsdf"` vs `"carve"`) removed. Always uses the reconstruct.py pipeline now.
- Zero123++ v1.2 selected over v1.1: v1.1 has depth ControlNet support but requires ~5.7GB total VRAM. v1.2 runs in ~3GB FP16, fits comfortably on 8GB cards. Config flag for v1.1+depth ControlNet added to Phase 16 scope.

---

## 2026-04-06 — Phase 8: Replaced ComfyUI

### What shipped
- Direct diffusers pipeline for Zero123++ replacing ComfyUI orchestration.
- Removed all ComfyUI workflow JSON, node definitions, API polling.
- VRAM management: `PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128` set before torch import to prevent fragmentation OOM on 8GB cards.
- `unload_depth()` / model teardown hooks so models free VRAM between pipeline stages.

---

## 2026-04-04 — Phases 5–7: Core Pipeline Stages

### What shipped
- **Phase 5 (Prospect)**: SDXL via diffusers, Juggernaut XL checkpoint, lock mechanism, asset type picker, style reference.
- **Phase 6 (Smelt)**: Zero123++ 6-view generation, view grid with per-view approve/reject, lock to Forge.
- **Phase 7 (Forge UI)**: Mesh pipeline step tracker, SSE streaming, MeshViewer (Three.js GLB), export format picker, Open Folder / Export Save buttons.

### Architecture decisions
- SSE streaming for all long-running jobs. Frontend never polls — backend pushes `step`, `progress`, `done`, `error` events via EventSource.
- Job IDs are stable UUIDs tied to output directories. Output persists on disk regardless of in-memory job registry state. (State persistence via localStorage is Phase 14.)
- Single `~/interforge-projects/{job_id}/` output root with subdirectories per stage (`prospect/`, `smelt/`, `forge/`).

---

## 2026-04-01 — Phases 1–4: Foundation

### What shipped
- **Phase 1**: Product rules locked — Anvil concept, TinkerMode (later removed), Projects layer.
- **Phase 2**: Vertical stage rail, header bar, asset tray, PipelineContext, stage routing. Replaced horizontal tab bar.
- **Phase 3**: `InterForgeProject` schema, disk layout (`~/interforge-projects/`), Projects CRUD, ProjectsContext, bento grid.
- **Phase 4**: Cinematic onboarding walkthrough, step visuals, reopenable from settings.

### Stack decisions
- Tauri 2 (not Electron): native system APIs, ~10MB binary vs 150MB+, proper file system access.
- FastAPI backend on port 7842: spawned by Tauri shell plugin at app launch, hot-reloads during development.
- Three.js for GLB preview in MeshViewer: runs in a canvas inside the Tauri WebView, no native 3D dep needed.

---

## Architectural principles that emerged

**Pipeline is append-only.** Each stage locks its output into PipelineContext. Downstream stages read from context. No stage modifies upstream data.

**One ground truth.** The Prospect image is the user's input — the only real image in the pipeline. Everything else (6 views, depth estimates on those views, reconstructed mesh) is derived. Algorithms that weight the front view more heavily are correct. Algorithms that treat AI-generated views as independent ground truth are wrong.

**Delegate to Python.** Complex numerical work (reconstruction, depth, normals, SDF) lives in Python where numpy/scipy/Open3D/trimesh are available. React is for UI only. FastAPI is for thin API routing. Workers are for job orchestration.

**No over-engineering.** No feature flags, no backwards-compat shims, no helpers for one-time operations. The right amount of complexity is exactly what the current task requires.
