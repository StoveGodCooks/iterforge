"""
Negative prompt library.

Each asset type has a curated negative prompt that suppresses the most
common failure modes for that category. These are combined with the
universal base negatives at build time.
"""
from __future__ import annotations

# ── Universal base ────────────────────────────────────────────
# Applied to every generation regardless of asset type or style.
BASE_NEGATIVE = (
    "blurry, low quality, worst quality, jpeg artifacts, watermark, signature, "
    "text, username, out of frame, cropped, deformed, disfigured, bad anatomy, "
    "extra limbs, cloned face, ugly, duplicate, morbid, mutilated, extra fingers, "
    "fused fingers, too many fingers, long neck, mutation, poorly drawn, "
    "bad proportions, gross proportions, malformed limbs, missing arms, "
    "missing legs, extra arms, extra legs, "
    "oversaturated, overexposed, underexposed, flat shading, plastic look, "
    "low detail, low resolution, pixelated, noisy, grainy, washed out, "
    "multiple objects, two objects, pair of objects, collection, group, "
    "set of items, duplicated subject, mirrored, reflected copy"
)

# ── Per asset type negatives ──────────────────────────────────
# These are appended AFTER the base negative.
ASSET_NEGATIVES: dict[str, str] = {
    "prop": (
        "floating parts, disconnected elements, impossible geometry, "
        "multiple props, two props, pair, collection of items, "
        "scene background, environment, floor, wall, shadow on ground"
    ),
    "weapon": (
        "bent blade, asymmetrical, broken, rusty unless intentional, "
        "floating parts, multiple weapons, two weapons, two swords, pair of swords, "
        "dual wield, crossed weapons, weapon rack, weapon display, "
        "background clutter, human hands, non-weapon objects, impossible geometry"
    ),
    "armor": (
        "floating pieces, asymmetrical unless intentional, broken straps, "
        "inside-out, non-armor elements, background objects, on a person unless hero shot"
    ),
    "character": (
        "extra heads, extra limbs, fused body parts, floating limbs, "
        "bad hands, bad feet, poorly drawn face, asymmetrical eyes, "
        "cross-eyed, wall-eyed, multiple characters, scene background"
    ),
    "creature": (
        "extra heads, wrong number of limbs for creature type, "
        "human features unless humanoid, bad anatomy, floating parts, "
        "multiple creatures, complex background"
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
        "animals, characters, buildings, non-plant elements, "
        "floating leaves disconnected from branch, wilted unless autumn"
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
    """
    asset_neg = ASSET_NEGATIVES.get(asset_type, "")
    parts = [BASE_NEGATIVE]
    if asset_neg:
        parts.append(asset_neg)
    if extra:
        parts.append(extra)
    return ", ".join(parts)
