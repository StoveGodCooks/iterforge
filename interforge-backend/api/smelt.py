"""
POST /api/smelt/all-views  ->  start pose / sprite-frame generation.

Two modes, chosen by whether a locked Prospect is supplied:
  - prospect_job_id present -> IDENTITY mode: IP-Adapter (identity from the
      locked character) + ControlNet OpenPose, one frame per pose, with
      anchor-frame consistency. (run_smelt_sprite_sheet)
  - prospect_job_id absent  -> PROMPT-ONLY mode: one tiled 2x2 ControlNet
      pass per 4 poses, prompt-driven. (run_smelt_tiled_sheet)

Returns a job_id immediately. Frontend subscribes to
/api/jobs/{job_id}/stream for SSE progress + VIEW_READY events (one per pose).
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.job_manager import create_job, spawn_job

router = APIRouter()


class LoraSelection(BaseModel):
    file: str          # LoRA id/stem (matches GET /api/loras `id`)
    weight: float = 0.8


class SmeltRequest(BaseModel):
    """Pose-frame generation params."""
    prospect_job_id: str = ""       # locked Prospect -> identity mode (IP-Adapter)
    image_index: int = 0            # which locked image from the prospect batch
    prompt: str
    asset_type: str = "character"
    art_style: str = "stylized"
    poses: list[str] | None = None  # pose preset names (defaults to the sheet)
    gen_resolution: int = 512       # per-frame / per-cell px
    controlnet_scale: float | None = None  # pose lock strength
    ip_scale: float | None = None   # identity strength (identity mode only)
    seed: int = -1                  # -1 = random
    loras: list[LoraSelection] | None = None  # LoRA adapters to apply
    model: str | None = None        # registry model id (GET /api/models); None = default


@router.post("/api/smelt/all-views")
async def start_smelt(req: SmeltRequest):
    """
    Start pose-frame generation. Identity mode if a Prospect is locked,
    else prompt-only. Returns job_id immediately — subscribe to the SSE
    stream for VIEW_READY events (one per pose).
    """
    if not req.prompt.strip():
        raise HTTPException(status_code=422, detail="Prompt cannot be empty.")

    job = create_job("smelt")

    async def _worker(j):
        params = req.model_dump()
        # Strip None-valued optional scales so worker defaults apply.
        for k in ("controlnet_scale", "ip_scale"):
            if params.get(k) is None:
                params.pop(k, None)

        if (params.get("prospect_job_id") or "").strip():
            # Identity mode: pose the locked character (IP-Adapter + ControlNet).
            from workers.smelt_worker import run_smelt_sprite_sheet
            await run_smelt_sprite_sheet(j, params)
        else:
            # Prompt-only mode: one-shot tiled sprite sheet.
            from workers.smelt_worker import run_smelt_tiled_sheet
            await run_smelt_tiled_sheet(j, params)

    spawn_job(job, _worker)

    return {"job_id": job.id, "status": job.status}
