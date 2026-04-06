"""
Unit tests — SSE event helpers + Job manager.
No network calls.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.sse import (
    make_event, progress_event, done_event, error_event,
    log_event, step_active_event, step_done_event, EventType,
)
from core.job_manager import Job, JobStatus, create_job, get_job, run_job


# ═══════════════════════════════════════════════════════════════
# SSE event helpers
# ═══════════════════════════════════════════════════════════════

class TestSSEHelpers:

    def _parse(self, raw: str) -> dict:
        """Parse a raw SSE string into the JSON payload."""
        assert raw.startswith("data: "), f"SSE must start with 'data: ', got: {raw!r}"
        assert raw.endswith("\n\n"), f"SSE must end with '\\n\\n', got: {raw!r}"
        return json.loads(raw[len("data: "):-2])

    def test_make_event_format(self):
        raw = make_event(EventType.LOG, {"message": "hello"})
        assert raw.startswith("data: ")
        assert raw.endswith("\n\n")

    def test_make_event_type_in_payload(self):
        raw = make_event(EventType.PROGRESS, {"pct": 50, "step": 5, "total": 10, "message": "ok"})
        payload = self._parse(raw)
        assert payload["type"] == "progress"

    def test_progress_event_fields(self):
        raw = progress_event(step=5, total=25, message="Generating…")
        payload = self._parse(raw)
        assert payload["type"]    == "progress"
        assert payload["step"]    == 5
        assert payload["total"]   == 25
        assert payload["pct"]     == 20        # 5/25 * 100 = 20
        assert payload["message"] == "Generating…"

    def test_progress_event_100_percent(self):
        raw = progress_event(step=25, total=25, message="Done")
        payload = self._parse(raw)
        assert payload["pct"] == 100

    def test_progress_event_zero_total_safe(self):
        raw = progress_event(step=0, total=0, message="")
        payload = self._parse(raw)
        assert payload["pct"] == 0  # no ZeroDivisionError

    def test_done_event_fields(self):
        raw = done_event({"images": [], "prompt": "test"})
        payload = self._parse(raw)
        assert payload["type"]   == "done"
        assert payload["images"] == []
        assert payload["prompt"] == "test"

    def test_error_event_fields(self):
        raw = error_event("ERROR_PROSPECT_GENERATE", "Generation failed")
        payload = self._parse(raw)
        assert payload["type"]    == "error"
        assert payload["code"]    == "ERROR_PROSPECT_GENERATE"
        assert payload["message"] == "Generation failed"

    def test_log_event_fields(self):
        raw = log_event("Downloading image 1/2…")
        payload = self._parse(raw)
        assert payload["type"]    == "log"
        assert payload["message"] == "Downloading image 1/2…"

    def test_step_active_event(self):
        raw = step_active_event("reconstruct", "Running depth estimation")
        payload = self._parse(raw)
        assert payload["type"]        == "step_active"
        assert payload["step_id"]     == "reconstruct"
        assert payload["description"] == "Running depth estimation"

    def test_step_done_event(self):
        raw = step_done_event("reconstruct", "mesh.glb")
        payload = self._parse(raw)
        assert payload["type"]    == "step_done"
        assert payload["step_id"] == "reconstruct"
        assert payload["output"]  == "mesh.glb"


# ═══════════════════════════════════════════════════════════════
# Job manager
# ═══════════════════════════════════════════════════════════════

class TestJobManager:

    def test_create_job_has_uuid(self):
        job = create_job("prospect")
        assert len(job.id) == 36  # UUID4 string
        assert job.stage == "prospect"
        assert job.status == JobStatus.PENDING

    def test_get_job_returns_same_object(self):
        job = create_job("smelt")
        retrieved = get_job(job.id)
        assert retrieved is job

    def test_get_job_missing_returns_none(self):
        result = get_job("00000000-0000-0000-0000-000000000000")
        assert result is None

    @pytest.mark.asyncio
    async def test_run_job_sets_done_on_success(self):
        job = create_job("prospect")

        async def good_worker(j: Job):
            await j.push(log_event("working…"))
            await j.push(done_event({"result": "ok"}))

        await run_job(job, good_worker)
        assert job.status == JobStatus.DONE

    @pytest.mark.asyncio
    async def test_run_job_sets_failed_on_exception(self):
        job = create_job("prospect")

        async def bad_worker(j: Job):
            raise RuntimeError("simulated failure")

        await run_job(job, bad_worker)
        assert job.status == JobStatus.FAILED
        assert "simulated failure" in (job.error_message or "")

    @pytest.mark.asyncio
    async def test_stream_yields_all_events_and_terminates(self):
        """
        Stream must yield all pushed events AND terminate after done_event.
        This tests the race-condition fix in job_manager.stream().
        """
        job = create_job("prospect")

        async def worker(j: Job):
            await j.push(log_event("step 1"))
            await j.push(progress_event(1, 3, "Step 1"))
            await j.push(progress_event(2, 3, "Step 2"))
            await j.push(progress_event(3, 3, "Step 3"))
            await j.push(done_event({"images": ["img_url"]}))

        # Run worker and collect stream events concurrently
        collected = []

        async def consume():
            async for raw_event in job.stream():
                payload = json.loads(raw_event[len("data: "):-2])
                collected.append(payload)

        # Run both and wait with a timeout so test never hangs
        await asyncio.wait_for(
            asyncio.gather(run_job(job, worker), consume()),
            timeout=5.0,
        )

        types = [e["type"] for e in collected]
        assert "log"      in types, "Expected 'log' event"
        assert "progress" in types, "Expected 'progress' events"
        assert "done"     in types, "Expected 'done' event"
        assert types[-1]  == "done", "Last event must be 'done'"

    @pytest.mark.asyncio
    async def test_stream_terminates_on_error(self):
        """Stream must also terminate when error_event is pushed."""
        job = create_job("prospect")

        async def worker(j: Job):
            j.status = JobStatus.FAILED  # set before push
            await j.push(error_event("ERROR_TEST", "test error"))

        collected = []

        async def consume():
            async for raw_event in job.stream():
                payload = json.loads(raw_event[len("data: "):-2])
                collected.append(payload)

        await asyncio.wait_for(
            asyncio.gather(run_job(job, worker), consume()),
            timeout=5.0,
        )

        assert any(e["type"] == "error" for e in collected)

    @pytest.mark.asyncio
    async def test_job_checkpoint_tracks_step(self):
        job = create_job("forge")
        job.checkpoint(0)
        assert job.last_step == 0
        job.checkpoint(3)
        assert job.last_step == 3
