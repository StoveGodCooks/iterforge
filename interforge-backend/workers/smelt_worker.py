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
from pathlib import Path

from core.job_manager import Job, JobStatus
from core.sse import (
    EventType, make_event, progress_event, done_event,
    error_event, log_event,
)
from core.postprocess import save_and_process_image

from core.config import PROJECTS_ROOT, OUTPUTS_URL
from core.profiler import PipelineProfiler
from inference.zero123 import VIEW_ORDER

log = logging.getLogger(__name__)


async def run_smelt_all_views(job: Job, params: dict) -> None:
    """
    Generate ALL 6 views in one shot using Zero123++.

    Loads the Zero123++ engine once, generates 6 views from the prospect
    reference image, unloads the engine, then runs rembg on each view.

    params:
      - prospect_job_id, image_index, prompt, asset_type, art_style
    """
    profiler = PipelineProfiler(job_id=job.id, route="SMELT_ZERO123")

    prospect_job_id = params.get("prospect_job_id", "")
    image_index     = int(params.get("image_index", 0))
    asset_type      = params.get("asset_type", "prop")
    art_style       = params.get("art_style", "stylized")
    prompt          = params.get("prompt", "")

    # ── 1. Resolve source image ──────────────────────────────
    await job.push(log_event("Resolving prospect image…"))

    prospect_dir = PROJECTS_ROOT / prospect_job_id / "prospect"
    rgba_path = prospect_dir / f"image_{image_index:02d}_rgba.png"
    raw_path  = prospect_dir / f"image_{image_index:02d}.png"

    if rgba_path.exists():
        reference_path = rgba_path
    elif raw_path.exists():
        reference_path = raw_path
    else:
        job.error_code = "ERROR_SMELT_SOURCE_NOT_FOUND"
        await job.push(error_event(
            "ERROR_SMELT_SOURCE_NOT_FOUND",
            f"Prospect image not found at {prospect_dir}.",
        ))
        return

    from PIL import Image
    # Pass RGBA as-is — Zero123++'s pipeline.to_rgb_image() converts
    # RGBA → RGB with a neutral gray (127) background, which is what
    # the model was trained on.  Calling .convert("RGB") here would
    # fill transparency with black, confusing the model.
    reference_image = Image.open(str(reference_path))

    # ── 2. Load Zero123++ engine ─────────────────────────────
    await job.push(log_event("Loading Zero123++ engine…"))
    from inference.zero123 import Zero123Engine
    engine = Zero123Engine.get()

    try:
        with profiler.section("engine_load", "Load Zero123++ pipeline into VRAM"):
            await asyncio.to_thread(engine.load)
        await job.push(log_event("Zero123++ engine loaded successfully"))

    except Exception as exc:
        job.error_code = "ERROR_SMELT_ENGINE_LOAD"
        await job.push(error_event(
            "ERROR_SMELT_ENGINE_LOAD",
            f"Failed to load Zero123++ engine: {exc}",
        ))
        return

    try:
        # ── 3. Generate 6 views ──────────────────────────────────
        await job.push(log_event("Generating 6 views with Zero123++…"))

        with profiler.section("generate_views", "Zero123++ multi-view generation"):
            view_images = await asyncio.to_thread(
                engine.generate_views,
                reference_image=reference_image,
            )

        job.checkpoint(0)
        await job.push(log_event(f"Zero123++ generated {len(view_images)} views"))

    except Exception as exc:
        job.error_code = "ERROR_SMELT_GENERATE"
        await job.push(error_event(
            "ERROR_SMELT_GENERATE",
            f"Zero123++ view generation failed: {exc}",
        ))
        return

    finally:
        # ── 4. ALWAYS unload engine ──────────────────────────────
        with profiler.section("engine_unload", "Unload Zero123++ pipeline from VRAM"):
            await asyncio.to_thread(engine.unload)

    # ── 5. Save + rembg each view ────────────────────────────
    await job.push(log_event("Running background removal on all views…"))

    result_views: dict[str, dict] = {}
    rembg_fail_count = 0

    for view_name in VIEW_ORDER:
        pil_img = view_images.get(view_name)
        if pil_img is None:
            continue

        out_dir = PROJECTS_ROOT / job.id / "smelt" / view_name
        out_dir.mkdir(parents=True, exist_ok=True)

        # Save raw
        raw_out = out_dir / "image_00.png"
        with profiler.section(f"save_{view_name}", f"Save raw {view_name} PNG"):
            pil_img.save(str(raw_out), "PNG")

        # rembg
        with profiler.section(f"rembg_{view_name}", f"rembg — {view_name} view"):
            try:
                raw_bytes = raw_out.read_bytes()
                processed = await save_and_process_image(
                    raw_png=raw_bytes,
                    out_dir=out_dir,
                    index=0,
                    detail=0.5,
                )
            except Exception as exc:
                rembg_fail_count += 1
                await job.push(log_event(f"rembg failed for {view_name} (non-fatal): {exc}"))
                processed = {
                    "index": 0,
                    "raw_path": str(raw_out),
                    "rgba_path": None,
                    "svg_path": None,
                    "svg_data": None,
                }

        # Build URLs
        rel_raw = Path(processed["raw_path"]).relative_to(PROJECTS_ROOT)
        image_url = f"{OUTPUTS_URL}/{rel_raw.as_posix()}"
        rgba_url = None
        if processed.get("rgba_path"):
            rel_rgba = Path(processed["rgba_path"]).relative_to(PROJECTS_ROOT)
            rgba_url = f"{OUTPUTS_URL}/{rel_rgba.as_posix()}"

        result_views[view_name] = {
            "view_angle": view_name,
            "image_url":  image_url,
            "rgba_url":   rgba_url,
            "raw_path":   processed["raw_path"],
            "rgba_path":  processed.get("rgba_path"),
        }

        # Emit per-view event so frontend can update progressively
        await job.push(make_event(EventType.VIEW_READY, result_views[view_name]))

    # Fail if too many rembg failures (reconstruction needs masks)
    if rembg_fail_count >= 3:
        job.error_code = "ERROR_SMELT_REMBG_FAILED"
        await job.push(error_event(
            "ERROR_SMELT_REMBG_FAILED",
            f"Background removal failed on {rembg_fail_count}/6 views. "
            "Reconstruction needs at least 4 clean masks.",
        ))
        return

    # ── 6. Export profiler ───────────────────────────────────
    _export_profile(profiler, job.id, "multiview")

    # ── 7. Done ──────────────────────────────────────────────
    job.result = {
        "views":      result_views,
        "asset_type": asset_type,
        "art_style":  art_style,
        "prompt":     prompt,
        "engine":     "zero123",
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
