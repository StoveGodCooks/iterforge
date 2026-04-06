"""
Pipeline profiler — measures wall-clock time for each step and sub-operation.

Usage:
    profiler = PipelineProfiler(job_id="abc123", route="ORGANIC")

    with profiler.section("build", "Visual hull reconstruction"):
        with profiler.section("build.load_images"):
            ...
        with profiler.section("build.carve_volume"):
            ...

    profiler.export(out_dir)  # writes profile_<job_id>.md + .json

Thread-safe: sections can be opened from background threads.
Nesting is tracked by depth (parent.child naming convention).
"""
from __future__ import annotations

import json
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Generator


@dataclass
class TimingRecord:
    section:     str          # e.g. "build" or "build.carve_volume"
    label:       str          # human-readable description
    start_epoch: float        # time.perf_counter() at entry
    end_epoch:   float = 0.0
    duration_ms: float = 0.0
    depth:       int   = 0    # nesting depth (0 = top-level step)

    def finish(self) -> None:
        self.end_epoch   = time.perf_counter()
        self.duration_ms = (self.end_epoch - self.start_epoch) * 1_000


class PipelineProfiler:
    """
    Collects hierarchical timing data for the forge pipeline.

    All public methods are thread-safe.
    """

    def __init__(self, job_id: str, route: str) -> None:
        self.job_id     = job_id
        self.route      = route
        self._records:  list[TimingRecord] = []
        self._lock      = threading.Lock()
        self._pipeline_start = time.perf_counter()

    # ── Context manager ──────────────────────────────────────────

    @contextmanager
    def section(self, name: str, label: str = "") -> Generator[None, None, None]:
        """
        Time a named section.  Nesting is expressed with dot notation:
            with profiler.section("build"):
                with profiler.section("build.marching_cubes"):
        """
        depth  = name.count(".")
        record = TimingRecord(
            section     = name,
            label       = label or name,
            start_epoch = time.perf_counter(),
            depth       = depth,
        )
        try:
            yield
        finally:
            record.finish()
            with self._lock:
                self._records.append(record)

    # ── Instant marker (zero-duration note) ──────────────────────

    def mark(self, section: str, label: str) -> None:
        """Record an instant event (e.g. 'loaded 4 views')."""
        now = time.perf_counter()
        r   = TimingRecord(section=section, label=label,
                           start_epoch=now, end_epoch=now,
                           duration_ms=0.0, depth=section.count("."))
        with self._lock:
            self._records.append(r)

    # ── Export ───────────────────────────────────────────────────

    def export(self, out_dir: Path) -> tuple[Path, Path]:
        """
        Write profile_<job_id>.md and profile_<job_id>.json to out_dir.
        Returns (md_path, json_path).
        """
        total_ms = (time.perf_counter() - self._pipeline_start) * 1_000

        with self._lock:
            records = list(self._records)

        md_path   = out_dir / f"profile_{self.job_id}.md"
        json_path = out_dir / f"profile_{self.job_id}.json"

        # ── JSON ─────────────────────────────────────────────────
        json_data = {
            "job_id":    self.job_id,
            "route":     self.route,
            "total_ms":  round(total_ms, 2),
            "total_s":   round(total_ms / 1_000, 2),
            "sections":  [
                {
                    "section":     r.section,
                    "label":       r.label,
                    "depth":       r.depth,
                    "duration_ms": round(r.duration_ms, 2),
                    "duration_s":  round(r.duration_ms / 1_000, 2),
                    "pct_total":   round(r.duration_ms / total_ms * 100, 1) if total_ms > 0 else 0,
                }
                for r in records
                if r.duration_ms > 0  # skip instant markers in JSON
            ],
            "bottlenecks": _top_bottlenecks(records, total_ms, n=5),
        }
        json_path.write_text(json.dumps(json_data, indent=2), encoding="utf-8")

        # ── Markdown ─────────────────────────────────────────────
        lines: list[str] = []
        lines.append(f"# InterForge Pipeline Profile")
        lines.append(f"")
        lines.append(f"**Job:** `{self.job_id}`  ")
        lines.append(f"**Route:** `{self.route}`  ")
        lines.append(f"**Total time:** `{_fmt(total_ms)}`")
        lines.append(f"")

        # Top-level steps table
        top = [r for r in records if r.depth == 0 and r.duration_ms > 0]
        if top:
            lines.append("## Steps")
            lines.append("")
            lines.append("| Step | Time | % Total | Bar |")
            lines.append("|------|------|---------|-----|")
            for r in top:
                pct  = r.duration_ms / total_ms * 100 if total_ms > 0 else 0
                bar  = _bar(pct)
                flag = " ⚠️" if pct > 40 else ""
                lines.append(
                    f"| `{r.section}` | {_fmt(r.duration_ms)} | {pct:.1f}% | {bar}{flag} |"
                )
            lines.append("")

        # Sub-operations grouped by parent
        parents = {r.section.rsplit(".", 1)[0] for r in records if r.depth > 0}
        for parent in sorted(parents):
            children = [r for r in records if r.section.startswith(parent + ".") and r.depth == parent.count(".") + 1 and r.duration_ms > 0]
            if not children:
                continue
            lines.append(f"### {parent} — sub-operations")
            lines.append("")
            lines.append("| Operation | Time | % of Step |")
            lines.append("|-----------|------|-----------|")
            parent_rec = next((r for r in records if r.section == parent), None)
            parent_ms  = parent_rec.duration_ms if parent_rec else sum(c.duration_ms for c in children)
            for c in children:
                pct = c.duration_ms / parent_ms * 100 if parent_ms > 0 else 0
                flag = " ⚠️" if pct > 50 else ""
                lines.append(f"| `{c.section.split('.')[-1]}` | {_fmt(c.duration_ms)} | {pct:.1f}%{flag} |")
            lines.append("")

        # Bottleneck summary
        bottlenecks = _top_bottlenecks(records, total_ms, n=5)
        if bottlenecks:
            lines.append("## Top Bottlenecks")
            lines.append("")
            lines.append("| Rank | Section | Time | % Total |")
            lines.append("|------|---------|------|---------|")
            for i, b in enumerate(bottlenecks, 1):
                lines.append(f"| #{i} | `{b['section']}` | {_fmt(b['duration_ms'])} | {b['pct_total']}% |")
            lines.append("")

        lines.append("---")
        lines.append(f"*Generated by InterForge profiler — route `{self.route}`*")

        md_path.write_text("\n".join(lines), encoding="utf-8")
        return md_path, json_path


# ── Helpers ──────────────────────────────────────────────────────

def _fmt(ms: float) -> str:
    if ms >= 60_000:
        return f"{ms/60_000:.1f} min"
    if ms >= 1_000:
        return f"{ms/1_000:.2f} s"
    return f"{ms:.0f} ms"


def _bar(pct: float, width: int = 20) -> str:
    filled = int(pct / 100 * width)
    return "█" * filled + "░" * (width - filled)


def _top_bottlenecks(records: list[TimingRecord], total_ms: float, n: int = 5) -> list[dict]:
    timed = sorted(
        [r for r in records if r.duration_ms > 0],
        key=lambda r: r.duration_ms,
        reverse=True,
    )
    return [
        {
            "section":     r.section,
            "label":       r.label,
            "duration_ms": round(r.duration_ms, 2),
            "duration_s":  round(r.duration_ms / 1_000, 2),
            "pct_total":   round(r.duration_ms / total_ms * 100, 1) if total_ms > 0 else 0,
        }
        for r in timed[:n]
    ]
