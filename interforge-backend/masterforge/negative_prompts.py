"""
Negative prompt library.

Each asset type has a curated negative prompt that suppresses the most
common failure modes for that category. These are combined with the
universal base negatives at build time.
"""
from __future__ import annotations

from masterforge.token_budget import fit

# ── Universal base ────────────────────────────────────────────
# Applied to every generation regardless of asset type or style.
# Rule philosophy: fight the model's actual failure tendencies, not abstract
# categories. SDXL loves shadows, reflections, and multi-object compositions —
# suppress all three hard here rather than relying on asset-type layers.
BASE_NEGATIVE = (
    # KEEP TIGHT: SDXL's CLIP encoders truncate the negative at ~77 tokens, so
    # only the first ~77 actually apply — a 300-token list silently discards
    # most of itself. Front-load the failure modes that corrupt rembg masks and
    # reconstruction; per-asset negatives (incl. realism killers) follow and
    # must also land inside the 77-token window.
    # Gloss/specular AND shadow are the top mesh-corruptors: SF3D reads any
    # luminance variation as geometry (a hotspot → a bump, a crevice → a dent),
    # so kill both hard for 3D-reconstruction input.
    # Multi-subject suppression is front-loaded (survives the 77-token cut) and
    # applies to EVERY asset type + art style — illustrative styles (painterly,
    # sketch, cel-shaded, concept art) bias SDXL toward multi-figure scenes /
    # character sheets that a positive "one X only" cue can't hold back alone.
    # Kept lean on purpose: the whole negative (base + per-asset) must fit CLIP's
    # ~77-token window or the tail silently drops. Front-load the highest-value
    # suppressors; drop synonyms rather than pad.
    # MEASURED, not estimated. This block was 76 tokens on its own, which left
    # exactly zero room for the per-asset negatives below — every one of them
    # was truncated away in full, including the anatomy and ground-plane
    # suppressors. Deduplicated down to ~45 so the asset layer actually lands.
    # Synonyms dropped rather than concepts: "glossy" carries "wet look" and
    # "glare"; "crowd" carries "group of people"; "duplicate" carries "two
    # characters". Anatomy terms are kept whole — they are the point.
    "multiple subjects, crowd, character sheet, duplicate, "
    "shadow, reflection, glossy, specular highlights, "
    "scene background, floor, pedestal, "
    "blurry, low quality, watermark, text, cropped, "
    "deformed, bad anatomy, extra limbs, extra legs, extra fingers, mutation"
)

# ── Per asset type negatives ──────────────────────────────────
# These are appended AFTER the base negative.
ASSET_NEGATIVES: dict[str, str] = {
    "prop": (
        # front-loaded scene-leak killers: SDXL loves grounding objects in a
        # little diorama, which SF3D then reconstructs as one lump.
        "diorama, terrain, grass, rocks, moss, ground scene, base platform, "
        "multiple props, two props, collection, scene background, environment, "
        "floor, wall, floating parts, impossible geometry"
    ),
    "weapon": (
        "bent blade, asymmetrical, broken, rusty unless intentional, "
        "floating parts, multiple weapons, two weapons, two swords, pair of swords, "
        "dual wield, crossed weapons, weapon rack, weapon display, "
        "background clutter, human hands, non-weapon objects, impossible geometry, "
        # Shadows and reflections destroy rembg mask quality on thin objects
        "shadow beneath weapon, drop shadow, cast shadow on floor, "
        "weapon reflection, glossy floor under weapon, surface reflection, "
        "dramatic side lighting, rim light shadow, environment lighting"
    ),
    "armor": (
        "floating pieces, asymmetrical unless intentional, broken straps, "
        "inside-out, non-armor elements, background objects, on a person unless hero shot"
    ),
    # The ground-plane killers now carry the whole job of suppressing the
    # rock/grass plinth — the positive templates used to help by asking for a
    # "floating, levitating" figure, which is what produced the airborne poses.
    # These must survive the token cut, so they lead.
    "character": (
        "diorama base, grass, terrain, standing on rocks, "
        "extra heads, bad hands, wrong limb count, "
        "action pose, dynamic pose, jumping, flying, "
        "photorealistic, realistic skin, dramatic lighting"
    ),
    "creature": (
        "diorama base, grass, terrain, standing on rocks, "
        "extra heads, wrong limb count, extra tails, "
        "action pose, dynamic pose, jumping, flying, "
        "photorealistic, realistic skin, dramatic lighting"
    ),
    "vehicle": (
        "floating wheels, asymmetrical unless stylized, broken geometry, "
        "impossible physics, multiple vehicles, humans inside, "
        "complex background environment"
    ),
    "building": (
        "floating architecture, impossible physics, non-euclidean geometry unless intentional, "
        "people, vegetation unless requested, interior and exterior simultaneously, "
        "forced perspective errors"
    ),
    "dungeon_tile": (
        "organic shapes, rounded edges unless cave, inconsistent lighting direction, "
        "non-tileable elements at edges, furniture, characters, loot items"
    ),
    "environment": (
        "characters, props, vehicles, floating objects, "
        "inconsistent light sources, artificial framing"
    ),
    "foliage": (
        "diorama, terrain, grass patch, rocks, ground scene, pot, planter, "
        "multiple plants, animals, characters, buildings, floating leaves"
    ),
    "tileable_texture": (
        "visible seams, gradient backgrounds, vignette, centered composition, "
        "single focal point, non-repeating pattern, characters, props, logos"
    ),
    "skybox": (
        "horizon line artifacts, visible seams, characters, buildings in foreground, "
        "text, logos, watermarks, drone artifacts"
    ),
    "vfx_element": (
        "solid background, hard edges unless intentional, "
        "photorealistic unless specified, characters, props"
    ),
    "ui_icon": (
        "complex background, photo-realistic, gradient background unless flat design, "
        "multiple subjects, text overlay, frame border, watermark, "
        "low contrast, illegible at small size"
    ),
    "logo": (
        "complex background, photo-realistic texture, gradient unless brand spec, "
        "multiple logos, text errors, low contrast, uneven lines, "
        "asymmetry unless intentional, drop shadow unless specified"
    ),
    "concept_art": (
        "photo, photorealistic, 3d render, cgi, low effort sketch, "
        "unfinished linework unless sketch style"
    ),
    "sprite": (
        "3d render, photorealistic, background environment, "
        "anti-aliasing unless specified, sub-pixel details at target resolution"
    ),
}


def get_negative(asset_type: str, extra: str = "") -> str:
    """
    Returns the full negative prompt for an asset type.
    Combines BASE_NEGATIVE + asset-specific negative + any caller-supplied extras.

    The user's own extras go FIRST after the base: they are the one part of this
    string nobody else can supply, so if anything has to be cut it should not be
    them. Fitted to CLIP's window so the tail is dropped on a clause boundary
    with a log line, rather than silently mid-phrase inside the tokenizer.
    """
    asset_neg = ASSET_NEGATIVES.get(asset_type, "")
    parts = [BASE_NEGATIVE]
    if extra:
        parts.append(extra)
    if asset_neg:
        parts.append(asset_neg)
    return fit(", ".join(parts), label=f"negative[{asset_type}]")
