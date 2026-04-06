"""
inference/engine.py — SDXL inference via diffusers.

Loads Juggernaut-XL (or any SDXL checkpoint) directly on the GPU,
runs diffusion sampling in-process, and returns PIL images.

Features:
  - Direct VRAM control             (explicit load/unload)
  - Per-step progress callbacks
  - LoRA support
  - Shared seed multi-view generation

Architecture:
  ForgeEngine is a singleton that holds the loaded pipeline.
  Only one model lives in VRAM at a time — call unload() between stages
  if you need to free memory for depth estimation or reconstruction.

Usage:
    from inference.engine import ForgeEngine

    engine = ForgeEngine.get()
    images = engine.txt2img(prompt="fantasy sword", steps=25)
    engine.unload()  # free VRAM
"""
from __future__ import annotations

import logging
import os
import random
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# ── Model paths ───────────────────────────────────────────────

_APPDATA = Path(os.environ.get("APPDATA", str(Path.home())))
_CKPT_NAME = "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"

_DEFAULT_CKPT_SEARCH = [
    _APPDATA / "IterForge" / "models" / "checkpoints" / _CKPT_NAME,
]

def _find_checkpoint() -> str:
    """Locate the SDXL checkpoint, preferring env var override."""
    env_path = os.environ.get("INTERFORGE_SDXL_CHECKPOINT")
    if env_path:
        return env_path

    for p in _DEFAULT_CKPT_SEARCH:
        if p.exists():
            return str(p)

    # Fallback: download from HuggingFace
    return "stabilityai/stable-diffusion-xl-base-1.0"


# ── Progress callback type ────────────────────────────────────
# (step_index, total_steps, latent_preview_or_none)
ProgressCallback = Callable[[int, int, Optional[Image.Image]], None]


def log_vram(label: str = "") -> None:
    """Log current GPU memory usage at key boundaries."""
    try:
        import torch
        if torch.cuda.is_available():
            alloc = torch.cuda.memory_allocated() / 1024**3
            reserved = torch.cuda.memory_reserved() / 1024**3
            log.info(f"[vram] {label} allocated={alloc:.2f}GB reserved={reserved:.2f}GB")
    except Exception:
        pass


def _cuda_safe_cleanup() -> None:
    """Emergency GPU cleanup after a CUDA error."""
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
    except Exception:
        pass


# ── Singleton engine ──────────────────────────────────────────

class ForgeEngine:
    """
    Direct SDXL inference engine.  Singleton pattern — use ForgeEngine.get().
    """

    _instance: Optional["ForgeEngine"] = None

    def __init__(self):
        self._pipe = None
        self._device = None
        self._checkpoint_path: str = ""

    @classmethod
    def get(cls) -> "ForgeEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_loaded(self) -> bool:
        return self._pipe is not None

    # ── Load / Unload ────────────────────────────────────────

    def load(self, checkpoint: Optional[str] = None) -> None:
        """Load the SDXL pipeline into VRAM."""
        if self._pipe is not None:
            return  # already loaded

        import torch
        from diffusers import StableDiffusionXLPipeline

        ckpt = checkpoint or _find_checkpoint()
        self._checkpoint_path = ckpt
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if self._device == "cuda" else torch.float32

        log.info(f"[engine] Loading SDXL pipeline from {ckpt} on {self._device}…")

        if ckpt.endswith(".safetensors") or ckpt.endswith(".ckpt"):
            self._pipe = StableDiffusionXLPipeline.from_single_file(
                ckpt,
                torch_dtype=dtype,
                use_safetensors=ckpt.endswith(".safetensors"),
            )
        else:
            self._pipe = StableDiffusionXLPipeline.from_pretrained(
                ckpt,
                torch_dtype=dtype,
                variant="fp16" if dtype == torch.float16 else None,
            )

        # VRAM management: cpu_offload keeps only the active component on GPU
        # Critical for ≤8GB cards — peak drops from ~11GB to ~5GB
        if self._device == "cuda":
            self._pipe.enable_model_cpu_offload()
            self._pipe.enable_vae_slicing()
            self._pipe.enable_vae_tiling()
            log.info("[engine] Model CPU offload + VAE slicing/tiling enabled")
        else:
            self._pipe = self._pipe.to(self._device)

        log.info("[engine] SDXL pipeline loaded and ready")
        log_vram("after SDXL load")

    def unload(self) -> None:
        """Free VRAM by unloading the pipeline."""
        if self._pipe is not None:
            del self._pipe
            self._pipe = None
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            log.info("[engine] Pipeline unloaded, VRAM freed")
            log_vram("after unload")

    # ── Text-to-Image (Prospect) ─────────────────────────────

    def txt2img(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 25,
        cfg_scale: float = 6.5,
        seed: int = -1,
        batch_size: int = 2,
        scheduler: str = "euler_a",
        on_progress: Optional[ProgressCallback] = None,
    ) -> list[Image.Image]:
        """
        Generate images from text prompt (Prospecting stage).

        Returns list of PIL Images (batch_size items).
        """
        if self._pipe is None:
            self.load()

        import torch
        from diffusers import (
            EulerAncestralDiscreteScheduler,
            DPMSolverMultistepScheduler,
            EulerDiscreteScheduler,
        )

        # Set scheduler
        sched_map = {
            "euler_a":        EulerAncestralDiscreteScheduler,
            "euler_ancestral": EulerAncestralDiscreteScheduler,
            "euler":          EulerDiscreteScheduler,
            "dpm_2_ancestral": EulerAncestralDiscreteScheduler,  # closest match
            "dpmpp_2m":       DPMSolverMultistepScheduler,
            "dpm_2":          DPMSolverMultistepScheduler,
        }
        sched_cls = sched_map.get(scheduler, EulerAncestralDiscreteScheduler)
        self._pipe.scheduler = sched_cls.from_config(self._pipe.scheduler.config)

        # Seed
        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        generator = torch.Generator(device="cpu").manual_seed(seed)

        # Progress callback adapter
        def _callback(pipe, step_index, timestep, callback_kwargs):
            if on_progress:
                on_progress(step_index + 1, steps, None)
            return callback_kwargs

        log.info(f"[engine] txt2img: {steps} steps, {width}×{height}, batch={batch_size}, seed={seed}")

        try:
            with torch.inference_mode():
                result = self._pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    guidance_scale=cfg_scale,
                    num_images_per_prompt=batch_size,
                    generator=generator,
                    callback_on_step_end=_callback,
                )
        except RuntimeError as exc:
            _cuda_safe_cleanup()
            self._pipe = None
            raise RuntimeError(f"GPU error during txt2img — engine reset: {exc}") from exc

        return result.images



# ── Convenience ───────────────────────────────────────────────

def get_engine() -> ForgeEngine:
    """Shortcut for ForgeEngine.get()."""
    return ForgeEngine.get()
