"""
Unit tests — MasterForge rules engine.
No network calls, no external dependencies.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from masterforge.asset_configs import get_config, list_asset_types, ASSET_CONFIGS
from masterforge.style_modifiers import apply_style, list_styles
from masterforge.negative_prompts import get_negative
from masterforge.lighting_presets import get_lighting_tokens
# ── Valid diffusers sampler names ────────────────────────────────
VALID_SAMPLERS = {
    "euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral",
    "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde",
    "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
    "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ddim", "uni_pc",
    "uni_pc_bh2",
}

VALID_SCHEDULERS = {
    "normal", "karras", "exponential", "sgm_uniform", "simple",
    "ddim_uniform", "beta",
}

SDXL_VALID_DIMS = {512, 640, 768, 832, 896, 960, 1024, 1152, 1216, 1344, 1536}


# ═══════════════════════════════════════════════════════════════
# Asset Configs
# ═══════════════════════════════════════════════════════════════

class TestAssetConfigs:

    def test_all_17_types_exist(self):
        types = list_asset_types()
        assert len(types) == 17, f"Expected 17 asset types, got {len(types)}: {types}"

    def test_unknown_type_returns_prop_default(self):
        cfg = get_config("__nonexistent__")
        default = get_config("prop")
        assert cfg.width  == default.width
        assert cfg.height == default.height

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_config_sampler_valid(self, asset_type):
        cfg = get_config(asset_type)
        assert cfg.sampler in VALID_SAMPLERS, (
            f"{asset_type}: sampler '{cfg.sampler}' not in valid samplers"
        )

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_config_scheduler_valid(self, asset_type):
        cfg = get_config(asset_type)
        assert cfg.scheduler in VALID_SCHEDULERS, (
            f"{asset_type}: scheduler '{cfg.scheduler}' not in valid schedulers"
        )

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_config_resolution_sdxl(self, asset_type):
        cfg = get_config(asset_type)
        assert cfg.width  in SDXL_VALID_DIMS, f"{asset_type}: width {cfg.width} not SDXL-valid"
        assert cfg.height in SDXL_VALID_DIMS, f"{asset_type}: height {cfg.height} not SDXL-valid"
        total_pixels = cfg.width * cfg.height
        assert 256_000 <= total_pixels <= 1_600_000, (
            f"{asset_type}: resolution {cfg.width}x{cfg.height} = {total_pixels}px "
            f"outside SDXL safe range"
        )

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_config_cfg_range(self, asset_type):
        cfg = get_config(asset_type)
        assert 1.0 <= cfg.cfg <= 20.0, f"{asset_type}: cfg {cfg.cfg} out of range"

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_config_steps_range(self, asset_type):
        cfg = get_config(asset_type)
        assert 10 <= cfg.steps <= 60, f"{asset_type}: steps {cfg.steps} out of range"

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_config_batch_size(self, asset_type):
        cfg = get_config(asset_type)
        assert 1 <= cfg.batch_size <= 8, f"{asset_type}: batch_size {cfg.batch_size} invalid"

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_config_reconstruction_valid(self, asset_type):
        cfg = get_config(asset_type)
        assert cfg.reconstruction in ("ORGANIC", "HARD_SURFACE", "NONE"), (
            f"{asset_type}: reconstruction '{cfg.reconstruction}' not valid"
        )


# ═══════════════════════════════════════════════════════════════
# Style Modifiers
# ═══════════════════════════════════════════════════════════════

class TestStyleModifiers:

    def test_list_styles_returns_list(self):
        styles = list_styles()
        assert isinstance(styles, list)
        assert len(styles) > 0

    @pytest.mark.parametrize("style", [
        "painterly", "pixel_art", "low_poly", "realistic",
        "stylized", "sketch", "cel_shaded", "isometric",
    ])
    def test_apply_style_returns_required_keys(self, style):
        result = apply_style(
            base_cfg=6.5, base_steps=25,
            base_sampler="euler_ancestral", base_scheduler="karras",
            art_style=style, user_prompt="test prompt",
        )
        assert "prompt"    in result
        assert "cfg"       in result
        assert "steps"     in result
        assert "sampler"   in result
        assert "scheduler" in result

    def test_unknown_style_returns_unchanged(self):
        result = apply_style(
            base_cfg=6.5, base_steps=25,
            base_sampler="euler_ancestral", base_scheduler="karras",
            art_style="__unknown__", user_prompt="test",
        )
        assert result["cfg"]   == 6.5
        assert result["steps"] == 25

    @pytest.mark.parametrize("style", [
        "painterly", "pixel_art", "low_poly", "realistic",
        "stylized", "sketch", "cel_shaded", "isometric",
    ])
    def test_apply_style_sampler_valid(self, style):
        result = apply_style(
            base_cfg=6.5, base_steps=25,
            base_sampler="euler_ancestral", base_scheduler="karras",
            art_style=style, user_prompt="test",
        )
        assert result["sampler"] in VALID_SAMPLERS, (
            f"style '{style}' produced invalid sampler '{result['sampler']}'"
        )


# ═══════════════════════════════════════════════════════════════
# Negative Prompts
# ═══════════════════════════════════════════════════════════════

class TestNegativePrompts:

    @pytest.mark.parametrize("asset_type", list_asset_types())
    def test_negative_is_nonempty_string(self, asset_type):
        neg = get_negative(asset_type)
        assert isinstance(neg, str)
        assert len(neg) > 10, f"{asset_type}: negative prompt too short: '{neg}'"

    def test_unknown_type_has_fallback(self):
        neg = get_negative("__unknown__")
        assert isinstance(neg, str)
        assert len(neg) > 0
