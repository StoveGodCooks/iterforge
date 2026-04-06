"""
GET /api/masterforge/describe?asset_type=weapon&art_style=painterly
GET /api/masterforge/asset-types
GET /api/masterforge/styles
GET /api/masterforge/lighting-presets

Read-only introspection endpoints so the frontend can inspect what
MasterForge will do for any asset_type + art_style combination.
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from masterforge.asset_configs import get_config, list_asset_types
from masterforge.style_modifiers import list_styles, apply_style
from masterforge.lighting_presets import list_presets

router = APIRouter(prefix="/api/masterforge")


@router.get("/asset-types")
def asset_types():
    return list_asset_types()


@router.get("/styles")
def styles():
    return list_styles()


@router.get("/lighting-presets")
def lighting_presets():
    return list_presets()


@router.get("/describe")
def describe(
    asset_type: str = Query("prop"),
    art_style:  str = Query("stylized"),
):
    """Describe the generation config for a given asset_type + art_style."""
    cfg = get_config(asset_type)
    styled = apply_style(
        base_cfg=cfg.cfg,
        base_steps=cfg.steps,
        base_sampler=cfg.sampler,
        base_scheduler=cfg.scheduler,
        art_style=art_style,
        user_prompt="(preview)",
    )
    return {
        "asset_type":      asset_type,
        "art_style":       art_style,
        "resolution":      f"{cfg.width}x{cfg.height}",
        "width":           cfg.width,
        "height":          cfg.height,
        "steps":           styled.get("steps", cfg.steps),
        "cfg":             styled.get("cfg", cfg.cfg),
        "sampler":         styled.get("sampler", cfg.sampler),
        "scheduler":       styled.get("scheduler", cfg.scheduler),
        "batch_size":      cfg.batch_size,
        "reconstruction":  cfg.reconstruction,
        "prompt_keywords":  cfg.prompt_keywords,
    }
