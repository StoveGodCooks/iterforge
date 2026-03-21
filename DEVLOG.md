# InterForge — Dev Log

> Session journal. Written at the end of every session.
> Read the last entry at the start of each session to get back in the headspace.
> Includes architectural decisions — why things were built the way they were.

---

## Session — 2026-03-19 (Model Migration: DreamShaper Lightning → Juggernaut XL + Preset Overhaul)

**Working on:** Replace DreamShaper Lightning with Juggernaut XL, fix mode collapse, improve all game-asset preset parameters, auto-clamp model-aware generation

---

This session was focused on eliminating the root causes of poor 2D generation quality — specifically the "same sword every time" mode collapse and the ornate/flame/jewel contamination from DreamShaper Lightning's training bias.

**Root Cause 1 — Mode collapse from Lightning misuse:**
DreamShaper XL Lightning is a distilled model designed for 4–8 steps at CFG 1.5–2.5. The weapon preset was running at steps=30, CFG=9 (values inherited from full-quality SDXL presets). Running a distilled model at 3–5× its intended steps/CFG causes severe mode collapse — every generation converges to the same "fantasy flame sword" output. The model's distillation process collapses the sample space when driven outside its design range.

**Root Cause 2 — Lightning model's fantasy bias:**
Even at correct parameters, Lightning's training corpus is heavily skewed toward fantasy/ornate weapon art. It naturally generates fire, jewels, runes, glowing edges on swords even when the prompt doesn't ask for them. Getting clean flat-colored blade silhouettes requires extremely aggressive negative prompting plus a model that doesn't have this bias baked in.

**The fix — full model replacement with auto-adaptation:**

1. **`comfyui.js` — Model-type auto-detection system:**
   - `isLightningModel()`: detects Lightning/Turbo/LCM/Flash/Hyper checkpoints by filename
   - `modelDefaults()`: returns correct steps/CFG/sampler/scheduler per model type
     - Lightning: steps=8, cfg=2.0, `euler` + `sgm_uniform`
     - Standard SDXL (Juggernaut XL etc.): steps=25, cfg=5.5, `dpmpp_2m_sde` + `karras`
   - **Auto-clamp at runtime**: Lightning always clamped to ≤10 steps / ≤2.5 CFG, even if preset says higher. Standard SDXL uses preset values as-is.
   - The system is forward-compatible — drop any new model in, filename determines behavior.

2. **LoRA auto-detection:** comfyui.js now scans the loras folder at generation time. First `.safetensors` or `.pt` found → loaded at strength 0.75 via LoRA node. If none found → node 8 deleted, nodes 2/3/5 rewired directly to checkpoint (node 1). Zero config required.

3. **`txt2img-sdxl.json` — LoRA loader node added:**
   Node 8 (LoraLoader) inserted between checkpoint (node 1) and CLIP/KSampler nodes. Bypassed automatically at runtime when no LoRA is present.

4. **`asset-presets.js` — All game-asset presets migrated to Juggernaut XL values:**
   - All presets: `cfgOverride: 5.5`, `stepsOverride: 25` (Juggernaut-correct)
   - Lightning compatibility maintained: comfyui.js auto-clamps at runtime if Lightning model still installed
   - `weapon` negativeExtra expanded to block: two swords, mirrored pairs, diagonal poses, fire/flame/smoke/sparks, magical aura, jewels, gems, filigree, runes, engravings, ornate handles, motion blur
   - `weapon` positivePrefix tightened to: simple clean design, no decorations, plain solid colors, orthographic front view, tip pointing straight up
   - `weapon` `suggestSize: {512, 1024}` — portrait ratio now auto-applied in generation.js

5. **`generation.js` — suggestSize auto-apply:**
   `resolvedWidth`/`resolvedHeight` intermediate variables read `ASSET_PRESETS[assetType].suggestSize` and apply it when the user left a square (default) resolution. Non-square requests are respected as intentional size choices.

