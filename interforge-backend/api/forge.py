"""
POST /api/forge  →  start the mesh pipeline (Stable Fast 3D)

Accepts a locked prospect_job_id (single image → SF3D) + pipeline settings.
Returns job_id immediately. Frontend subscribes to
/api/jobs/{job_id}/stream for SSE progress.

SSE events:
  step_active  — a step just started
  step_done    — a step completed
  mesh_ready   — final export file is available
  done         — entire pipeline finished
  error        — fatal failure
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.job_manager import create_job, run_job
from workers.forge_worker import run_forge

router = APIRouter()


class ForgeRequest(BaseModel):
    # Source: locked prospect image → Stable Fast 3D. smelt_job_id kept for the
    # 2D "none" route (copies smelt frames through); optional otherwise.
    prospect_job_id: str | None = None
    image_index: int = 0
    smelt_job_id: str | None = None
    tinker_mode: bool = False

    # Pipeline settings
    reconstruction_path: str = "auto"       # "auto"/anything → SF3D; "none" → 2D skip
    export_format: str = "glb"              # "glb" | "fbx" | "obj"
    target_poly_count: int = 15000
    resume_from_step: int = 0              # checkpoint resume (0 = fresh run)


@router.post("/api/forge")
async def start_forge(req: ForgeRequest):
    """
    Start the Forge mesh pipeline.
    Returns job_id immediately — subscribe to SSE stream for progress.
    """
    has_prospect     = bool((req.prospect_job_id or "").strip())
    has_smelt_inputs = bool((req.smelt_job_id or "").strip())

    if not has_prospect and not has_smelt_inputs:
        raise HTTPException(
            status_code=422,
            detail="Lock a Prospect image before running Forge — Stable Fast 3D builds the mesh from it.",
        )

    job = create_job("forge")

    async def _worker(j):
        await run_forge(j, req.model_dump())

    asyncio.create_task(run_job(job, _worker))

    return {"job_id": job.id, "status": job.status}
