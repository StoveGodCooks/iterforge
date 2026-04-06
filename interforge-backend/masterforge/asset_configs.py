"""
Asset type configuration — SDXL edition.

Switched from SD1.5 (512px) to SDXL (1024px) to match the installed
Juggernaut-XL checkpoint. Batch sizes reduced to 2 to stay within 8 GB VRAM.

SDXL resolution guide (multiples of 64, ~1M total pixels):
  Square    1024 × 1024  (1:1)
  Portrait   832 × 1216  (2:3)
  Landscape 1216 × 832   (3:2)
  Skybox    1024 × 512   (2:1 panoramic)
"""
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass(frozen=True)
class AssetConfig:
    # Sampler
    sampler: str = "euler_ancestral"
    scheduler: str = "karras"
    cfg: float = 6.5          # SDXL is more prompt-sensitive; 6-7 is sweet spot
    steps: int = 30           # 30 steps — Juggernaut XL sharpens significantly vs 25

    # Resolution — SDXL native
    width: int = 1024
    height: int = 1024

    # Pipeline routing
    reconstruction: str = "ORGANIC"    # "ORGANIC" | "HARD_SURFACE" | "NONE"
    skip_smelting: bool = False

    # Generation — batch 2 for SDXL (4× slower than SD1.5 per image)
    batch_size: int = 2
    prompt_keywords: list[str] = field(default_factory=list)


