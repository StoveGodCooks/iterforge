"""
POST /api/forge  →  start the full 8-step mesh pipeline

Accepts smelt_job_id (single Zero123++ job) + pipeline settings.
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
    # Source: single smelt job ID (all 6 views come from one Zero123++ pass)
    smelt_job_id: str | None = None
    prospect_job_id: str | None = None
    image_index: int = 0
    tinker_mode: bool = False

    # Pipeline settings
    reconstruction_path: str = "auto"       # "organic" | "hard_surface" | "auto"
    export_format: str = "glb"              # "glb" | "fbx" | "obj"
    target_poly_count: int = 5000
    resume_from_step: int = 0              # checkpoint resume (0 = fresh run)


@router.post("/api/forge")
async def start_forge(req: ForgeRequest):
    """
    Start the Forge mesh pipeline.
    Returns job_id immediately — subscribe to SSE stream for progress.
    """
    has_smelt_inputs = bool((req.smelt_job_id or "").strip())
    has_tinker_prospect = req.tinker_mode and bool((req.prospect_job_id or "").strip())

    if not has_smelt_inputs and not has_tinker_prospect:
        raise HTTPException(
            status_code=422,
            detail="Complete Smelting before running Forge, or enable Tinker Mode and lock a Prospecting image first.",
        )

    job = create_job("forge")

    async def _worker(j):
        await run_forge(j, req.model_dump())

    asyncio.create_task(run_job(job, _worker))

    return {"job_id": job.id, "status": job.status}
