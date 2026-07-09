"""
POST /api/smelt/all-views ->  start Zero123++ multi-view generation

Single call generates all 6 geometrically consistent views from the
locked prospect image.  Returns a job_id immediately.  Frontend
subscribes to /api/jobs/{job_id}/stream for SSE progress and
VIEW_READY events (one per view).
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.job_manager import create_job, run_job

router = APIRouter()


class SmeltRequest(BaseModel):
    """Generate multi-view (3D) or one-shot tiled sprite-sheet (SPRITE) frames."""
    prospect_job_id: str = ""       # 3D only; SPRITE is prompt-driven (no prospect)
    image_index: int = 0            # which image from the prospect batch was locked (3D)
    prompt: str
    asset_type: str = "prop"
    art_style: str = "stylized"
    mode: str = "SPRITE"            # "3D" Zero123++ multi-view | "SPRITE" one-shot tiled sheet
    poses: list[str] | None = None        # pose preset names (SPRITE mode)
    gen_resolution: int = 512       # per-cell px for the tiled sheet (validated recipe)
    controlnet_scale: float | None = None  # ControlNet pose lock strength (SPRITE mode)
    seed: int = -1                  # -1 = random


@router.post("/api/smelt/all-views")
async def start_smelt_all_views(req: SmeltRequest):
    """
    Generate views from a locked prospect image.

    mode="3D"     → Zero123++ single forward pass, 6 geometrically consistent views.
    mode="SPRITE" → SDXL + IP-Adapter + ControlNet-OpenPose, one frame per pose.
    Returns job_id immediately — subscribe to SSE stream for VIEW_READY events.
    """
    if not req.prompt.strip():
        raise HTTPException(status_code=422, detail="Prompt cannot be empty.")
    if req.mode not in ("3D", "SPRITE"):
        raise HTTPException(status_code=422, detail="mode must be '3D' or 'SPRITE'.")
    # 3D (Zero123++) needs a locked prospect reference; SPRITE is prompt-driven.
    if req.mode == "3D" and not req.prospect_job_id.strip():
        raise HTTPException(status_code=422, detail="prospect_job_id is required for 3D mode.")

    job = create_job("smelt")

    async def _worker(j):
        params = req.model_dump()
        # Strip None-valued optional scales so worker defaults apply.
        for k in ("controlnet_scale",):
            if params.get(k) is None:
                params.pop(k, None)
        if params["mode"] == "SPRITE":
            # One-shot tiled sprite sheet — prompt-driven, no prospect needed.
            from workers.smelt_worker import run_smelt_tiled_sheet
            await run_smelt_tiled_sheet(j, params)
        else:
            from workers.smelt_worker import run_smelt_all_views
            await run_smelt_all_views(j, params)

    asyncio.create_task(run_job(job, _worker))

    return {"job_id": job.id, "status": job.status}
