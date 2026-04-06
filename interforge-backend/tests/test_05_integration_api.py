"""
Integration tests — FastAPI backend endpoints.
Requires the InterForge backend running on port 7842.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from tests.conftest import skip_if_no_backend, BACKEND_URL

pytestmark = skip_if_no_backend


@pytest.fixture(scope="module")
def http():
    """Synchronous httpx client for the test session."""
    import httpx
    with httpx.Client(base_url=BACKEND_URL, timeout=10.0) as client:
        yield client


# ═══════════════════════════════════════════════════════════════
# Health / root
# ═══════════════════════════════════════════════════════════════

class TestHealthEndpoints:

    def test_root_returns_200(self, http):
        r = http.get("/")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"

    def test_status_returns_200(self, http):
        r = http.get("/api/status")
        assert r.status_code == 200

    def test_status_has_required_keys(self, http):
        r = http.get("/api/status")
        data = r.json()
        for key in ("backend", "gpu"):
            assert key in data, f"Missing key in /api/status: {key}"

    def test_setup_status_returns_200(self, http):
        r = http.get("/api/setup/status")
        assert r.status_code == 200

    def test_setup_status_has_sections(self, http):
        r  = http.get("/api/setup/status")
        data = r.json()
        for key in ("overall", "hardware", "python_deps", "models"):
            assert key in data, f"Missing key in /api/setup/status: {key}"


# ═══════════════════════════════════════════════════════════════
# MasterForge endpoints
# ═══════════════════════════════════════════════════════════════

class TestMasterForgeEndpoints:

    def test_asset_types_returns_list(self, http):
        r = http.get("/api/masterforge/asset-types")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 17

    def test_styles_returns_list(self, http):
        r = http.get("/api/masterforge/styles")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_describe_prop_stylized(self, http):
        r = http.get("/api/masterforge/describe?asset_type=prop&art_style=stylized")
        assert r.status_code == 200
        data = r.json()
        assert "resolution" in data
        assert "sampler"    in data

    def test_lighting_presets_returns_list(self, http):
        r = http.get("/api/masterforge/lighting-presets")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)


# ═══════════════════════════════════════════════════════════════
# Jobs endpoints
# ═══════════════════════════════════════════════════════════════

class TestJobsEndpoints:

    def test_list_jobs_returns_list(self, http):
        r = http.get("/api/jobs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_nonexistent_job_returns_404(self, http):
        r = http.get("/api/jobs/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 404

    def test_delete_nonexistent_job_returns_404(self, http):
        r = http.delete("/api/jobs/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════
# Prospect endpoint
# ═══════════════════════════════════════════════════════════════

class TestProspectEndpoint:

    def test_prospect_requires_prompt(self, http):
        r = http.post("/api/prospect", json={
            "prompt": "",
            "asset_type": "prop",
            "art_style": "stylized",
        })
        assert r.status_code == 422, (
            "Empty prompt should return 422 validation error"
        )

    def test_prospect_returns_job_id(self, http):
        """Start a prospect job and verify we get a job_id back."""
        r = http.post("/api/prospect", json={
            "prompt": "a small red cube",
            "asset_type": "prop",
            "art_style": "stylized",
            "seed": 42,
            "batch_size": 1,
        })
        assert r.status_code == 200, f"Unexpected status: {r.status_code} — {r.text}"
        data = r.json()
        assert "job_id" in data, f"Response missing 'job_id': {data}"
        assert len(data["job_id"]) == 36   # UUID

    def test_prospect_job_appears_in_list(self, http):
        r = http.post("/api/prospect", json={
            "prompt": "test job list",
            "asset_type": "prop",
            "art_style": "stylized",
            "seed": 1,
        })
        job_id = r.json()["job_id"]

        jobs_r = http.get("/api/jobs?stage=prospect")
        job_ids = [j["id"] for j in jobs_r.json()]
        assert job_id in job_ids, f"Job {job_id} not found in /api/jobs"

    def test_prospect_job_status_reachable(self, http):
        r = http.post("/api/prospect", json={
            "prompt": "test status",
            "asset_type": "prop",
            "art_style": "stylized",
        })
        job_id = r.json()["job_id"]
        status_r = http.get(f"/api/jobs/{job_id}")
        assert status_r.status_code == 200
        data = status_r.json()
        assert data["id"]    == job_id
        assert data["stage"] == "prospect"
        assert data["status"] in ("pending", "running", "done", "failed")

    def test_prospect_sse_stream_starts(self, http):
        """SSE stream endpoint must return 200 with text/event-stream content type."""
        r = http.post("/api/prospect", json={
            "prompt": "test sse",
            "asset_type": "prop",
            "art_style": "stylized",
        })
        job_id = r.json()["job_id"]

        # Use a short timeout — we just need the response headers
        import httpx
        with httpx.Client(base_url=BACKEND_URL, timeout=5.0) as c:
            with c.stream("GET", f"/api/jobs/{job_id}/stream") as stream:
                assert stream.status_code == 200
                ct = stream.headers.get("content-type", "")
                assert "text/event-stream" in ct, (
                    f"Expected content-type text/event-stream, got: {ct}"
                )

    def test_prospect_sse_delivers_at_least_one_event(self, http):
        """SSE stream must deliver at least one event (log or error) within 10 seconds."""
        r = http.post("/api/prospect", json={
            "prompt": "test events",
            "asset_type": "prop",
            "art_style": "stylized",
        })
        job_id = r.json()["job_id"]

        import httpx
        events_received = []
        deadline = time.time() + 10.0

        with httpx.Client(base_url=BACKEND_URL, timeout=15.0) as c:
            with c.stream("GET", f"/api/jobs/{job_id}/stream") as stream:
                for line in stream.iter_lines():
                    if line.startswith("data: "):
                        payload = json.loads(line[len("data: "):])
                        events_received.append(payload)
                        break  # one event is enough for this test
                    if time.time() > deadline:
                        break

        assert len(events_received) > 0, (
            "SSE stream delivered no events within 10 seconds"
        )


# ═══════════════════════════════════════════════════════════════
# Static file serving
# ═══════════════════════════════════════════════════════════════

class TestStaticFiles:

    def test_outputs_mount_returns_404_for_missing(self, http):
        r = http.get("/outputs/nonexistent/file.png")
        assert r.status_code in (404, 405), (
            f"Expected 404 for missing output file, got {r.status_code}"
        )

    def test_outputs_mount_serves_real_files(self, http, tmp_path):
        """If a real file exists under PROJECTS_ROOT, it must be servable."""
        from pathlib import Path
        projects_root = Path.home() / "interforge-projects"
        test_dir  = projects_root / "_test"
        test_file = test_dir / "smoke.txt"
        test_dir.mkdir(parents=True, exist_ok=True)
        test_file.write_text("ok")

        r = http.get("/outputs/_test/smoke.txt")
        assert r.status_code == 200, (
            f"Static file not served correctly: {r.status_code}"
        )
        assert r.text == "ok"

        # Cleanup
        test_file.unlink(missing_ok=True)
        test_dir.rmdir()
