# Phase 15 — Pipeline Overhaul: SF3D meshes + SAM masking + sprite fixes

> **Goal**: usable textured GLBs, and a fixed sprite pipeline.
> **Decision locked**: mesh model = **SF3D** (Stable Fast 3D). License = Stability AI
> Community License — free incl. commercial use under $1M/yr revenue, with attribution.
> **Strategy**: replace the two most fragile backend subsystems (mesh reconstruction,
> masking). Keep the app shell, the sprite pipeline, and the export chain. Build behind a
> feature flag; verify on real assets; delete old code last.

---

## 1. Target architecture

**3D asset flow (new):**
```
Prospect (SDXL txt2img) → SAM mask → SF3D → [decimate → repair → LOD → GLB export]
```
Single-image model, so the Zero123++ 6-view smelt step is bypassed for 3D. The existing
Forge post-chain (`_step_decimate/_step_repair/_step_lod/_step_export`) is unchanged —
SF3D just hands it a `trimesh.Trimesh` (now with a real UV texture, not vertex colors).

**Sprite flow (fixed, not replaced):**
```
Prompt/Prospect → tiled ControlNet sheet (xinsir) → SAM slice → forge2d pack → atlas
```

**One heavy model in VRAM at a time** (8GB 3070): SDXL+ControlNet (~6-7GB) OR SF3D (~6GB),
never both. SAM (~0.3-0.5GB) is small enough to run first and free, or coexist.

---

## 2. What stays / changes / dies

**Stays:** Tauri/React shell, all stages, contexts, Projects, Vision, Anvil, Publish,
FastAPI, `job_manager`, SSE, profiler, Prospect (SDXL txt2img), the tiled sprite worker
(`run_smelt_tiled_sheet`), the Forge post-chain (decimate/repair/LOD/GLB), MeshViewer,
`project.json`.

**Changes:**
- `api/smelt.py` + frontend routing: 3D no longer runs Zero123++. 3D skips Smelt → Forge
  generates the mesh from the locked prospect image via SF3D. "Smelting" becomes the
  sprite-sheet stage.
- Masking: prospect + sprite masking route through a new SAM service instead of
  rembg/luma/erode.
- `engine.py` `load_controlnet_openpose`: `thibaud/...` → `xinsir/controlnet-openpose-sdxl-1.0`.
- Setup wizard model list: add SF3D + SAM + xinsir CN; drop Zero123++, DepthAnything,
  IP-Adapter, thibaud CN.

**Dies (deletion pass, LAST — after new path verified):**
- `inference/reconstruct.py` (~1,600 lines: hull, Poisson, depth fusion, cross-view, SVG
  raster, SDF, photo-consistency).
- `inference/depth.py` (DepthAnything V2).
- `inference/zero123.py` (`Zero123Engine`, `CAMERA_POSES`, `VIEW_ORDER`).
- `workers/smelt_worker.py`: `run_smelt_all_views` (Zero123++) and `run_smelt_sprite_sheet`
  (orphaned IP-Adapter path — never wired to an endpoint).
- `engine.py`: `load_ip_adapter`, `generate_with_reference`,
  `generate_with_pose_and_reference`, `img2img` (all IP-Adapter machinery).
- `core/postprocess.py`: `luminance_key`, `clip_floor_shadow`, `save_and_process_view_luma`
  (and the erosion hacks) — superseded by SAM. `trace_to_svg` may stay if the SVG is still
  used for frontend silhouette display.

Net: ~2,500+ lines removed.

---

## 3. New modules

### `inference/sf3d.py` — SF3DEngine (mirror the existing engine singleton pattern)
```python
class SF3DEngine:
    _instance = None
    def __init__(self): self._model = None; self._device = None
    @classmethod
    def get(cls): ...
    @property
    def is_loaded(self): return self._model is not None
    def load(self): ...          # stabilityai/stable-fast-3d, ~6GB, fp16
    def unload(self): ...         # free VRAM (called by the arbiter)
    def generate_mesh(self, image: PIL.Image, target_faces=15000) -> trimesh.Trimesh:
        # SAM-masked RGBA in → textured GLB/trimesh out
```