ASSET_CONFIGS: dict[str, AssetConfig] = {

    "prop": AssetConfig(
        sampler="euler_ancestral",
        scheduler="karras",
        cfg=7.5,
        steps=30,
        width=1024, height=1024,
        reconstruction="ORGANIC",
        batch_size=2,
        prompt_keywords=["single game prop", "one object", "3d asset", "centered", "isolated on pure white background", "highly detailed", "masterpiece", "professional game art"],
    ),

    "weapon": AssetConfig(
        sampler="dpm_2_ancestral",
        scheduler="karras",
        cfg=8.0,
        steps=30,
        width=832, height=1216,     # portrait — weapons are tall
        reconstruction="HARD_SURFACE",
        batch_size=2,
        prompt_keywords=["single fantasy weapon", "one weapon only", "game weapon", "centered", "isolated on pure white background", "highly detailed", "sharp metalwork", "masterpiece", "professional game art"],
    ),

    "armor": AssetConfig(
        sampler="dpm_2_ancestral",
        scheduler="karras",
        cfg=7.5,
        steps=30,
        width=832, height=1216,
        reconstruction="HARD_SURFACE",
        batch_size=2,
        prompt_keywords=["single armor set", "one armor", "game armor", "centered", "isolated on pure white background", "full armor"],
    ),

    "character": AssetConfig(
        sampler="dpmpp_2m",
        scheduler="karras",
        cfg=7.5,
        steps=32,
        width=832, height=1216,
        reconstruction="ORGANIC",
        batch_size=2,
        prompt_keywords=["single character design", "one character", "full body", "game character", "centered", "isolated on pure white background", "highly detailed", "sharp focus", "professional character art"],
    ),

    "creature": AssetConfig(
        sampler="euler_ancestral",
        scheduler="karras",
        cfg=7.0,
        steps=30,
        width=1024, height=1024,
        reconstruction="ORGANIC",
        batch_size=2,
        prompt_keywords=["single fantasy creature", "one creature", "game monster", "centered", "isolated on pure white background"],
    ),

    "vehicle": AssetConfig(
        sampler="dpm_2_ancestral",
        scheduler="karras",
        cfg=8.0,
        steps=30,
        width=1216, height=832,     # landscape — vehicles are wide
        reconstruction="HARD_SURFACE",
        batch_size=2,
        prompt_keywords=["single game vehicle", "one vehicle", "side view", "centered", "isolated on pure white background"],
    ),

    "building": AssetConfig(
        sampler="dpm_2_ancestral",
        scheduler="karras",
        cfg=7.5,
        steps=30,
        width=832, height=1216,
        reconstruction="HARD_SURFACE",
        batch_size=2,
        prompt_keywords=["single game building", "one building", "architectural", "centered", "isolated on pure white background"],
    ),

    "dungeon_tile": AssetConfig(
        sampler="dpm_2_ancestral",
        scheduler="karras",
        cfg=7.5,
        steps=30,
        width=1024, height=1024,
        reconstruction="HARD_SURFACE",
        batch_size=2,
        prompt_keywords=["single dungeon tile", "one tile", "top-down", "modular", "game tile", "centered", "isolated on pure white background"],
    ),

    "environment": AssetConfig(
        sampler="euler_ancestral",
        scheduler="karras",
        cfg=6.0,
        steps=30,
        width=1216, height=832,
        reconstruction="NONE",
        batch_size=2,
        prompt_keywords=["environment concept art", "game environment", "wide shot"],
    ),

    "foliage": AssetConfig(
        sampler="euler_ancestral",
        scheduler="karras",
        cfg=6.0,
        steps=22,
        width=1024, height=1024,
        reconstruction="ORGANIC",
        batch_size=2,
        prompt_keywords=["single game foliage", "one plant", "plant asset", "centered", "isolated on pure white background", "vegetation"],
    ),

    "tileable_texture": AssetConfig(
        sampler="euler_ancestral",
        scheduler="normal",
        cfg=6.0,
        steps=20,
        width=1024, height=1024,
        reconstruction="NONE",
        batch_size=2,
        prompt_keywords=["seamless texture", "tileable", "game texture", "PBR material"],
    ),

    "skybox": AssetConfig(
        sampler="euler_ancestral",
        scheduler="karras",
        cfg=6.0,
        steps=30,
        width=1024, height=512,     # panoramic aspect
        reconstruction="NONE",
        batch_size=1,
        prompt_keywords=["skybox", "panoramic sky", "360 sky", "game background"],
    ),

    "vfx_element": AssetConfig(
        sampler="euler_ancestral",
        scheduler="karras",
        cfg=6.0,
        steps=20,
        width=1024, height=1024,
        reconstruction="NONE",
        skip_smelting=True,
        batch_size=2,
        prompt_keywords=["vfx element", "particle effect", "transparent background", "game effect"],
    ),

    "ui_icon": AssetConfig(
        sampler="dpm_2",
        scheduler="karras",
        cfg=7.5,
        steps=30,
        width=1024, height=1024,
        reconstruction="NONE",
        batch_size=4,           # icons are fast enough for batch 4
        prompt_keywords=["game ui icon", "item icon", "clean icon", "white background"],
    ),

    "logo": AssetConfig(
        sampler="dpm_2",
        scheduler="karras",
        cfg=8.0,
        steps=28,
        width=1024, height=1024,
        reconstruction="NONE",
        batch_size=2,
        prompt_keywords=["logo design", "vector style", "clean", "white background"],
    ),

    "concept_art": AssetConfig(
        sampler="euler_ancestral",
        scheduler="karras",
        cfg=6.0,
        steps=28,
        width=1216, height=832,
        reconstruction="NONE",
        batch_size=2,
        prompt_keywords=["concept art", "game concept", "detailed illustration"],
    ),

    "sprite": AssetConfig(
        sampler="dpm_2",
        scheduler="karras",
        cfg=7.5,
        steps=30,
        width=1024, height=1024,
        reconstruction="NONE",
        skip_smelting=True,
        batch_size=2,
        prompt_keywords=["sprite", "game sprite", "transparent background", "2d game art"],
    ),
}


def get_config(asset_type: str) -> AssetConfig:
    """Returns the AssetConfig for the given type, defaulting to 'prop'."""
    return ASSET_CONFIGS.get(asset_type, ASSET_CONFIGS["prop"])


def list_asset_types() -> list[str]:
    return list(ASSET_CONFIGS.keys())
