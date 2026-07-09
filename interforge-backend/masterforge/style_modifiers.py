"""
Art style modifiers.

Styles are an additive layer on top of asset type configs.
They adjust CFG, steps, sampler, and inject prompt tokens.
Asset type config is the base — style deltas are applied on top.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class StyleModifier:
    id: str
    name: str
    prompt_prefix: str          # prepended to user prompt
    prompt_suffix: str          # appended to user prompt (before lighting)
    cfg_delta: float            # added to base CFG
    steps_delta: int            # added to base steps
    sampler_override: str | None = None   # overrides asset sampler if set
    scheduler_override: str | None = None
    description: str = ""


STYLE_MODIFIERS: dict[str, StyleModifier] = {
    "painterly": StyleModifier(
        id="painterly",
        name="Painterly",
        prompt_prefix="painterly, oil painting, expressive brushwork,",
        prompt_suffix="textured paint surface, artistic, rendered in oils",
        cfg_delta=0.5,
        steps_delta=2,
        description="Oil/acrylic paint look with visible brushwork.",
    ),
    "pixel_art": StyleModifier(
        id="pixel_art",
        name="Pixel Art",
        prompt_prefix="pixel art, pixelated, 8-bit style, limited color palette,",
        prompt_suffix="crisp pixels, no anti-aliasing, retro game sprite",
        cfg_delta=1.5,
        steps_delta=5,
        sampler_override="dpm_2",
        description="Hard pixel edges, limited palette, retro game aesthetic.",
    ),
    "low_poly": StyleModifier(
        id="low_poly",
        name="Low Poly",
        prompt_prefix="low poly, flat shaded, faceted geometry, geometric,",
        prompt_suffix="minimal vertices, clean flat fills, no texture detail",
        cfg_delta=1.0,
        steps_delta=0,
        description="Flat-shaded geometric low poly 3D art style.",
    ),
    "realistic": StyleModifier(
        id="realistic",
        name="Realistic",
        prompt_prefix="photorealistic, physically based rendering, PBR materials,",
        prompt_suffix="high detail, photo quality, subsurface scattering, realistic materials, masterpiece, 8k resolution, ultra-detailed, sharp focus",
        cfg_delta=-0.5,
        steps_delta=10,
        sampler_override="dpm_2_ancestral",
        description="High fidelity PBR-quality renders.",
    ),
    "stylized": StyleModifier(
        id="stylized",
        name="Stylized",
        prompt_prefix="stylized 3D game asset, clean stylized render, matte shading,",
        prompt_suffix="smooth simple forms, appealing design",
        cfg_delta=0.0,
        steps_delta=5,
        description="Clean stylized 3D-render game-asset look — SF3D-friendly (default). "
                    "NOT semi-realistic: photoreal detail/lighting reconstructs poorly.",
    ),
    "sketch": StyleModifier(
        id="sketch",
        name="Sketch",
        prompt_prefix="pencil sketch, concept art sketch, linework,",
        prompt_suffix="loose lines, gestural, ink and graphite, concept ideation",
        cfg_delta=-1.5,
        steps_delta=-5,
        description="Loose pencil/ink sketch for rapid concept ideation.",
    ),
    "cel_shaded": StyleModifier(
        id="cel_shaded",
        name="Cel Shaded",
        prompt_prefix="cel shaded, toon shading, anime style,",
        prompt_suffix="bold outlines, flat color fills, no gradients, manga influence",
        cfg_delta=1.0,
        steps_delta=3,
        description="Hard outlines, flat fills — anime/cartoon look.",
    ),
    "isometric": StyleModifier(
        id="isometric",
        name="Isometric",
        prompt_prefix="isometric view, isometric game art, 45 degree angle,",
        prompt_suffix="isometric perspective, clean isometric projection, game asset",
        cfg_delta=1.5,
        steps_delta=3,
        description="Fixed 45° isometric projection — for tile-based games.",
    ),
}


def apply_style(
    base_cfg: float,
    base_steps: int,
    base_sampler: str,
    base_scheduler: str,
    art_style: str,
    user_prompt: str,
) -> dict:
    """
    Apply style modifier deltas to base asset config values.
    Returns a dict of resolved generation parameters.
    """
    mod = STYLE_MODIFIERS.get(art_style)
    if mod is None:
        # Unknown style — return base unchanged
        return {
            "cfg": base_cfg,
            "steps": base_steps,
            "sampler": base_sampler,
            "scheduler": base_scheduler,
            "prompt": user_prompt,
        }

    # Build full positive prompt: prefix + user + suffix
    parts = []
    if mod.prompt_prefix:
        parts.append(mod.prompt_prefix.rstrip(",").strip())
    parts.append(user_prompt.strip())
    if mod.prompt_suffix:
        parts.append(mod.prompt_suffix.strip())
    full_prompt = ", ".join(p for p in parts if p)

    return {
        "cfg":       round(base_cfg + mod.cfg_delta, 2),
        "steps":     max(10, base_steps + mod.steps_delta),
        "sampler":   mod.sampler_override or base_sampler,
        "scheduler": mod.scheduler_override or base_scheduler,
        "prompt":    full_prompt,
    }


def list_styles() -> list[dict]:
    return [
        {"id": k, "name": v.name, "description": v.description}
        for k, v in STYLE_MODIFIERS.items()
    ]