### `core/segment.py` (or `inference/sam.py`) — SAM masking service
- Model: SAM2 (hiera-small/tiny, ~150-180MB) or MobileSAM (~40MB).
- Automatic mode: box/point prompt from the image center / alpha bbox → clean object mask.
- Interactive mode: point prompt (wires the stubbed Anvil inpaint select later).
- Replaces `remove_background`. **Fixes audit M6** (luma key holes in gray armor) — SAM
  segments the object as a coherent whole, so interior gray pixels stay in the mask.

### VRAM arbiter (small, in `engine.py` or `job_manager.py`) — **fixes audit S8**
Before loading any heavy model, unload the other:
```python
def ensure_only(target):   # target in {"sdxl", "sf3d"}
    if target != "sdxl": ForgeEngine.get().unload()
    if target != "sf3d": SF3DEngine.get().unload()
```

---

## 4. Sprite pipeline fixes (independent — shippable immediately)

These do NOT depend on SF3D/SAM and can land first.

- **S2** `engine.py:584` — swap `thibaud` → `xinsir/controlnet-openpose-sdxl-1.0`.
  Biggest single sprite-quality win (far better pose adherence).
- **S3** `smelt_worker.py` `run_smelt_tiled_sheet` — pad passes to full 2×2 grids (or bump
  small chunks to 768px). SDXL degrades badly below ~768².
- **S5** `pose_library.py:59-65` — fix `_KEYPOINT_COLORS` to the canonical OpenPose 18-color
  table (indices 15-17 are wrong; idx 17 duplicates idx 3). Add `face, eyes, nose` to the
  negative prompt for back poses. Author side-facing pose presets (none exist today).
- **S6** `forge2d_worker.py:158` + `_pack_sprites:287` — letterbox instead of stretch:
  scale by `min(cell/w, cell/h)`, paste centered on transparent square. Stops fat/thin sprites.
- **S7** `forge2d_worker.py` — reorder to clean → trim → resize → outline (outline currently
  applied pre-downscale → soft halo). Drop the double 5px alpha erosion (line ~119).

---

## 5. Phasing (safe cutover)

**15.0 — De-risk spike (GATE — do before any deletion).**
Install SF3D on Windows, run its demo on the 3070, confirm: (a) it builds
(`texture_baker` / `uv_unwrapper` compiled extensions are the risk), (b) actual VRAM ≤ 8GB,
(c) a textured GLB comes out on a real prospect image. Install SAM, confirm a clean mask.
**If SF3D won't build on Windows → fall back to TripoSR (MIT, ~3-4GB, no texture) and re-plan.**

**15.1 — SF3D engine + Forge integration** behind `featureFlags.ts` flag (visual hull stays
default). New `_step_sf3d` in `forge_worker.py`. Add VRAM arbiter. Verify usable GLBs.

**15.2 — SAM masking service.** Route prospect + sprite masking through it behind a flag.
Verify the gray-armor hole fix and clean sprite-figure extraction.

**15.3 — Sprite fixes** (Section 4). Independent — can ship in parallel with 15.0/15.1.

**15.4 — Frontend routing + setup wizard.** 3D skips Smelt → Forge(SF3D); Smelt = sprite
stage. Update `Smelting.tsx`, stage wrappers, `PipelineContext`. Update wizard model list.

**15.5 — Flip the flag** to the new path as default. Regression on ≥3 asset types
(prop, character, creature) — mesh + sprite.

**15.6 — Deletion pass.** Remove dead modules (Section 2). Update DEVLOG.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| SF3D Windows build (compiled deps) | 15.0 gate before commitment; TripoSR fallback |
| VRAM collision (SDXL/SF3D/SAM) | Arbiter enforces one heavy model resident |
| SF3D quality on stylized art | Judge on real assets in 15.0/15.1; reroll; feed clean SAM masks |
| License compliance | Attribution + stay under $1M/yr (Stability Community License) |
| Losing a working fallback mid-migration | Feature flag; delete only in 15.6 |

---

## 7. De-risker results (15.0 — run 2026-07-08)

Environment probe on the target machine (RTX 3070, app-managed Python at
`%APPDATA%\IterForge\python-base`):

