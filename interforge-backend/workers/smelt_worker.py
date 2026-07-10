"""
Smelting pipeline worker — Zero123++ multi-view generation.

Generates 6 geometrically consistent views from a prospect reference image
in a single Zero123++ forward pass.  Same SSE events, same output format,
same job interface.

Features:
  - 6 consistent views in one pass (vs old 4× SDXL img2img)
  - Direct VRAM control (load → generate → unload)
  - try/finally guarantees VRAM cleanup on error
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from core.job_manager import Job, JobStatus
from core.sse import (
    EventType, make_event, progress_event, done_event,
    error_event, log_event,
)


@asynccontextmanager
async def _heartbeat(job: Job, message: str, interval: float = 4.0):
    """
    Emit PROGRESS events every `interval` seconds while a blocking section runs.

    Zero123++ first-run downloads ~3GB and inference takes ~30–60s with zero
    network feedback — without this, the UI appears frozen.  Heartbeat sends
    an elapsed-time progress tick so the frontend knows the job is alive.
    """
    stop = asyncio.Event()

    async def _beat() -> None:
        t0 = time.perf_counter()
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                elapsed = int(time.perf_counter() - t0)
                await job.push(make_event(EventType.PROGRESS, {
                    "pct":     0,
                    "message": f"{message} ({elapsed}s elapsed…)",
                }))

    task = asyncio.create_task(_beat())
    try:
        yield
    finally:
        stop.set()
        try:
            await task
        except Exception:
            pass
from core.postprocess import save_and_process_image, save_and_process_view_luma

from core.config import PROJECTS_ROOT, OUTPUTS_URL
from core.profiler import PipelineProfiler

def _probe_model_cache(local_dir, hf_repo: str, sentinel: str) -> tuple[bool, str]:
    """
    Check whether a model's weights are already cached locally or in the HF hub.

    Returns (cached, human_message). ``cached=True`` means a cold load should
    skip the download and be fast; ``cached=False`` means the user is about
    to pay a large download on first run — the worker should surface that
    up-front so a slow 'GENERATING...' state isn't mistaken for a hang.
    """
    import os
    from pathlib import Path as _P

    local_path = _P(local_dir)
    if (local_path / sentinel).exists():
        return True, f"cached locally at {local_path}"

    hf_home = os.environ.get("HF_HOME") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    candidates = []
    if hf_home:
        candidates.append(_P(hf_home) / "hub")
    candidates.append(_P.home() / ".cache" / "huggingface" / "hub")

    folder = "models--" + hf_repo.replace("/", "--")
    for base in candidates:
        snaps = base / folder / "snapshots"
        if not snaps.exists():
            continue
        for snap in snaps.iterdir():
            if (snap / sentinel).exists():
                return True, f"cached in HF hub at {snap}"

    return False, f"NOT cached — will download from {hf_repo} on first use"

log = logging.getLogger(__name__)



_CHARACTER_LIKE_TYPES = {"character", "creature"}

# Negative prompt branches too — for objects we hard-ban human anatomy
# because IP-Adapter's visual embedding can leak object-holder cues.
_DIRECTION_NEGATIVE_CHARACTER = (
    "multiple characters, two characters, background, environment, scene, "
    "bad hands, extra limbs, deformed, blurry, floating parts, "
    "drop shadow, ground shadow, duplicate, cloned, cropped"
)

_DIRECTION_NEGATIVE_OBJECT = (
    "person, human, character, creature, hands, arms, fingers, body, figure, "
    "holding, wielding, wielder, hero, warrior, knight, adventurer, "
    "multiple objects, duplicate, cloned, "
    "background, environment, scene, floor, ground, table, pedestal, "
    "drop shadow, ground shadow, deformed, blurry, cropped"
)


def _negative_for(asset_type: str) -> str:
    """Return the negative prompt appropriate to the asset category."""
    if asset_type in _CHARACTER_LIKE_TYPES:
        return _DIRECTION_NEGATIVE_CHARACTER
    return _DIRECTION_NEGATIVE_OBJECT


async def run_smelt_sprite_sheet(job: Job, params: dict) -> None:
    """
    Generate a multi-pose sprite sheet using ControlNet-OpenPose + IP-Adapter.

    For each named pose preset, renders an OpenPose skeleton, feeds that to
    ControlNet to lock the character's stance, and uses IP-Adapter against
    the locked prospect image to preserve identity. One frame per pose is
    saved under smelt/<pose_name>/image_00.png and emitted as VIEW_READY
    so the existing smelting UI can render the results without changes.

    params:
      - prospect_job_id, image_index, prompt, asset_type, art_style
      - poses: list of pose preset names (default: pose_library.default_sprite_sheet())
      - gen_resolution: 512 | 768 (default 512 — sprites downscale anyway)
      - ip_scale: 0.4–0.6 (default 0.55) — identity strength for the anchor frame
      - controlnet_scale: 0.6–0.95 (default 0.85)
      - anchor_consistency: bool (default True) — generate a front frame first,
        then use it (not the concept art) as the identity reference for the rest
      - followup_ip_scale: float (default max(ip_scale, 0.70)) — identity
        strength for non-anchor frames, which reference the locked anchor
    """
    import asyncio as _asyncio

    from core.pose_library import (
        get_preset, default_sprite_sheet, PRESETS_BY_NAME, direction_negative,
    )

    profiler = PipelineProfiler(job_id=job.id, route="SMELT_SPRITE_SHEET")

    prospect_job_id  = params.get("prospect_job_id", "")
    image_index      = int(params.get("image_index", 0))
    asset_type       = params.get("asset_type", "prop")
    art_style        = params.get("art_style", "stylized")
    prompt           = params.get("prompt", "")
    gen_res          = int(params.get("gen_resolution", 512))
    ip_scale         = float(params.get("ip_scale", 0.55))
    controlnet_scale = float(params.get("controlnet_scale", 0.85))
    seed_base        = int(params.get("seed", -1))

    requested = params.get("poses") or list(default_sprite_sheet())
    # Filter unknown names up front with a clear log rather than hard-failing
    # — the UI might send a pose we haven't authored yet.
    pose_names: list[str] = []
    for n in requested:
        if n in PRESETS_BY_NAME:
            pose_names.append(n)
        else:
            await job.push(log_event(f"Skipping unknown pose preset: {n}"))
    if not pose_names:
        job.error_code = "ERROR_SMELT_SPRITE_NO_POSES"
        await job.push(error_event(
            "ERROR_SMELT_SPRITE_NO_POSES",
            "No valid pose presets supplied.",
        ))
        return

    # ── 1. Resolve source image ──────────────────────────────
    await job.push(log_event("Resolving prospect image…"))
    prospect_dir = PROJECTS_ROOT / prospect_job_id / "prospect"
    rgba_path = prospect_dir / f"image_{image_index:02d}_rgba.png"
    raw_path  = prospect_dir / f"image_{image_index:02d}.png"
    if rgba_path.exists():
        source_path = rgba_path
    elif raw_path.exists():
        source_path = raw_path
    else:
        job.error_code = "ERROR_SMELT_SPRITE_SOURCE_NOT_FOUND"
        await job.push(error_event(
            "ERROR_SMELT_SPRITE_SOURCE_NOT_FOUND",
            f"Prospect image not found at {prospect_dir}.",
        ))
        return

    from PIL import Image as PILImage
    with profiler.section("load_source", "Load reference for IP-Adapter"):
        source_img = PILImage.open(str(source_path)).convert("RGBA")
        bg = PILImage.new("RGB", source_img.size, (255, 255, 255))
        bg.paste(source_img, mask=source_img.split()[3])
        reference_rgb = bg.resize((gen_res, gen_res), PILImage.LANCZOS)

    # ── 2. Load engine + IP-Adapter + ControlNet ─────────────
    await job.push(log_event("Loading SDXL engine…"))
    from inference.engine import ForgeEngine
    engine = ForgeEngine.get()

    # Preflights — announce every download up-front so a slow "GENERATING"
    # state on a cold install is obviously a download, not a hang.
    ipa_cached, ipa_msg = _probe_model_cache(
        "", "h94/IP-Adapter", "models/image_encoder/config.json",
    )
    await job.push(log_event(f"IP-Adapter weights: {ipa_msg}"))
    cn_cached, cn_msg = _probe_model_cache(
        "", "xinsir/controlnet-openpose-sdxl-1.0", "config.json",
    )
    await job.push(log_event(f"ControlNet OpenPose weights: {cn_msg}"))

    missing_total = sum(not c for c in (ipa_cached, cn_cached))
    if missing_total:
        await job.push(log_event(
            f"FIRST-RUN sprite-sheet setup: {missing_total} model(s) still "
            "need to download (~2.5–6GB total). Heartbeat below = alive."
        ))

    try:
        async with _heartbeat(job, "Loading SDXL pipeline"):
            with profiler.section("engine_load", "Load SDXL into VRAM"):
                await _asyncio.to_thread(engine.load)
                await _asyncio.to_thread(engine.set_loras, params.get("loras"))
        await job.push(log_event("SDXL loaded — loading IP-Adapter…"))

        async with _heartbeat(job, "Loading IP-Adapter (first run downloads ~4GB)"):
            with profiler.section("ip_adapter_load", "Load IP-Adapter weights"):
                await _asyncio.to_thread(engine.load_ip_adapter)
        await job.push(log_event("IP-Adapter loaded — loading ControlNet OpenPose…"))

        async with _heartbeat(job, "Loading ControlNet OpenPose (~2.5GB on first run)"):
            with profiler.section("controlnet_load", "Load ControlNet OpenPose"):
                await _asyncio.to_thread(engine.load_controlnet_openpose)
        await job.push(log_event("ControlNet OpenPose loaded"))

    except Exception as exc:
        job.error_code = "ERROR_SMELT_SPRITE_ENGINE_LOAD"
        await job.push(error_event(
            "ERROR_SMELT_SPRITE_ENGINE_LOAD",
            f"Failed to load sprite-sheet engine stack: {exc}",
        ))
        return

    # Character vs object framing for the shared prompt tail.
    is_character = asset_type in _CHARACTER_LIKE_TYPES
    consistency_tail = (
        "consistent character design, same outfit, same materials"
        if is_character
        else "same object, same materials, same silhouette, isolated on white background"
    )
    neg_prompt = _negative_for(asset_type)

    # Front poses drift toward a ¾ turn unless we explicitly demand a square
    # frontal view and ban rotation. Applied only to direction == "front" so
    # back/side poses aren't told to face the camera.
    _FRONT_PREFIX = "front view, facing camera directly, fully symmetrical, full body, "
    _FRONT_NEG = ", three-quarter view, profile, side view, turned body, twisting, back view"

    # ── Anchor-frame consistency ─────────────────────────────────
    # Concept art is often a head-shot or ¾ hero pose, so using it as the
    # IP-Adapter reference for every frame yields a different-looking
    # character each time. Instead: generate ONE clean front frame first,
    # then use that full-body frame as the identity reference for the rest,
    # leaning harder on it (higher ip_scale). One orc, many poses.
    use_anchor = bool(params.get("anchor_consistency", True))
    followup_ip_scale = float(params.get("followup_ip_scale", max(ip_scale, 0.70)))

    if use_anchor and len(pose_names) > 1:
        anchor_name = (
            "idle_front" if "idle_front" in pose_names
            else next((n for n in pose_names if get_preset(n).direction == "front"), None)
            or pose_names[0]
        )
        # Generate the anchor first; keep every other pose in requested order.
        ordered = [anchor_name] + [n for n in pose_names if n != anchor_name]
        await job.push(log_event(
            f"Anchor-frame consistency ON — '{anchor_name}' generates first, "
            f"then drives identity for the rest (ip_scale {ip_scale}→{followup_ip_scale})."
        ))
    else:
        anchor_name = None
        ordered = list(pose_names)

    # Reference + scale swap to the anchor after its frame is produced.
    active_reference = reference_rgb
    active_ip_scale = ip_scale

    try:
        for i, pose_name in enumerate(ordered):
            preset = get_preset(pose_name)

            await job.push(log_event(
                f"Generating pose {i+1}/{len(pose_names)}: "
                f"{preset.label} ({preset.direction})"
            ))

            # Render the OpenPose skeleton at target resolution
            with profiler.section(f"pose_render_{pose_name}", f"Render pose {pose_name}"):
                pose_img = await _asyncio.to_thread(preset.render, gen_res)

            # Stitch the pose hint into the prompt so SDXL aligns with the
            # skeleton silhouette even when ControlNet is weak (arms, feet).
            # Front poses also get an explicit square-frontal prefix + negatives.
            if preset.direction == "front":
                pose_prompt = f"{_FRONT_PREFIX}{preset.prompt_hint}, {prompt}, {consistency_tail}"
                frame_neg = neg_prompt + _FRONT_NEG
            else:
                pose_prompt = f"{preset.prompt_hint}, {prompt}, {consistency_tail}"
                frame_neg = neg_prompt
                # S5: back frames must not grow a face; side frames must not snap frontal.
                _dir_neg = direction_negative(preset.direction)
                if _dir_neg:
                    frame_neg = f"{frame_neg}, {_dir_neg}"

            frame_seed = seed_base if seed_base >= 0 else -1

            try:
                async with _heartbeat(job, f"Diffusing {preset.label} ({i+1}/{len(pose_names)})"):
                    with profiler.section(f"gen_{pose_name}", f"ControlNet+IPA — {pose_name}"):
                        pil_img = await _asyncio.to_thread(
                            engine.generate_with_pose_and_reference,
                            active_reference,
                            pose_img,
                            pose_prompt,
                            frame_neg,
                            gen_res,             # width
                            gen_res,             # height
                            22,                  # steps (trimmed for the 8GB offload path)
                            7.5,                 # cfg
                            active_ip_scale,
                            controlnet_scale,
                            frame_seed,
                            "dpmpp_2m",
                        )
            except RuntimeError as gen_exc:
                job.error_code = "ERROR_SMELT_SPRITE_GENERATE"
                await job.push(error_event(
                    "ERROR_SMELT_SPRITE_GENERATE",
                    f"Generation failed on pose '{pose_name}': {gen_exc}",
                ))
                return

            # ── 3. Save + rembg + vtracer ────────────────────
            out_dir = PROJECTS_ROOT / job.id / "smelt" / pose_name
            out_dir.mkdir(parents=True, exist_ok=True)
            raw_out = out_dir / "image_00.png"

            with profiler.section(f"save_{pose_name}", f"Save {pose_name} PNG"):
                pil_img.save(str(raw_out), "PNG")

            # Also save the pose skeleton next to the frame for debugging
            try:
                pose_img.save(str(out_dir / "pose_skeleton.png"), "PNG")
            except Exception:
                pass

            with profiler.section(f"rembg_{pose_name}", f"rembg — {pose_name}"):
                try:
                    raw_bytes = raw_out.read_bytes()
                    processed = await save_and_process_image(
                        raw_png=raw_bytes,
                        out_dir=out_dir,
                        index=0,
                        detail=0.5,
                    )
                except Exception as exc:
                    await job.push(log_event(
                        f"rembg failed for {pose_name} (non-fatal): {exc}"
                    ))
                    processed = {
                        "index": 0,
                        "raw_path": str(raw_out),
                        "rgba_path": None,
                        "svg_path": None,
                        "svg_data": None,
                    }

            rel_raw   = Path(processed["raw_path"]).relative_to(PROJECTS_ROOT)
            image_url = f"{OUTPUTS_URL}/{rel_raw.as_posix()}"
            rgba_url = None
            if processed.get("rgba_path"):
                rel_rgba = Path(processed["rgba_path"]).relative_to(PROJECTS_ROOT)
                rgba_url = f"{OUTPUTS_URL}/{rel_rgba.as_posix()}"

            await job.push(make_event(EventType.VIEW_READY, {
                "view_angle":  pose_name,   # downstream uses view_angle as folder key
                "pose_label":  preset.label,
                "pose_direction": preset.direction,
                "image_url":   image_url,
                "rgba_url":    rgba_url,
                "raw_path":    processed["raw_path"],
                "rgba_path":   processed.get("rgba_path"),
            }))

            # Anchor produced → switch the IP-Adapter reference from the
            # concept art to this clean full-body frame for every later pose.
            if use_anchor and i == 0 and len(ordered) > 1:
                try:
                    rgba_p = processed.get("rgba_path")
                    if rgba_p:
                        a_rgba = PILImage.open(str(rgba_p)).convert("RGBA")
                        a_bg = PILImage.new("RGB", a_rgba.size, (255, 255, 255))
                        a_bg.paste(a_rgba, mask=a_rgba.split()[3])
                        active_reference = a_bg.resize((gen_res, gen_res), PILImage.LANCZOS)
                    else:
                        # rembg failed — fall back to the raw generated frame.
                        active_reference = pil_img.convert("RGB").resize(
                            (gen_res, gen_res), PILImage.LANCZOS)
                    active_ip_scale = followup_ip_scale
                    await job.push(log_event(
                        f"Identity locked from anchor '{pose_name}' — "
                        f"remaining poses reference it at ip_scale {active_ip_scale}."
                    ))
                except Exception as exc:
                    await job.push(log_event(
                        f"Anchor reference build failed (non-fatal): {exc}; "
                        "keeping concept-art reference."
                    ))

    finally:
        # Keep the SDXL + IP-Adapter + ControlNet stack warm between jobs.
        # With 3D gated, nothing else competes for VRAM, so reloading the
        # 6.9GB checkpoint every job is pure waste — free only the transient
        # activation memory and leave the weights resident for the next run.
        import torch as _t
        if _t.cuda.is_available():
            _t.cuda.empty_cache()

    # ── 4. Done ──────────────────────────────────────────────
    _export_profile(profiler, job.id, "sprite_sheet")

    job.result = {
        "mode":             "sprite_sheet",
        "poses":            pose_names,
        "asset_type":       asset_type,
        "art_style":        art_style,
        "prompt":           prompt,
        "engine":           "sdxl_ipa_controlnet_openpose",
        "gen_resolution":   gen_res,
        "ip_scale":         ip_scale,
        "controlnet_scale": controlnet_scale,
    }
    await job.push(done_event(job.result))


# ── One-shot tiled sprite sheet (prompt-driven, no prospect) ──────────
#
# Anti-scale / anti-collage negatives keep the one-shot grid clean — without
# them the model composes a "hero + minions" scene (one giant central figure)
# instead of an equal, sliceable grid.
_TILED_LAYOUT_NEG = (
    "group photo, depth of field, different sizes, giant central figure, "
    "foreground figure, background figures, overlapping figures, collage, "
    "concept art sheet, montage, poster"
)


async def run_smelt_tiled_sheet(job: Job, params: dict) -> None:
    """
    One-shot tiled sprite sheet — prompt-driven, NO prospect/reference needed.

    Lays every requested pose skeleton into a single grid canvas and generates
    the whole sheet in ONE ControlNet pass, so every frame shares identity /
    costume / lighting by construction. The sheet is sliced back into per-pose
    frames (smelt/<pose>/image_00.png) and emitted as VIEW_READY, so the
    existing smelting UI + Forge2D packer consume it unchanged.

    params:
      - prompt: free-text character description (required)
      - asset_type, art_style
      - poses: list of pose preset names (default: default_sprite_sheet())
      - gen_resolution: per-cell px (default 512 — validated recipe)
      - controlnet_scale: 0.7–0.95 (default 0.85)
      - seed: int (default -1 random)
    """
    import asyncio as _asyncio

    from core.pose_library import (
        get_preset, default_sprite_sheet, PRESETS_BY_NAME,
        compose_pose_grid, slice_pose_grid,
    )

    profiler = PipelineProfiler(job_id=job.id, route="SMELT_TILED_SHEET")

    asset_type       = params.get("asset_type", "character")
    art_style        = params.get("art_style", "stylized")
    prompt           = (params.get("prompt") or "").strip()
    cell             = int(params.get("gen_resolution", 512))
    controlnet_scale = float(params.get("controlnet_scale", 0.85))
    seed_base        = int(params.get("seed", -1))

    if not prompt:
        job.error_code = "ERROR_SMELT_TILED_NO_PROMPT"
        await job.push(error_event(
            "ERROR_SMELT_TILED_NO_PROMPT",
            "A prompt is required for the tiled sprite sheet.",
        ))
        return

    requested = params.get("poses") or list(default_sprite_sheet())
    pose_names: list[str] = []
    for n in requested:
        if n in PRESETS_BY_NAME:
            pose_names.append(n)
        else:
            await job.push(log_event(f"Skipping unknown pose preset: {n}"))
    if not pose_names:
        job.error_code = "ERROR_SMELT_TILED_NO_POSES"
        await job.push(error_event(
            "ERROR_SMELT_TILED_NO_POSES", "No valid pose presets supplied.",
        ))
        return

    # ── 1. Chunk poses so we NEVER generate a tall grid ───────
    # A 2×3 / portrait canvas collapses into a "hero + minions" collage that
    # won't slice cleanly. Split into chunks of ≤4 generated as SQUARE 2×2
    # passes (or a short horizontal strip for the remainder), all sharing ONE
    # seed so the character stays consistent across passes.
    import random as _random

    def _pad_to_grid(chunk: list) -> list:
        # Repeat poses to fill a full 2×2 grid (extras are sliced off and
        # discarded). SDXL degrades badly below ~768², and empty cells make it
        # paint a giant central figure — so short chunks are padded, never left
        # blank. One fixed seed keeps the character consistent across cells.
        padded = list(chunk)
        while len(padded) < 4:
            padded.append(chunk[len(padded) % len(chunk)])
        return padded

    chunks = [pose_names[i:i + 4] for i in range(0, len(pose_names), 4)]
    await job.push(log_event(
        f"{len(pose_names)} poses → {len(chunks)} generation pass(es)."))

    # ── 2. Load engine + ControlNet (NO IP-Adapter) ──────────
    await job.push(log_event("Loading SDXL + ControlNet OpenPose…"))
    from inference.engine import ForgeEngine
    engine = ForgeEngine.get()

    cn_cached, cn_msg = _probe_model_cache(
        "", "xinsir/controlnet-openpose-sdxl-1.0", "config.json")
    await job.push(log_event(f"ControlNet OpenPose weights: {cn_msg}"))

    try:
        async with _heartbeat(job, "Loading SDXL pipeline"):
            with profiler.section("engine_load", "Load SDXL into VRAM"):
                await _asyncio.to_thread(engine.load)
                await _asyncio.to_thread(engine.set_loras, params.get("loras"))
        async with _heartbeat(job, "Loading ControlNet OpenPose (~2.5GB on first run)"):
            with profiler.section("controlnet_load", "Load ControlNet OpenPose"):
                await _asyncio.to_thread(engine.load_controlnet_openpose)
        await job.push(log_event("Engine ready"))
    except Exception as exc:
        job.error_code = "ERROR_SMELT_TILED_ENGINE_LOAD"
        await job.push(error_event(
            "ERROR_SMELT_TILED_ENGINE_LOAD", f"Failed to load engine: {exc}",
        ))
        return

    # ── 3. Build the recipe prompt + generate each chunk ─────
    is_character = asset_type in _CHARACTER_LIKE_TYPES
    consistency_tail = (
        "consistent character design, same outfit, same armor, same colors, equal size figures"
        if is_character
        else "same object, same materials, equal size figures, isolated on white background"
    )
    sheet_prompt = (
        f"{prompt}, full body, character reference sheet, "
        f"same character shown in multiple poses, {consistency_tail}, "
        f"front view, clean white background"
    )
    neg_prompt = _negative_for(asset_type) + ", " + _TILED_LAYOUT_NEG
    # ONE fixed seed across all passes → consistent character between chunks.
    seed = seed_base if seed_base >= 0 else _random.randint(0, 2**32 - 1)

    sheet_dir = PROJECTS_ROOT / job.id / "smelt"
    sheet_dir.mkdir(parents=True, exist_ok=True)
    pose_to_frame: dict = {}

    for ci, chunk in enumerate(chunks):
        grid_poses = _pad_to_grid(chunk)
        with profiler.section(f"compose_{ci}", f"Compose pass {ci}"):
            canvas, ccols, crows, _ = compose_pose_grid(grid_poses, cell=cell, cols=2)
        W, H = canvas.size
        await job.push(log_event(
            f"Pass {ci+1}/{len(chunks)} — {len(chunk)} pose(s) in a "
            f"{ccols}×{crows} grid ({W}×{H})…"))
        try:
            async with _heartbeat(job, f"Diffusing pass {ci+1}/{len(chunks)} ({len(chunk)} poses)"):
                with profiler.section(f"gen_{ci}", f"ControlNet pass {ci}"):
                    sheet = await _asyncio.to_thread(
                        engine.generate_with_pose,
                        canvas, sheet_prompt, neg_prompt,
                        W, H, 30, 7.5, controlnet_scale, seed, "dpmpp_2m",
                    )
        except RuntimeError as gen_exc:
            job.error_code = "ERROR_SMELT_TILED_GENERATE"
            await job.push(error_event(
                "ERROR_SMELT_TILED_GENERATE", f"Sheet generation failed: {gen_exc}",
            ))
            return
        try:
            sheet.save(str(sheet_dir / f"_tiled_pass_{ci}.png"), "PNG")
        except Exception:
            pass
        for name, frame in zip(chunk, slice_pose_grid(sheet, len(chunk), cell, ccols)):
            pose_to_frame[name] = frame

    # ── 4. Save per-pose frames + rembg + emit ───────────────
    for pose_name in pose_names:
        frame = pose_to_frame[pose_name]
        preset = get_preset(pose_name)
        out_dir = PROJECTS_ROOT / job.id / "smelt" / pose_name
        out_dir.mkdir(parents=True, exist_ok=True)
        raw_out = out_dir / "image_00.png"
        with profiler.section(f"save_{pose_name}", f"Save {pose_name}"):
            frame.save(str(raw_out), "PNG")

        with profiler.section(f"rembg_{pose_name}", f"rembg — {pose_name}"):
            try:
                processed = await save_and_process_image(
                    raw_png=raw_out.read_bytes(), out_dir=out_dir,
                    index=0, detail=0.5,
                )
            except Exception as exc:
                await job.push(log_event(
                    f"rembg failed for {pose_name} (non-fatal): {exc}"))
                processed = {
                    "index": 0, "raw_path": str(raw_out),
                    "rgba_path": None, "svg_path": None, "svg_data": None,
                }

        rel_raw = Path(processed["raw_path"]).relative_to(PROJECTS_ROOT)
        image_url = f"{OUTPUTS_URL}/{rel_raw.as_posix()}"
        rgba_url = None
        if processed.get("rgba_path"):
            rel_rgba = Path(processed["rgba_path"]).relative_to(PROJECTS_ROOT)
            rgba_url = f"{OUTPUTS_URL}/{rel_rgba.as_posix()}"

        await job.push(make_event(EventType.VIEW_READY, {
            "view_angle":     pose_name,
            "pose_label":     preset.label,
            "pose_direction": preset.direction,
            "image_url":      image_url,
            "rgba_url":       rgba_url,
            "raw_path":       processed["raw_path"],
            "rgba_path":      processed.get("rgba_path"),
        }))

    import torch as _t
    if _t.cuda.is_available():
        _t.cuda.empty_cache()

    _export_profile(profiler, job.id, "tiled_sheet")
    job.result = {
        "mode":             "tiled_sheet",
        "poses":            pose_names,
        "asset_type":       asset_type,
        "art_style":        art_style,
        "prompt":           prompt,
        "engine":           "sdxl_controlnet_openpose_tiled",
        "gen_resolution":   cell,
        "passes":           len(chunks),
        "cell":             cell,
        "controlnet_scale": controlnet_scale,
    }
    await job.push(done_event(job.result))



def _export_profile(profiler: PipelineProfiler, job_id: str, view_angle: str) -> None:
    """Write profile JSON/MD — non-fatal."""
    try:
        out_dir = PROJECTS_ROOT / job_id / "smelt" / view_angle
        out_dir.mkdir(parents=True, exist_ok=True)
        profiler.export(out_dir)
    except Exception:
        pass
