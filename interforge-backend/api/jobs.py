"""
Job endpoints.

GET  /api/jobs              → list all jobs (optional ?stage= filter)
GET  /api/jobs/{job_id}     → job status snapshot
GET  /api/jobs/{job_id}/stream → SSE stream of live events
DELETE /api/jobs/{job_id}   → cancel a running job
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from core.job_manager import JobStatus, get_job, list_jobs

router = APIRouter()


@router.get("/api/jobs")
def get_jobs(stage: str | None = None):
    jobs = list_jobs(stage)
    return [_job_summary(j) for j in jobs]


@router.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_summary(job)


@router.get("/api/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def _generator():
        async for event in job.stream():
            yield event

    return StreamingResponse(
        _generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # nginx: disable proxy buffering
        },
    )


@router.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == JobStatus.RUNNING:
        job.status = JobStatus.CANCELLED
    return {"cancelled": True, "job_id": job_id}


# ── Helpers ───────────────────────────────────────────────────

def _job_summary(job) -> dict:
    return {
        "id":            job.id,
        "stage":         job.stage,
        "status":        job.status.value if hasattr(job.status, "value") else job.status,
        "last_step":     job.last_step,
        "result":        job.result,
        "error_code":    job.error_code,
        "error_message": job.error_message,
        "created_at":    getattr(job, "created_at", None),
    }
