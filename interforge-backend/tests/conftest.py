"""
Shared pytest fixtures and helpers for the InterForge test suite.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# ── Make interforge-backend importable from the tests/ subdirectory ──
_BACKEND = Path(__file__).parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import pytest

# ── AsyncIO mode ──────────────────────────────────────────────
pytest_plugins = ("pytest_asyncio",)


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()


# ── Constants ─────────────────────────────────────────────────
BACKEND_URL = "http://127.0.0.1:7842"

MODELS_DIR = Path(
    os.environ.get(
        "INTERFORGE_MODELS_DIR",
        os.path.join(os.environ.get("APPDATA", ""), "IterForge", "models"),
    )
)
LORAS_DIR = MODELS_DIR / "loras"

# ── Helpers ───────────────────────────────────────────────────

def is_backend_running() -> bool:
    """True if the InterForge backend is reachable on port 7842."""
    try:
        import httpx
        r = httpx.get(f"{BACKEND_URL}/", timeout=2.0)
        return r.status_code == 200
    except Exception:
        return False


# Skip markers
skip_if_no_backend = pytest.mark.skipif(
    not is_backend_running(),
    reason="InterForge backend not running on port 7842",
)
