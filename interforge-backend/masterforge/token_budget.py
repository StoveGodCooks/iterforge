"""
CLIP token budgeting for prompts.

SDXL's text encoders take 77 tokens. Past that the tokenizer truncates
*silently* — no error, no warning, the tail simply never reaches the model.

Every prompt file in this package carries a comment warning about that limit,
but nothing measured it, and everything overflowed:

    positive  (character, stylized)   87 tokens  -> 10 dropped
    negative  (character)            122 tokens  -> 45 dropped
    negative  (weapon)               165 tokens  -> 88 dropped

The dropped negative tail is where the anatomy and ground-plane suppressors
live ("extra heads", "bad hands", "wrong limb count", "diorama base", "standing
on rocks"), so the guardrails that mattered most were the ones never applied.

`fit` trims on comma boundaries instead, so a clause is either fully present or
fully absent — never half a concept — and logs whatever it drops.
"""
from __future__ import annotations

import logging
import threading

log = logging.getLogger(__name__)

# 77 total, minus BOS and EOS.
CLIP_LIMIT = 77
_USABLE = CLIP_LIMIT - 2

_tokenizer = None


def _get_tokenizer():
    """Load the real SDXL tokenizer once, lazily.

    `local_files_only` matters: without it the first call spends ~5s reaching
    out to the hub to revalidate, and that landed inside the first generation
    request. The tokenizer ships with the SDXL snapshot already on disk, so
    there is nothing to fetch.

    Falls back to None if it cannot be loaded (no cache yet) — callers then use
    the word-count estimate rather than failing a generation over a prompt
    measurement.
    """
    global _tokenizer
    if _tokenizer is None:
        try:
            from transformers import CLIPTokenizer
            _tokenizer = CLIPTokenizer.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0",
                subfolder="tokenizer",
                local_files_only=True,
            )
        except Exception as exc:  # pragma: no cover - environment dependent
            log.warning("[tokens] CLIP tokenizer unavailable (%s); using estimate", exc)
            _tokenizer = False
    return _tokenizer or None


_warming = threading.Lock()


def _warm_async() -> None:
    """Kick off the tokenizer load without blocking the caller."""
    if not _warming.acquire(blocking=False):
        return  # a load is already in flight
    def _run():
        try:
            _get_tokenizer()
        finally:
            _warming.release()
    threading.Thread(target=_run, name="clip-tokenizer-warm", daemon=True).start()


def warm() -> None:
    """Pre-load the tokenizer off the request path.

    Called at backend startup so the one-time load never shows up as latency in
    a user's first generation.
    """
    try:
        _get_tokenizer()
    except Exception:  # pragma: no cover - never block startup on this
        pass


def _estimate(text: str) -> int:
    """~1.3 tokens per whitespace word, plus BOS/EOS. Deliberately slightly
    high so the estimate trims a touch early rather than overflowing."""
    return int(len(text.split()) * 1.3) + 2


def count(text: str) -> int:
    """Token count including BOS/EOS, matching what the pipeline will see.

    Never blocks. If the tokenizer is not resident yet this returns the
    estimate and loads the real one on a background thread — measuring a prompt
    must not add latency to a generation request. `warm()` at startup means
    this path is normally only taken in tests and cold-start races.
    """
    if _tokenizer is None:
        _warm_async()
        return _estimate(text)
    tok = _get_tokenizer()
    if tok is None:
        return _estimate(text)
    return len(tok(text)["input_ids"])


def fit(text: str, limit: int = CLIP_LIMIT, label: str = "prompt") -> str:
    """Trim `text` to `limit` CLIP tokens, dropping whole comma-separated
    clauses from the end.

    Clause-wise rather than token-wise so the prompt never ends mid-concept —
    a truncated "extra fing" contributes noise, not meaning.
    """
    if count(text) <= limit:
        return text

    clauses = [c.strip() for c in text.split(",") if c.strip()]
    kept: list[str] = []
    for clause in clauses:
        candidate = ", ".join(kept + [clause])
        if count(candidate) > limit:
            break
        kept.append(clause)

    fitted = ", ".join(kept)
    dropped = clauses[len(kept):]
    if dropped:
        log.warning(
            "[tokens] %s over budget: %d/%d tokens, dropped %d clause(s): %s",
            label, count(text), limit, len(dropped), "; ".join(dropped),
        )
    return fitted
