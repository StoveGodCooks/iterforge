"""
Prompt templates and pre-validation for asset generation.

Templates wrap user prompts with structured isolation directives per asset type.
SDXL weights early tokens more heavily, so isolation cues go at the front.

Validator catches obvious failure patterns (plurals, banned tokens) before
generation starts — cheaper than wasting a 30-step diffusion pass.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


# ── Prompt Templates ─────────────────────────────────────────

@dataclass(frozen=True)
class PromptTemplate:
    """Structured prompt template for an asset type."""
    prefix: str       # placed BEFORE user prompt (isolation + framing)
    suffix: str       # placed AFTER user prompt (quality + background)


# 3D asset types — need strong isolation for clean reconstruction
TEMPLATES_3D: dict[str, PromptTemplate] = {
    # ── 3D asset templates ────────────────────────────────────
    # RULE: NEVER put "no X" phrases ("no shadow", "no reflection") in the
    # POSITIVE prompt. SDXL tokenizes "no shadow" as "no" + "shadow" and
    # weights "shadow" normally — so you're effectively asking for shadows.
    # Negation belongs in the negative prompt. Use POSITIVE cues here:
    # "floating", "levitating", "isolated on pure white", "shadowless lighting"
    # (that last is OK as a single token — it's a photography term).
    # Also NEVER "studio lighting" — it implies key/fill/shadow rigs.
    "prop": PromptTemplate(
        prefix="single game prop, one object only, isolated on pure white, floating, centered, front view,",
        suffix="pure white background, shadowless flat lighting, clean silhouette, sharp focus, highly detailed, professional 3d asset render",
    ),
    "weapon": PromptTemplate(
        prefix="single fantasy weapon, one weapon only, isolated on pure white, floating, levitating, centered, full weapon visible,",
        suffix="pure white background, shadowless overhead lighting, clean silhouette, sharp metalwork, highly detailed, professional game art",
    ),
    "armor": PromptTemplate(
        prefix="single armor set, one armor only, isolated on pure white, floating, centered, full armor display,",
        suffix="pure white background, shadowless flat lighting, clean silhouette, sharp detail, highly detailed, professional game art",
    ),
    "character": PromptTemplate(
        # SF3D-tuned: ¾ view + figure filling a square frame reconstructs far
        # better than the old "full body, front facing" (built for silhouette
        # carving). Dropped the detail/silhouette cues that pushed photoreal.
        prefix="single stylized character, one character only, isolated on pure white, centered, three-quarter front view, full figure filling the frame,",
        suffix="pure white background, even flat lighting, clean stylized 3d game character",
    ),
    "creature": PromptTemplate(
        prefix="single stylized fantasy creature, one creature only, isolated on pure white, centered, three-quarter view, figure filling the frame,",
        suffix="pure white background, even flat lighting, clean stylized 3d game creature",
    ),
    "vehicle": PromptTemplate(
        prefix="single vehicle, one vehicle only, isolated on pure white, floating, centered, side view,",
        suffix="pure white background, shadowless flat lighting, clean silhouette, sharp detail, highly detailed, professional game art",
    ),
    "building": PromptTemplate(
        prefix="single building, one structure only, isolated on pure white, floating, centered,",
        suffix="pure white background, shadowless flat lighting, clean silhouette, clean separation, highly detailed, professional architectural game art",
    ),
    "dungeon_tile": PromptTemplate(
        prefix="single dungeon tile, one tile only, isolated on pure white, centered, top-down view,",
        suffix="pure white background, flat top-down lighting, modular tile, sharp edges, professional game art",
    ),
    "foliage": PromptTemplate(
        prefix="single plant, one plant only, isolated on pure white, floating, centered,",
        suffix="pure white background, shadowless flat lighting, clean silhouette, natural detail, professional game vegetation art",
    ),
}

# 2D asset types — less isolation needed, more creative freedom
TEMPLATES_2D: dict[str, PromptTemplate] = {
    "environment": PromptTemplate(
        prefix="environment concept art, wide shot,",
        suffix="detailed illustration, atmospheric, professional game environment art",
    ),
    "tileable_texture": PromptTemplate(
        prefix="seamless tileable texture, repeating pattern,",
        suffix="PBR material, no visible seams, professional game texture",
    ),
    "skybox": PromptTemplate(
        prefix="panoramic skybox, 360 sky,",
        suffix="seamless, atmospheric, professional game background",
    ),
    "vfx_element": PromptTemplate(
        prefix="vfx element, particle effect,",
        suffix="transparent background, game effect, clean alpha",
    ),
    "ui_icon": PromptTemplate(
        prefix="game ui icon, clean icon design, centered,",
        suffix="white background, simple composition, professional game icon",
    ),
    "logo": PromptTemplate(
        prefix="logo design, clean vector style,",
        suffix="white background, professional, sharp lines",
    ),
    "concept_art": PromptTemplate(
        prefix="concept art, detailed illustration,",
        suffix="professional game concept, artistic, high quality",
    ),
    "sprite": PromptTemplate(
        prefix="game sprite, 2d game art,",
        suffix="transparent background, clean edges, professional sprite art",
    ),
}

ALL_TEMPLATES: dict[str, PromptTemplate] = {**TEMPLATES_3D, **TEMPLATES_2D}


def build_templated_prompt(user_prompt: str, asset_type: str) -> str:
    """
    Wrap user prompt with the structured template for this asset type.

    Returns: "prefix, user_prompt, suffix"
    Falls back to raw user_prompt if no template exists.
    """
    tmpl = ALL_TEMPLATES.get(asset_type)
    if tmpl is None:
        return user_prompt

    # Subject FIRST — SDXL weights early tokens most heavily, and CLIP truncates
    # at 77 tokens. If isolation boilerplate leads, every asset of a type looks
    # the same and long descriptions get cut. Lead with the user's subject;
    # isolation + quality cues follow (still present, lower weight, truncated last).
    parts = [user_prompt.strip()]
    if tmpl.prefix:
        parts.append(tmpl.prefix.rstrip(",").strip())
    if tmpl.suffix:
        parts.append(tmpl.suffix.strip())

    return ", ".join(p for p in parts if p)


# ── Prompt Pre-Validation ────────────────────────────────────

# Patterns that indicate plural/multiple objects — hard reject for 3D assets
PLURAL_PATTERNS: list[re.Pattern] = [
    re.compile(r"\btwo\b", re.IGNORECASE),
    re.compile(r"\bthree\b", re.IGNORECASE),
    re.compile(r"\bfour\b", re.IGNORECASE),
    re.compile(r"\bfive\b", re.IGNORECASE),
    re.compile(r"\bpair\s+of\b", re.IGNORECASE),
    re.compile(r"\bset\s+of\b", re.IGNORECASE),
    re.compile(r"\bcollection\s+of\b", re.IGNORECASE),
    re.compile(r"\bgroup\s+of\b", re.IGNORECASE),
    re.compile(r"\bbunch\s+of\b", re.IGNORECASE),
    re.compile(r"\bmultiple\b", re.IGNORECASE),
    re.compile(r"\bseveral\b", re.IGNORECASE),
    re.compile(r"\bdual\b", re.IGNORECASE),
    re.compile(r"\btwin\b", re.IGNORECASE),
    re.compile(r"\bdouble\b", re.IGNORECASE),
    re.compile(r"\bmatching\s+pair\b", re.IGNORECASE),
]

# Asset types that require single-object isolation (3D pipeline)
_3D_ASSET_TYPES = set(TEMPLATES_3D.keys())


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str]
    warnings: list[str]
    cleaned_prompt: str   # prompt with auto-fixes applied (if any)


def validate_prompt(prompt: str, asset_type: str) -> ValidationResult:
    """
    Validate a user prompt before generation.

    For 3D asset types: rejects prompts with plural patterns.
    For all types: strips leading/trailing whitespace, checks minimum length.

    Returns ValidationResult with errors (hard reject) and warnings (soft).
    """
    errors: list[str] = []
    warnings: list[str] = []
    cleaned = prompt.strip()

    # Basic checks
    if len(cleaned) < 3:
        errors.append("Prompt is too short — describe what you want to generate.")
        return ValidationResult(False, errors, warnings, cleaned)

    # Plural detection — only enforce for 3D asset types
    if asset_type in _3D_ASSET_TYPES:
        for pattern in PLURAL_PATTERNS:
            match = pattern.search(cleaned)
            if match:
                errors.append(
                    f"3D assets must be a single object. "
                    f"Found '{match.group()}' — remove plural/quantity words. "
                    f"Example: 'a sword' instead of 'two swords'."
                )
                break  # one error is enough

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        cleaned_prompt=cleaned,
    )
