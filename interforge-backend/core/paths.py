"""
Path-safety helpers — validate untrusted job identifiers before they touch the
filesystem, and confine derived paths to PROJECTS_ROOT.

Job ids in InterForge are UUID4 strings (see core.job_manager.create_job), so a
strict allowlist (letters, digits, hyphen, underscore) rejects any path-traversal
payload — including Windows' backslash separator and '..' — without breaking any
real id.
"""
from __future__ import annotations

import re
from pathlib import Path

from core.config import PROJECTS_ROOT

_JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def is_valid_job_id(job_id: str) -> bool:
    """True if job_id is a safe single path segment (no separators, no '..')."""
    return bool(job_id) and _JOB_ID_RE.fullmatch(job_id) is not None


def safe_job_dir(job_id: str, *subpaths: str) -> Path:
    """
    Resolve PROJECTS_ROOT/<job_id>/<subpaths...>, rejecting invalid ids and any
    result that escapes PROJECTS_ROOT. Raises ValueError on a bad id or a path
    that would resolve outside the projects root.
    """
    if not is_valid_job_id(job_id):
        raise ValueError(f"Invalid job id: {job_id!r}")
    root = PROJECTS_ROOT.resolve()
    resolved = root.joinpath(job_id, *subpaths).resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f"Path escapes projects root: {resolved}")
    return resolved