| Check | Result |
|---|---|
| GPU / torch / CUDA runtime | ✅ RTX 3070 8GB, torch 2.5.1+cu121, `cuda.is_available()`=True |
| SF3D VRAM fit (~6GB) | ✅ fits 8GB with headroom |
| MSVC C++ build tools | ✅ present (VC dir found; needs a VS dev prompt / vcvars to expose `cl`) |
| **CUDA Toolkit (`nvcc`)** | ❌ **NOT installed** — required to compile SF3D's CUDA extensions |
| Prebuilt PyPI wheels (`texture-baker`, `uv-unwrapper`) | ❌ none — source-only, so they must be compiled |
| SF3D weights (`stabilityai/stable-fast-3d`) | ⚠️ **gated on HuggingFace** — needs the user's HF account to accept the license + `huggingface-cli login` |

**Verdict: RESOLVED — SF3D's native extensions build and import on this machine.** No CUDA
Toolkit needed. The chain of blockers found and fixed:

1. Community wheels — dead end. `texture_baker`/`uv_unwrapper` are NOT in the ComfyUI-3D
   pre-builds repo and NOT on PyPI. Must build from the SF3D repo source.
2. `nvcc` absent — turned out not to matter: `texture_baker/setup.py` falls back to a CPU
   `CppExtension` when `CUDA_HOME` is None; `uv_unwrapper` is C++-only anyway. MSVC suffices.
3. `float.h` missing — the sandbox shell has a stripped PATH (no bare `C:\Windows\System32`),
   so `vcvars64` couldn't run `vswhere`/`findstr` and never added the Windows SDK to INCLUDE.
   Fixed by restoring PATH + pointing INCLUDE/LIB at `Windows Kits\10\...\10.0.26100.0`.
4. `Python.h` / `python311.lib` missing — `python-base` is the **embeddable** Python 3.11.9,
   which ships no dev headers or import lib. Fixed by dropping in the headers+lib from the
   NuGet `python` 3.11.9 package.

**Reproducible recipe (for the setup wizard):**
```
# one-time: add dev headers to the embeddable python-base
curl -sL -o py.zip https://www.nuget.org/api/v2/package/python/3.11.9   # unzip → tools/
copy tools\include\*  %APPDATA%\IterForge\python-base\include\
copy tools\libs\*     %APPDATA%\IterForge\python-base\libs\
# build the two SF3D extensions (from a VS dev env with the SDK on INCLUDE):
call vcvars64.bat  &&  set DISTUTILS_USE_SDK=1
set "INCLUDE=%INCLUDE%;<WindowsKits>\Include\10.0.26100.0\ucrt;...\shared;...\um;...\winrt"
py -3.11 -m pip install .\stable-fast-3d\uv_unwrapper .\stable-fast-3d\texture_baker
```
Result: `Successfully installed texture_baker-0.0.1 uv_unwrapper-0.0.1`, both import with
`torch.cuda.is_available()`=True.

**Changes already made to the machine (de-risker):** added Python 3.11.9 headers+lib to
`python-base`, and pip-installed `uv_unwrapper` + `texture_baker` into it. Both are additive
and reversible.

**Isolation NOT needed — SF3D runs in the shared `python-base` (Path A, proven):**
- The earlier "must isolate" conclusion was wrong. It came from pip's resolver *transitively*
  downgrading numpy/scipy when SF3D deps were installed unconstrained. Installing them under a
  **constraints file** (a `pip freeze` of the current env → add-only) fixes it: the 5 deps
  (`jaxtyping`, `omegaconf`, `open_clip_torch`, `gpytoolbox`, `pynanoinstantmeshes`) install
  cleanly, **numpy 2.4.6 / scipy 1.17.1 / transformers 5.3.0 unchanged, `pip check` clean.**
- `from sf3d.system import SF3D` then **imports successfully** under transformers 5.3.0 +
  numpy 2.4.6 — the transformers-4-vs-5 pin was conservative, not a hard floor.
- Only fix required: a **numpy-2 alias shim** at SF3D entry (`np.Inf/np.NaN/np.float_/...`
  re-added) because `gpytoolbox` still uses removed aliases. ~7 lines.
- **Integration is therefore in-process** — the Forge worker adds the shim + the vendored
  `stable-fast-3d` repo to `sys.path` and calls SF3D directly. No venv, no subprocess, no
  standalone Python, no second torch.

**Setup-wizard provisioning (final recipe):** add Python 3.11.9 headers+lib to `python-base`
(NuGet) → build `uv_unwrapper` + `texture_baker` (vcvars + SDK INCLUDE + DISTUTILS_USE_SDK) →
`pip install -c <freeze> jaxtyping omegaconf open_clip_torch gpytoolbox pynanoinstantmeshes`.

