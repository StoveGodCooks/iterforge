"""
Async job manager.

Each pipeline run (prospect / smelt / forge) is a Job.
Jobs are stored in memory keyed by job_id.
The frontend polls /api/jobs/{job_id} or subscribes to
/api/jobs/{job_id}/stream for live SSE updates.

Checkpoint logic:
- Each job tracks the last completed step index.
- On resume, the job restarts from (last_step + 1).
- On critical failure the job status becomes "failed" with an error code
  so the frontend can show ERROR_<STAGE>_<CODE> and offer a retry.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Callable, Coroutine


class JobStatus(str, Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    DONE      = "done"
    FAILED    = "failed"
    CANCELLED = "cancelled"


@dataclass
class Job:
    id: str
    stage: str                          # "prospect" | "smelt" | "forge"
    status: JobStatus = JobStatus.PENDING
    last_step: int = -1                 # last successfully completed step index
    result: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None
    created_at: float = field(default_factory=time.time)
    _subscribers: list[asyncio.Queue] = field(default_factory=list, repr=False)
    _event_log: list[str] = field(default_factory=list, repr=False)

    async def push(self, event: str) -> None:
        """Push a raw SSE string to all active subscriber queues and buffer for late joiners."""
        self._event_log.append(event)
        for q in self._subscribers:
            await q.put(event)

    def _subscribe(self) -> asyncio.Queue:
        """Create a new subscriber queue, replay buffered events, and register it."""
        q: asyncio.Queue = asyncio.Queue()
        # Replay any events that were pushed before this subscriber connected
        for event in self._event_log:
            q.put_nowait(event)
        self._subscribers.append(q)
        return q

    def _unsubscribe(self, q: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    async def stream(self) -> AsyncIterator[str]:
        """
        Async generator consumed by the SSE endpoint.
        Each caller gets its own queue so multiple subscribers
        can connect without starving each other. Late joiners
        receive a replay of all buffered events.
        """
        q = self._subscribe()
        try:
            while True:
                event = await q.get()
                yield event
                q.task_done()
                if self.status in (JobStatus.DONE, JobStatus.FAILED, JobStatus.CANCELLED):
                    # Drain any events that were queued before we checked status.
                    while not q.empty():
                        try:
                            remaining = q.get_nowait()
                            yield remaining
                            q.task_done()
                        except Exception:
                            break
                    break
        finally:
            self._unsubscribe(q)

    def checkpoint(self, step: int) -> None:
        """Mark a step as completed so we can resume from here on retry.
        Only advances forward — never goes backwards."""
        if step > self.last_step:
            self.last_step = step


# ── Global registry ──────────────────────────────────────────

_jobs: dict[str, Job] = {}

# Cap the in-memory registry so a long-running desktop session doesn't leak
# every job it ever ran. Only terminal jobs are evicted (oldest first).
MAX_JOBS = 100
_TERMINAL_STATUSES = {JobStatus.DONE, JobStatus.FAILED, JobStatus.CANCELLED}


def _evict_old_jobs() -> None:
    """Drop the oldest terminal jobs once the registry exceeds MAX_JOBS.
    Running/pending jobs are never evicted."""
    if len(_jobs) <= MAX_JOBS:
        return
    terminal = sorted(
        (j for j in _jobs.values() if j.status in _TERMINAL_STATUSES),
        key=lambda j: j.created_at,
    )
    for job in terminal:
        if len(_jobs) <= MAX_JOBS:
            break
        _jobs.pop(job.id, None)

# GPU lock — only one GPU job at a time.
# Prevents concurrent model access on the ForgeEngine/SF3DEngine singletons.
_gpu_lock: asyncio.Lock | None = None


def _get_gpu_lock() -> asyncio.Lock:
    """Lazy-init the GPU lock (must be created inside a running event loop)."""
    global _gpu_lock
    if _gpu_lock is None:
        _gpu_lock = asyncio.Lock()
    return _gpu_lock


def create_job(stage: str) -> Job:
    job = Job(id=str(uuid.uuid4()), stage=stage)
    _jobs[job.id] = job
    _evict_old_jobs()
    return job


def get_job(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def list_jobs(stage: str | None = None) -> list[Job]:
    jobs = list(_jobs.values())
    if stage:
        jobs = [j for j in jobs if j.stage == stage]
    return jobs


async def run_job(
    job: Job,
    worker: Callable[[Job], Coroutine[Any, Any, None]],
    *,
    gpu: bool = True,
) -> None:
    """
    Execute a worker coroutine for a job, handling status transitions.

    If gpu=True (default), acquires the GPU lock so only one GPU job
    runs at a time.  The worker is responsible for pushing SSE events
    and calling job.checkpoint() after each step.
    """
    lock = _get_gpu_lock() if gpu else None

    async def _run():
        job.status = JobStatus.RUNNING
        try:
            await worker(job)
            if job.status == JobStatus.RUNNING:
                job.status = JobStatus.DONE
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger("job_manager").error(
                f"[job:{job.id}] {job.stage} failed: {exc}", exc_info=True,
            )
            job.status = JobStatus.FAILED
            job.error_message = str(exc)
            if not job.error_code:
                job.error_code = f"ERROR_{job.stage.upper()}_UNKNOWN"
            # Push error event so SSE subscribers get notified
            from core.sse import error_event
            await job.push(error_event(job.error_code, str(exc)))

    if lock is not None:
        async with lock:
            await _run()
    else:
        await _run()


# Strong references to in-flight job tasks. asyncio only keeps a weak reference
# to the tasks it schedules, so without this a job can be garbage-collected
# mid-run. We discard each task from the set when it completes.
_background_tasks: set[asyncio.Task] = set()


def spawn_job(
    job: Job,
    worker: Callable[[Job], Coroutine[Any, Any, None]],
    *,
    gpu: bool = True,
) -> asyncio.Task:
    """
    Fire off run_job() as a background task with a retained strong reference.
    Use this instead of a bare asyncio.create_task(run_job(...)) so the task
    isn't GC'd while running. Pass gpu=False for non-GPU work (e.g. setup)
    so it doesn't serialize behind the GPU lock.
    """
    task = asyncio.create_task(run_job(job, worker, gpu=gpu))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task