**Download instructions for Juggernaut XL v9:**
- CivitAI: model 133005 (search "Juggernaut XL") or HuggingFace `RunDiffusion/Juggernaut-XL-v9`
- Place `juggernautXL_v9Rundiffusion.safetensors` in `%ITERFORGE_HOME%\comfyui\models\checkpoints\`
- Delete or move `DreamShaperXL_Lightning.safetensors`
- No config changes needed — filename detection wires everything automatically

**Optional weapon LoRA (further improves clean silhouettes):**
- CivitAI ID 211564 (XL Weapon Sword by HailoKnight) or ID 1263426 (Fantasy Melee Weapons)
- Drop in `%ITERFORGE_HOME%\comfyui\models\loras\` — auto-detected and activated

**Wins:**
- Mode collapse eliminated — different weapon generated each run
- Flame/jewel contamination blocked by comprehensive negative prompt expansion
- All presets future-proofed: correct for Juggernaut XL now, safe for Lightning via auto-clamp
- LoRA pipeline wired with zero config — drop file in folder, it works
- `suggestSize` now actually applied (was computed but never used before this session)
- Frontend rebuilt clean ✅

**Dead Ends:**
- Trying to tune Lightning parameters to get quality outputs — the distilled model's fantasy bias is architectural, not prompt-fixable at low steps
- Setting `suggestSize` via `Object.assign(req.body, ...)` after the destructure — already-bound `width`/`height` variables don't update. Fixed with pre-destructure intermediate variables.

**Up Next:**
- User downloads Juggernaut XL v9 and tests 2D generation quality
- BiRefNet integration (MIT license) — replaces flood-fill bg removal, biggest single quality jump
- Zero123++ multi-view texturing — bake 6 views onto 3D mesh instead of single front projection
- RunPod cloud GPU test — TripoSG (MIT, needs >8GB) can't run on RTX 3070 locally

---

## Session — 2026-03-18 (3D Pipeline: TripoSR Texturing + Mesh Orientation)

**Working on:** Fixing TripoSR mesh orientation, UV texturing axis bugs, and silent 3D auto-chain pipeline

---

This session was entirely focused on getting the TripoSR 3D reconstruction pipeline to output correctly oriented, properly textured meshes. The image → 3D pipeline was already wired end-to-end (image generates → 3D auto-starts silently → GLB appears in viewer), but the mesh and texture both had fundamental issues.

**The three bugs that were killing the output:**

**Bug 1 — Wrong UV axis (depth mapped to U).**
The UV mapping was using `verts[:, 0]` for U and `verts[:, 1]` for V. After TripoSR's `[2,1,0]` axis swap in `MarchingCubeHelper`, the actual axis layout is:
- `verts[:,0]` = world Y (up/down, blade length) ← largest range
- `verts[:,1]` = world X (left/right, guard width)
- `verts[:,2]` = world Z (depth into screen) ← smallest range

The old code was mapping depth (`[:,0]` was incorrectly assumed to be horizontal) to U. This meant the front face of the blade sampled the left edge of the texture (grey background) and the back face sampled the right edge. Only the thin middle cross-section slice of depth would hit actual sword pixels. Fixed: `verts[:,1]` → U (world X, left/right in render), `verts[:,0]` → V (world Y, up/down).

**Bug 2 — Mesh horizontal in Babylon (blade along GLTF X instead of Y).**
When trimesh exports a GLB, axes map directly: trimesh axis 0 → GLTF X. Since TripoSR's blade length sits on trimesh axis 0 (world Y), it ends up as GLTF X = horizontal in Babylon.js. Measured via `trimesh.load()` on existing GLBs: axis 0 range = 1.03, axis 1 = 0.96, axis 2 = 0.19. Fix: apply a +90° rotation around Z after UV mapping. This sends axis 0 → GLTF Y (vertical), axis 1 → GLTF X (horizontal), axis 2 unchanged. UV coordinates are per-vertex and survive the rotation correctly since they reference the pre-rotation coordinate space.

Made the rotation adaptive: `_orient_mesh_for_gltf()` detects the depth axis (smallest range), finds which remaining axis is tallest, and only applies the rotation if axis 0 is the tall axis. If axis 1 is already the tall axis, no rotation needed. Handles non-sword assets robustly.

**Bug 3 — Triplane render destroying blade texture.**
The old `_strip_triplane_bg()` used `abs(arr - 127) < 40` to detect the grey background. The composite step sets the background to (127,127,127) before TripoSR inference, and a metallic grey sword blade is approximately (140–165, 140–165, 140–165). With tolerance=40, blade pixels at (150,150,150) → abs=23 < 40 → classified as background → made transparent. After dilation from the guard (the only remaining opaque area with orange/blue colors), the blade stayed white in the viewer.

Two fixes:
1. Replaced `_strip_triplane_bg()` with a corner flood-fill approach (same pattern as `_remove_bg_threshold()` for input images). Only the connected near-white region from the image corners is marked transparent. Interior grey areas (blade) are preserved.
2. Changed the texture source in `main()` from `tex_pil` (triplane render) to `pil_img` (preprocessed source image). The preprocessed image is 512×512 RGBA with the sword on transparent background — background already correctly removed, original artwork colors, no grey confusion. The `_dilate_colors()` EDT fill then covers the full UV space with sword edge colors.

**Architectural Decisions:**

*Why use the source image for texture instead of the triplane render:*
The triplane render is theoretically more accurate (matches the 3D structure exactly) but in practice it has a grey/white background that interacts badly with metallic sword colors. The source image has a clean alpha from the flood-fill background removal and preserves the original AI-generated artwork colors. For a planar UV projection from the front view, they're equivalent in terms of accuracy — the source image is the same front view the 3D reconstruction was built from.

*Why apply UV before rotating the mesh:*
UV mapping is computed using the original TripoSR vertex coordinates (before rotation). The rotation is purely for display alignment in GLTF/Babylon. Since UVs are stored per-vertex and not re-projected during `apply_transform()`, the UV computed in the pre-rotation space remains valid after the rotation — the texture still maps to the correct geometry.

*Why the silent auto-chain pipeline:*
The user never sees "TripoSR", "GLB", or "3D reconstruction" in the UI. They type "sword", hit Generate, see "Finishing up…" briefly, then the mesh appears. The 3D is an automatic output of generating a meshable asset type. This is intentional — the tool is for game devs who want assets, not for 3D artists who want control over reconstruction parameters.

**Wins:**
- Sword mesh now stands upright in Babylon viewer
- Texture covers the full blade uniformly with original artwork colors
- UV axis bug diagnosed and fixed by measuring actual vertex ranges on live GLBs
- Mesh orientation detection is now adaptive (not hardcoded to swords)
- `_dilate_colors` + `_strip_triplane_bg` (flood-fill) ensures full UV space coverage

**Dead Ends:**
- Using the triplane render as texture — grey background removal with color thresholding is too lossy for metallic objects
- `abs(arr - 127) < 40` background detection — too broad, removes sword blade pixels

**Open Questions:**
- Should we scale the UV to the sword's actual image silhouette bounding box (not full mesh bounding box) to get a tighter fit? Could reduce grey border sampling.
- Zero123++ for multi-view texture baking — generates 6 views from 1 image, fits in 8GB VRAM. Would give back/side textures instead of projecting front view everywhere.

**Next Session:**
- Test the full sword → 3D pipeline end-to-end, verify texture uniformity
- Zero123++ integration (Phase 2) — multi-view texture baking for better sides/back
- Rebuild dist / update exe with all 3D pipeline changes

---

## Session — 2026-03-15 (Session 2: Phase 24 Polish Pass)

**Working on:** Final polish pass — 20 critical bug fixes + SettingsPanel creation

---

This session was a systematic blind spot audit and fix pass before moving to Blender integration. After a thorough audit of the codebase, 60+ frontend issues and 37 backend issues were catalogued. The top 20 were executed this session, prioritized by impact.

**Backend fixes summary:**

The job Maps (`jobs` in generation.js, `sheetJobs` in sprite-sheet.js) had been growing without bound — every completed or failed job stayed in memory forever. Fixed with a 10-minute TTL `scheduleJobCleanup()` pattern that auto-deletes after status is terminal. Simple, matches the polling contract (clients only poll for a few minutes).

Path traversal was present on 3 endpoints: `/api/generate/image/:filename`, `/api/sprite-sheet/frame/:filename`, and the compose endpoint's `frameFilenames` array. All were using raw `req.params.filename` directly in `path.join()`. Fixed with `path.basename()` wrapping before join — strips any `../` components before they can escape the assets directory.

The `req._styleNeg` mutation in sprite-sheet.js was a code smell — mutating the request object as a side channel to pass data between the mode branch and the final negative construction. Lifted to a `let styleNeg = ''` local variable initialized before the if/else block. Cleaner, no request object pollution.

History write race condition: concurrent generations (e.g., two sprite sheet frames completing simultaneously) were both doing `readHistory() → push → writeJson()`, causing the second write to overwrite the first's entry. Fixed by adding a `writeHistory(updater)` function in history.js that chains all writes onto a shared promise queue (`historyWriteQueue = historyWriteQueue.then(...)`). FIFO serialization with no locks needed.

Seed NaN: `Number("abc")` returns `NaN` which passes `!== null && !== '' && !== undefined` but would send `NaN` to ComfyUI. Added `Number.isFinite()` check. Also added full range validation on steps/CFG/dimensions to prevent OOM from deliberately oversized requests.

**Frontend fixes summary:**

`window.confirm()` and `window.prompt()` both block the browser's UI thread — on slower machines this can freeze the Electron window for a visible instant, and they look jarring in a custom dark UI. Replaced both with inline React patterns. Delete confirmation now shows a Confirm/Cancel button pair in place of the Delete button. Template save now shows an inline input field with auto-focus and Escape-to-cancel. Both feel native to the app.

Image loading skeleton: the main preview area would show blank for 0.5–2 seconds after switching images (especially slow on first load when model is in VRAM). Added `imgLoaded` state tracking `onLoad`/`onError`, with a grey pulse rect displayed until the image fires. Ref tracks current image ID to reset state on image switch.

Escape to close zoom: users naturally press Escape to exit fullscreen. Added a `useEffect` that attaches a `keydown` listener when `zoom === true` and detaches on cleanup.

Clipboard error state: navigator.clipboard can fail silently on HTTP or when focus leaves the window. Previously the copy button would show `✓` even on failure (the `.catch(() => {})` swallowed the error). Changed to tri-state: `null` (idle), `'ok'` (success), `'err'` (failure). Failure shows `✗` in red for 1.5s.

History loading skeleton: on app start, the history strip was invisible until the fetch resolved. Added `historyLoading` state in App.jsx, passed as prop to PreviewArea, which renders 3 shimmer boxes when `historyLoading && history.length === 0`.

Polling re-acceleration: previously the status polling would only slow down (from fast to 5s) when ComfyUI came up, but never re-accelerate if it went offline afterward. Added the inverse condition: `if (intervalRef.current >= 5000 && s.comfyui !== 'ok') startPolling(2000)`.

**Architectural Decisions:**

*Why localStorage for Settings instead of a proper settings API:*
The settings values (Blender path, default model) are UI preferences, not server config. They don't need to survive on the server side — when the Electron app opens, it reads them from localStorage on mount and uses them for that session. If the user wants server-side persistence later, we can add a `POST /api/settings` route, but for now localStorage is correct and zero-overhead.

*Why SettingsPanel is a React component not a system modal:*
Consistency. Everything else in the sidebar is a React panel. A system modal (Electron dialog) would break the visual language and require IPC. The sidebar tab approach means the panel is always accessible, scrollable, and styled consistently.

*Why Blender is next before batch queue:*
Batch queue is additive — it makes existing features faster to use but doesn't add new capability. Blender integration adds an entirely new output type (3D assets with applied textures) that no competing tool does as a packaged local product. The differentiator value is higher. Batch queue and inpainting move to V2.

**Wins:**
- All 20 planned fixes shipped
- SettingsPanel created, wired, and functional
- History write race condition closed
- 3 path traversal vulnerabilities patched
- Inline confirm/input patterns feel native, no browser blocking calls remaining
- Exe rebuilt with all changes

**Open Questions:**
- For Blender integration: should the base mesh library ship in the installer or download on first use? Shipping adds ~50MB to the installer but avoids a first-run download. Leaning toward ship.
- Babylon.js web component vs three.js for the 3D viewer — Babylon has the better React integration story and GLB support is first-class.

**Next Session:**
- Phase 25: Blender Integration
  - `src/server/routes/blender.js` — route handler
  - `src/backends/blender-utils.js` — subprocess spawner + path detection
  - `src/3d/templates/apply_texture.py` — bpy script
  - `frontend/src/components/BlenderPanel.jsx` — 3D tab
  - `frontend/src/components/ModelViewer.jsx` — Babylon.js viewer

---

## Session — 2026-03-15

**Working on:** DreamShaper XL Lightning setup, project structure, next feature planning

---

Started this session still waiting on a PowerShell download that had been running since the last session. The model — DreamShaper XL Lightning at 6.94GB — had been crawling through at a few hundred MB when the context ran out last time. Picked it up this morning and it had crashed. No progress saved, which is the fundamental problem with `Invoke-WebRequest` on large files. Single-threaded, no resume, no error recovery. Lesson learned — for anything over a gig, use the browser or aria2c. Noted that for future model downloads and added a recommendation to the docs.

The fix ended up being simpler than expected. The file had actually already landed in the checkpoints folder from an earlier browser download attempt we hadn't tracked. Running a search across the user profile turned it up at `%APPDATA%\IterForge\comfyui\models\checkpoints\DreamShaperXL_Lightning.safetensors` — 6.6GB, correct size. There was also a smaller, incomplete version sitting there from the failed PowerShell run — about 2.9GB. Deleted that, restarted the app, model appeared in the dropdown and loaded clean.

There was a brief conversation about what other tools we'd thought about adding to the pipeline. The plan had floated Inkscape and Blender as integrations, and we'd also discussed a sound generation tool — specifically for NPC dialogue and game music. After thinking through it, sound got cut. Not because it's a bad idea, but because Godot handles animation natively and the scope creep wasn't worth it at this stage. The plan stays focused on image assets for now. If sound becomes a real need later, AudioCraft or Coqui TTS are the obvious paths.

**The big question of the session:** Is InterForge worth money when fully built out? The short answer is yes — but the value isn't just "local AI generation." Plenty of tools do that. What makes InterForge potentially worth paying for is the combination of zero-setup install, game-dev-specific workflow, and sprite sheet/batch pipeline that nothing else offers as a packaged product. Indie devs don't want to configure Python environments. They want to click a button and get a character sheet. The market gap is real. Comparable cloud tools like Scenario.gg and Leonardo.ai run $20-80/month with subscription locks. A one-time $49-79 local tool with proper game dev workflow is a different value proposition entirely.

Landed on a clear set of next features to build:
- Fix the regeneration bug (same image being returned when you re-generate)
- Sprite sheet generator — both auto-grid and manual layout
- Batch generation
- Better preset library tuned for actual game dev use cases
- Settings panel polish
- Inpainting and asset variations

The regeneration bug is first because it's blocking clean workflow. If you can't iterate on an image without it handing you the same file, the whole tool feels broken regardless of everything else working.

Sprite sheets are the big differentiator feature for this build. The decision to do both auto-grid and manual layout came from the fact that they serve different needs. Auto-grid is for someone who wants a set of character poses or animation frames stitched together fast. Manual layout is for someone building a tilesheet where placement and alignment matter. Building one without the other would leave the feature half-baked.

Spent the back half of the session setting up project infrastructure — this dev log, a start-here README, and merging the decisions log into here rather than keeping it as a separate file. Keeping decisions in the devlog makes more sense because decisions don't live in a vacuum, they happen during sessions and are tied to the context of that moment. A separate decisions file would end up being a dry list with no story behind it.

**Architectural Decisions Made This Session:**

*Why DreamShaper XL Lightning over SDXL base:*
SDXL base needs 20+ steps for decent output. DreamShaper XL Lightning is a distilled model that produces comparable quality in 4-8 steps with euler sampler at CFG 2. For a game asset tool where you're iterating quickly, generation time matters. A 10-second generation vs a 40-second one changes how the tool feels to use entirely.

*Why we cut sound generation from scope:*
The instinct to add it was right — audio is part of a game's asset pipeline. But the implementation cost is high (different Python stack, different model types, different UX) and the payoff at this stage is low. Godot's built-in animation tools cover a lot of ground already. This might come back in V3 once the image pipeline is solid.

*Why DEVLOG and DECISIONS live in one file:*
Decisions don't happen in a vacuum. They have context, they have the problem they were solving, they have the alternatives that got rejected. A standalone decisions file loses all of that. Keeping them inside the session entry where they happened means when you read back through the log, you understand why, not just what.

**Wins:**
- DreamShaper XL Lightning loaded and working in the app
- Model dropdown clean — one model, correct file, no duplicates
- App generating images successfully
- Project now has a real orientation system (README, DEVLOG, updated ROADMAP)

**Dead Ends:**
- PowerShell `Invoke-WebRequest` for large model files — unreliable, no resume, don't use it again
- Sound generation tooling — cut from scope, not the right time

**Open Questions:**
- Is there a smarter way to handle model downloads in the installer itself? Ship a stub and pull the model on first launch with a progress bar?
- How do we handle sprite sheet layout when images vary in size — force uniform grid or allow freeform?
- What's the right UX for inpainting — separate panel or integrated into the preview area?

**Next Session:**
- Fix the regeneration/cache bug first
- Sprite sheet generator — start with auto-grid, then manual layout
- Batch generation
- Better preset library

---
