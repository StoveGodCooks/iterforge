"""
Prospecting pipeline worker — GPU inference via diffusers.

Uses the ForgeEngine to run SDXL text-to-image generation.  Same SSE
events, same output format, same job interface.

Features:
  - Direct VRAM control (load → generate → unload)
  - Real per-step progress callbacks
"""
from __future__ import annotations

import io
from pathlib import Path

from core.job_manager import Job, JobStatus
from core.sse import (
    EventType, make_event, progress_event, done_event, error_event, log_event,
)
from masterforge.asset_configs import get_config
from masterforge.negative_prompts import get_negative
from masterforge.lighting_presets import get_lighting_tokens
from masterforge.style_modifiers import apply_style
from masterforge.prompt_templates import build_templated_prompt

from core.config import PROJECTS_ROOT, OUTPUTS_URL
from core.profiler import PipelineProfiler


async def run_prospect(job: Job, params: dict) -> None:
    """
    Run the prospecting pipeline: SDXL txt2img → save → rembg → vtracer.
    """
    import asyncio

    profiler = PipelineProfiler(job_id=job.id, route="PROSPECT")

    asset_type = params.get("asset_type", "prop")
    art_style  = params.get("art_style",  "stylized")
    cfg_obj    = get_config(asset_type)
    prompt     = params["prompt"]
    seed       = params.get("seed", -1)
    batch_size = params.get("batch_size", cfg_obj.batch_size)

    lighting_preset     = params.get("lighting_preset") or None
    reconstruction_path = cfg_obj.reconstruction
    lighting_tokens     = get_lighting_tokens(lighting_preset, asset_type)

    # Build prompt — template wraps user prompt with isolation + quality cues,
    # then style modifiers layer on top
    base_prompt = build_templated_prompt(prompt, asset_type)
    styled = apply_style(
        base_cfg=cfg_obj.cfg,
        base_steps=cfg_obj.steps,
        base_sampler=cfg_obj.sampler,
        base_scheduler=cfg_obj.scheduler,
        art_style=art_style,
        user_prompt=base_prompt,
    )
    full_prompt = styled["prompt"]
    if lighting_tokens:
        full_prompt = f"{full_prompt}, {lighting_tokens}"

    # Always start with system negatives (BASE + asset-specific) and append
    # the user's text as *extras* — never let the UI string override the
    # shadow/multi-object/reflection guardrails.
    user_extra = (params.get("neg_prompt") or "").strip()
    neg_prompt = get_negative(asset_type, extra=user_extra)

    # Create output dir early so profiler.export() works even on error paths
    out_dir = PROJECTS_ROOT / job.id / "prospect"
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── 1. Load engine ───────────────────────────────────────
    await job.push(log_event("Loading inference engine…"))
    from inference.engine import ForgeEngine
    engine = ForgeEngine.get()

    try:
        with profiler.section("engine_load", "Load SDXL pipeline into VRAM"):
            await asyncio.to_thread(engine.load)

        job.checkpoint(0)

        # ── 2. Generate images ───────────────────────────────────
        await job.push(log_event("Forge ignited — hammering out your concept…"))

        steps = styled["steps"]
        total_steps = steps

        progress_steps = []

        def _on_progress(step, total, preview):
            progress_steps.append((step, total))

        with profiler.section("generate", f"SDXL diffusion sampling ({steps} steps × {batch_size} images)"):
            images = await asyncio.to_thread(
                engine.txt2img,
                prompt=full_prompt,
                negative_prompt=neg_prompt,
                width=cfg_obj.width,
                height=cfg_obj.height,
                steps=steps,
                cfg_scale=styled["cfg"],
                seed=seed,
                batch_size=batch_size,
                scheduler=styled["sampler"],
                on_progress=_on_progress,
            )

        await job.push(progress_event(total_steps, total_steps, "Generation complete"))
        job.checkpoint(1)

        # ── 3. Save raw + rembg + vtracer in one pass ────────────
        # We used to emit image_ready immediately after save, then run rembg
        # as a separate post-step. That meant the gallery showed the RAW
        # image (with shadow / white BG) for ~1-3s before swapping to the
        # cutout — which looked like rembg wasn't running.
        # Now we save raw, run rembg + vtracer, THEN emit image_ready with
        # the rgba_url already populated. The user only ever sees the
        # cleaned cutout.
        await job.push(log_event(f"Saving + cleaning {len(images)} image(s)…"))

        # Unload SDXL before rembg so U2Net doesn't fight it for VRAM.
        with profiler.section("engine_unload", "Unload SDXL pipeline from VRAM"):
            await asyncio.to_thread(engine.unload)

        result_images: list[dict] = []
        from core.postprocess import save_and_process_image

        for i, pil_img in enumerate(images):
            with profiler.section(f"save_img_{i}", f"Save image {i} to disk"):
                raw_path = out_dir / f"image_{i:02d}.png"
                pil_img.save(str(raw_path), "PNG")

            rel_raw   = raw_path.relative_to(PROJECTS_ROOT)
            image_url = f"{OUTPUTS_URL}/{rel_raw.as_posix()}"

            rgba_url: str | None = None
            svg_path: str | None = None
            svg_data: str | None = None

            # rembg + 5px alpha erode + vtracer — blocking per image so
            # the UI update sequence stays linear.
            with profiler.section(f"rembg_img_{i}", f"rembg + vtracer on image {i}"):
                try:
                    raw_bytes = raw_path.read_bytes()
                    processed = await save_and_process_image(
                        raw_png=raw_bytes,
                        out_dir=out_dir,
                        index=i,
                        detail=0.5,
                    )
                    rel_rgba = Path(processed["rgba_path"]).relative_to(PROJECTS_ROOT)
                    rgba_url = f"{OUTPUTS_URL}/{rel_rgba.as_posix()}"
                    svg_path = processed["svg_path"]
                    svg_data = processed["svg_data"]
                except Exception as exc:
                    await job.push(log_event(
                        f"Background removal on image {i} failed (non-fatal): {exc}"
                    ))

            entry = {
                "index":     i,
                "raw_path":  str(raw_path),
                "image_url": image_url,
                "rgba_url":  rgba_url,
                "svg_path":  svg_path,
                "svg_data":  svg_data,
            }
            result_images.append(entry)

            # Single emission per image — includes rgba_url if rembg
            # succeeded. Frontend gallery will immediately render the
            # cutout instead of the raw shadowed version.
            await job.push(make_event(EventType.IMAGE_READY, {
                "index":     i,
                "raw_path":  str(raw_path),
                "image_url": image_url,
                "rgba_url":  rgba_url,
            }))
            if svg_data is not None:
                await job.push(make_event(EventType.SVG_READY, {
                    "index":    i,
                    "rgba_url": rgba_url,
                    "svg_data": svg_data,
                }))
            job.checkpoint(2 + i)

    finally:
        # Defensive unload in case an exception fired before the inline
        # unload above (e.g. SDXL OOM during sampling).
        try:
            await asyncio.to_thread(engine.unload)
        except Exception:
            pass

    # ── Export profiler ─────────────────────────────────────────
    try:
        md_path, json_path = profiler.export(out_dir)
        await job.push(log_event(f"[PROFILER] {json_path.name} written"))
    except Exception as exc:
        await job.push(log_event(f"[PROFILER] Export failed (non-fatal): {exc}"))

    job.result = {
        "images":              result_images,
        "asset_type":          asset_type,
        "art_style":           art_style,
        "lighting_preset":     lighting_preset,
        "lighting_tokens":     lighting_tokens,
        "reconstruction_path": reconstruction_path,
        "prompt":              prompt,
        "neg_prompt":          neg_prompt,
        "engine":              "direct",  # flag for E2E profiler
    }
    await job.push(done_event(job.result))