**END-TO-END PASSED (2026-07-08).** SF3D generated a textured GLB from `demo_files/axe.png`
in the shared `python-base`: load 17s, inference 3.1s, **peak VRAM 6.47 GB (fits the 3070)**,
mesh 3751 verts / 5888 faces, `TextureVisuals` + `PBRMaterial` with a 1024² baseColorTexture.

**The four compatibility shims the Forge worker must apply before importing sf3d** (all tiny,
all live in our runner — SF3D source is untouched):
1. numpy-2 aliases: `np.Inf/np.infty/np.NaN/np.NAN/np.float_/np.int_/np.bool8` (gpytoolbox).
2. `transformers.pytorch_utils.find_pruneable_heads_and_indices` re-added (removed in 5.x).
3. `PreTrainedModel.get_head_mask` re-added (moved in 5.x; None-branch only, inference-safe).
4. `texture_baker.TextureBaker.rasterize/interpolate` routed through CPU (our build is CPU-only
   because no CUDA toolkit) then results moved back to GPU.

**VRAM model: GPU-primary, CPU-overflow.** All neural inference (DINOv2 tokenizer, triplane
transformer, mesh/material heads) runs on the GPU (6.47 GB peak). Only the texture-bake
rasterizer overflows to CPU — small and fast (folded into the 3.1s). To move the bake onto the
GPU too, install a CUDA toolkit and rebuild `texture_baker` with its CUDA kernel (optional).

Runner reference: `scratchpad/sf3d_e2e.py`. Working GLB: `scratchpad/sf3d_out/axe.glb`.

---

## 8. 8GB BASELINE — LOCKED (2026-07-08)

Verified end-to-end through the real workers: text prompt → `run_prospect` (Samaritan,
default) → `run_forge` (SF3D route) → textured `asset.glb`. The 8GB tier is the solid floor.

**In place:**
- **Default model = Samaritan 3D Cartoon v4** (`engine.py:_find_checkpoint`) — stylized/matte,
  SF3D-friendly. Realism checkpoints (DreamShaper/Juggernaut) bake shadow+gloss that SF3D
  misreads as geometry; those are now env-override only.
- **SF3D forge route** (`forge_worker.py:_run_sf3d`) — single prospect image → UV-textured GLB,
  with the GPU-primary / CPU-overflow VRAM arbiter (frees SDXL before SF3D, offloads SF3D after).
- **Prompt discipline** (masterforge): stylized modifier (no "semi-realistic"), ¾-view + square
  1024² framing, matte + anti-specular + flat-lighting, scene-leak negatives, negatives trimmed
  under CLIP's 77-token limit.
- SF3D vendored + extensions built + deps installed (§7).

**Known ceilings (by design — these are the higher tiers, NOT 8GB bugs):**
- **Rough back** — SF3D is single-image (cannot take multiple views). Fixed only by a
  multi-view reconstructor (InstantMesh) → **16GB tier**.
- **Complex hero characters** (armor/weapons/thin bits) — SF3D's hard case → better on 16GB tier.
- **Prompt-adherence flakiness** (duplicate figures, pose drift) — SDXL weakness → **FLUX on the
  16GB tier** fixes it. (FLUX does NOT belong on 8GB: gated repo, GGUF+offload incompat, T5>8GB.)

**Tiered plan (installer spec-reader picks by VRAM):**
- 8–12GB: Samaritan (SDXL) + SF3D  ← this baseline, done.
- 16GB: FLUX + InstantMesh (multi-view, fixed backs) — build + validate on Lightning AI 16GB.
- 24GB+: FLUX-dev + Hunyuan3D/TRELLIS.

**Remaining for a clean 8GB release:**
- Dead-code removal: `reconstruct.py`, `depth.py`, `zero123.py`, old forge branches
  (`_run_organic`/`_run_hard_surface`/`_engine_*`/`_step_reconstruct*`), old Zero123 smelt path
  (`run_smelt_all_views`) + orphaned `run_smelt_sprite_sheet`, IP-Adapter methods, luma helpers.
  Note: removing Zero123 also retires the Smelt "3D" mode (3D now goes Prospect→Forge directly),
  which touches `api/smelt.py` + `Smelting.tsx`.
- Setup wizard: download Samaritan + SF3D deps instead of DreamShaper/Zero123.
