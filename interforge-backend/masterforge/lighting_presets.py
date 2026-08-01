"""
Lighting presets.

Lighting is injected as prompt tokens appended to the positive prompt.
Each preset targets a specific use-case environment so the generated
asset looks correct when placed in that context.
"""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class LightingPreset:
    name: str
    tokens: str             # appended to positive prompt
    description: str


LIGHTING_PRESETS: dict[str, LightingPreset] = {
    "flat_asset": LightingPreset(
        name="Flat Asset",
        # "no shadows" broke this package's own rule: SDXL tokenizes it as
        # "no" + "shadows" and weights "shadows" normally, so it asked for the
        # thing it meant to forbid. Shadow suppression is in BASE_NEGATIVE.
        # The rest duplicated the templates' "even flat lighting" suffix, which
        # is what pushed the positive prompt past 77 tokens.
        tokens="shadowless neutral light",
        description="Flat shadowless lighting for 3D-reconstruction assets — SF3D-friendly. "
                    "Directional/outdoor lighting bakes shadows into the mesh texture.",
    ),
    "studio": LightingPreset(
        name="Studio",
        tokens=(
            "studio lighting, three-point lighting setup, soft key light, "
            "fill light, rim light, neutral grey background, product photography"
        ),
        description="Clean neutral studio — ideal for weapons, armor, props, icons.",
    ),
    "outdoor_day": LightingPreset(
        name="Outdoor Day",
        tokens=(
            "natural daylight, overhead sun, soft ambient occlusion, "
            "warm golden highlights, cool blue shadows, outdoor environment"
        ),
        description="Sunlit exterior — good for vehicles, buildings, foliage.",
    ),
    "outdoor_dusk": LightingPreset(
        name="Outdoor Dusk",
        tokens=(
            "golden hour lighting, low angle sun, long warm shadows, "
            "orange and purple sky tones, dramatic silhouette, dusk"
        ),
        description="Cinematic dusk — great for hero characters and establishing shots.",
    ),
    "dungeon": LightingPreset(
        name="Dungeon",
        tokens=(
            "torchlight, warm flickering orange light source from below, "
            "deep shadows, dark ambient, subsurface glow on stone, "
            "dramatic chiaroscuro, underground atmosphere"
        ),
        description="Dark underground — dungeon tiles, caves, dungeon props.",
    ),
    "magical": LightingPreset(
        name="Magical",
        tokens=(
            "bioluminescent glow, magical light source, arcane energy, "
            "cool blue-purple ambient, particle light scatter, mystical atmosphere, "
            "rim light from magical effect"
        ),
        description="Fantasy magical — VFX elements, magical weapons, creatures.",
    ),
    "overcast": LightingPreset(
        name="Overcast",
        tokens=(
            "overcast sky, diffused soft light, flat even illumination, "
            "no harsh shadows, cool grey ambient, photogrammetry reference quality"
        ),
        description="Flat even light — best for tileable textures, reference captures.",
    ),
    "night": LightingPreset(
        name="Night",
        tokens=(
            "moonlight, cool blue ambient, deep shadows, starlight, "
            "atmospheric fog, city lights or lanterns as secondary source, "
            "high contrast, night scene"
        ),
        description="Night scene — skyboxes, night environment, stealth characters.",
    ),
    "interior": LightingPreset(
        name="Interior",
        tokens=(
            "interior lighting, warm artificial light sources, "
            "bounce light from walls, soft shadows, indoor atmosphere, "
            "window light from side, cozy or dramatic depending on context"
        ),
        description="Indoor rooms — buildings interior, furniture, interior props.",
    ),
}

# Default preset per asset type (used if user doesn't specify).
DEFAULT_PRESET: dict[str, str] = {
    # 3D-reconstruction asset types default to FLAT lighting — directional/outdoor
    # lighting bakes shadows into the SF3D mesh texture. Users can still override.
    "prop":             "flat_asset",
    "weapon":           "flat_asset",
    "armor":            "flat_asset",
    "character":        "flat_asset",
    "creature":         "flat_asset",
    "vehicle":          "flat_asset",
    "building":         "flat_asset",
    "dungeon_tile":     "flat_asset",
    "environment":      "outdoor_day",   # 2D — no reconstruction, contextual light is fine
    "foliage":          "flat_asset",
    "tileable_texture": "overcast",
    "skybox":           "outdoor_day",
    "vfx_element":      "magical",
    "ui_icon":          "studio",
    "logo":             "studio",
    "concept_art":      "studio",
    "sprite":           "studio",
}


def get_lighting_tokens(preset_name: str | None, asset_type: str) -> str:
    """
    Returns the lighting prompt tokens for the given preset.
    Falls back to the asset type default if preset_name is None.
    """
    resolved = preset_name or DEFAULT_PRESET.get(asset_type, "studio")
    preset = LIGHTING_PRESETS.get(resolved)
    if preset is None:
        preset = LIGHTING_PRESETS["studio"]
    return preset.tokens


def list_presets() -> list[dict]:
    return [
        {"id": k, "name": v.name, "description": v.description}
        for k, v in LIGHTING_PRESETS.items()
    ]
