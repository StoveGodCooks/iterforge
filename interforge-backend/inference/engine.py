"""
inference/engine.py — SDXL inference via diffusers.

Loads DreamShaper-XL (or any SDXL checkpoint) directly on the GPU,
runs diffusion sampling in-process, and returns PIL images.

Features:
  - Direct VRAM control             (explicit load/unload)
  - Per-step progress callbacks
  - IP-Adapter identity conditioning (2D direction generation)
  - LoRA support
  - Shared seed multi-view generation

Architecture:
  ForgeEngine is a singleton that holds the loaded pipeline.
  Only one model lives in VRAM at a time — call unload() between stages
  if you need to free memory for depth estimation or reconstruction.

  Device placement (cpu_offload) is deferred until the first generate call
  via _ensure_device_ready().  This guarantees that ALL components
  (base pipeline + IP-Adapter + any future adapters) are registered with
  the offload hooks before any inference happens.

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
_CKPT_NAME = "DreamShaperXL_v2_1.safetensors"

_DEFAULT_CKPT_SEARCH = [
    _APPDATA / "IterForge" / "models" / "checkpoints" / _CKPT_NAME,
    # Legacy fallback — Juggernaut XL still works if user hasn't swapped yet
    _APPDATA / "IterForge" / "models" / "checkpoints" / "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors",
]

def _find_checkpoint() -> str:
    """
    Resolve the SDXL model for the 8GB tier.

    Default = Samaritan 3D Cartoon (stylized, matte) — the SF3D-friendly baseline.
    A realism checkpoint (DreamShaper/Juggernaut) bakes shadows and specular gloss
    that SF3D misreads as geometry, so the stylized model is the mesh-pipeline default.

    Overrides: INTERFORGE_SDXL_CHECKPOINT (explicit path/id) or a local
    Samaritan .safetensors dropped in the checkpoints dir; INTERFORGE_SDXL_MODEL
    swaps the default model id (e.g. a higher tier's checkpoint).
    """
    env_path = os.environ.get("INTERFORGE_SDXL_CHECKPOINT")
    if env_path:
        return env_path

    local_sam = _APPDATA / "IterForge" / "models" / "checkpoints" / "Samaritan-3d-Cartoon-v4.safetensors"
    if local_sam.exists():
        return str(local_sam)

    return os.environ.get("INTERFORGE_SDXL_MODEL", "imagepipeline/Samaritan-3d-Cartoon-v4-SDXL")


# ── Scheduler helpers ────────────────────────────────────────

def _get_scheduler_cls(name: str):
    """Resolve a scheduler name to a diffusers scheduler class."""
    from diffusers import (
        EulerAncestralDiscreteScheduler,
        DPMSolverMultistepScheduler,
        EulerDiscreteScheduler,
    )
    _MAP = {
        "euler_a":         EulerAncestralDiscreteScheduler,
        "euler_ancestral": EulerAncestralDiscreteScheduler,
        "euler":           EulerDiscreteScheduler,
        "dpm_2_ancestral": EulerAncestralDiscreteScheduler,
        "dpmpp_2m":        DPMSolverMultistepScheduler,
        "dpm_2":           DPMSolverMultistepScheduler,
    }
    return _MAP.get(name, EulerAncestralDiscreteScheduler)


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

    Load flow (two-phase):
      1. load()            → loads pipeline weights into RAM (no device hooks yet)
      2. load_ip_adapter() → optional: adds IP-Adapter weights (still no hooks)
      3. _ensure_device()  → called automatically by generate methods.
                             Sets up enable_model_cpu_offload() ONCE with
                             ALL components present. Idempotent.

    This guarantees that the offload hooks always cover every component
    (UNet, text encoders, VAE, AND image_encoder if IP-Adapter is loaded).
    """

    _instance: Optional["ForgeEngine"] = None

    def __init__(self):
        self._pipe = None
        self._device: Optional[str] = None
        self._dtype = None
        self._checkpoint_path: str = ""
        self._ip_adapter_loaded: bool = False
        self._device_ready: bool = False  # True once offload hooks are set
        self._controlnet_openpose = None   # ControlNetModel, lazy-loaded

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
        """
        Phase 1: Load the SDXL pipeline weights into system RAM.

        Does NOT set up device placement or offload hooks — that happens
        lazily in _ensure_device() so adapters can be loaded first.
        """
        if self._pipe is not None:
            return  # already loaded

        import torch
        from diffusers import StableDiffusionXLPipeline

        ckpt = checkpoint or _find_checkpoint()
        self._checkpoint_path = ckpt
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._dtype = torch.float16 if self._device == "cuda" else torch.float32

        log.info(f"[engine] Loading SDXL pipeline from {ckpt}…")

        if ckpt.endswith(".safetensors") or ckpt.endswith(".ckpt"):
            self._pipe = StableDiffusionXLPipeline.from_single_file(
                ckpt,
                torch_dtype=self._dtype,
                use_safetensors=ckpt.endswith(".safetensors"),
            )
        else:
            self._pipe = StableDiffusionXLPipeline.from_pretrained(
                ckpt,
                torch_dtype=self._dtype,
                variant="fp16" if self._dtype.is_floating_point else None,
            )

        # Pipeline is in RAM but NOT on any device yet.
        # _ensure_device() will handle placement before first inference.
        self._device_ready = False

        log.info("[engine] SDXL pipeline loaded into RAM (device placement deferred)")
        log_vram("after load (before device placement)")

    def _ensure_device(self) -> None:
        """
        Phase 2: Set up device placement and VRAM management.

        Called automatically before every generate call.  Idempotent —
        skips if already set up.  Must be called AFTER all adapters
        (IP-Adapter, LoRA, etc.) are loaded so their components get
        registered with the offload hooks.
        """
        if self._device_ready:
            return
        if self._pipe is None:
            raise RuntimeError("Pipeline not loaded — call load() first")

        log.info("[engine] Setting up device placement…")

        if self._device == "cuda":
            # Remove any stale hooks from a previous _ensure_device() call
            # (e.g. if we added IP-Adapter and need to re-register)
            try:
                self._pipe.remove_all_hooks()
            except Exception:
                pass

            # enable_model_cpu_offload registers a hook for each component
            # in _model_cpu_offload_seq.  For SDXL this includes:
            #   text_encoder → text_encoder_2 → image_encoder → unet → vae
            # Because we deferred this call, image_encoder is present
            # (if IP-Adapter was loaded) and WILL get a hook.
            self._pipe.enable_model_cpu_offload()
            self._pipe.enable_vae_slicing()
            self._pipe.enable_vae_tiling()
            log.info(
                f"[engine] CPU offload enabled — components: "
                f"pipe has image_encoder={self._pipe.image_encoder is not None}"
            )
        else:
            self._pipe = self._pipe.to(self._device)

        self._device_ready = True
        log_vram("after device placement")

    def unload(self) -> None:
        """Free VRAM by unloading the entire pipeline."""
        if self._pipe is not None:
            try:
                self._pipe.remove_all_hooks()
            except Exception:
                pass
            del self._pipe
            self._pipe = None
            self._ip_adapter_loaded = False
            self._device_ready = False
            if self._controlnet_openpose is not None:
                del self._controlnet_openpose
                self._controlnet_openpose = None
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            log.info("[engine] Pipeline unloaded, VRAM freed")
            log_vram("after unload")

    # ── IP-Adapter ───────────────────────────────────────────

    def load_ip_adapter(self) -> None:
        """
        Load IP-Adapter weights into the SDXL pipeline.

        Downloads ~670MB on first use (cached in ~/.cache/huggingface/).
        Uses the base SDXL adapter which matches the pipeline's built-in
        OpenCLIP ViT-bigG/14 encoder (1280-dim).  No separate image
        encoder download needed — SDXL already has it.

        MUST be called BEFORE _ensure_device() (which happens automatically
        before the first generate call).  If called after device setup,
        we invalidate the device state so it gets re-registered.
        """
        if self._ip_adapter_loaded:
            return
        if self._pipe is None:
            self.load()

        log.info("[engine] Loading IP-Adapter (SDXL base)…")
        log_vram("before IP-Adapter load")

        # Use the base adapter — NOT the vit-h variant.
        # SDXL's built-in encoder is OpenCLIP ViT-bigG (1280-dim).
        # ip-adapter_sdxl.safetensors matches this encoder.
        # ip-adapter_sdxl_vit-h.safetensors expects ViT-H (1024-dim) → shape mismatch.
        self._pipe.load_ip_adapter(
            "h94/IP-Adapter",
            subfolder="sdxl_models",
            weight_name="ip-adapter_sdxl.safetensors",
        )

        # Invalidate device setup so _ensure_device() re-runs
        # with the new image_encoder component included.
        self._device_ready = False

        self._ip_adapter_loaded = True
        log.info("[engine] IP-Adapter loaded — device placement will re-register")
        log_vram("after IP-Adapter load")

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

        # A prior SPRITE job may have left IP-Adapter resident on the shared
        # UNet (warm singleton). That sets encoder_hid_dim_type='ip_image_proj',
        # so plain text-only generation crashes demanding `image_embeds`. Strip
        # it here; the next Smelt re-loads it from cache in ~1s.
        if self._ip_adapter_loaded:
            log.info("[engine] txt2img: unloading resident IP-Adapter for text-only generation")
            try:
                self._pipe.unload_ip_adapter()
            except Exception as exc:  # noqa: BLE001 — best-effort cleanup
                log.warning(f"[engine] unload_ip_adapter failed, neutralizing manually: {exc}")
                # Fallback: drop the projection so the UNet stops demanding image_embeds.
                try:
                    self._pipe.unet.encoder_hid_proj = None
                    self._pipe.unet.config.encoder_hid_dim_type = None
                except Exception:
                    pass
            self._ip_adapter_loaded = False
            self._device_ready = False  # image_encoder removed → re-register placement

        self._ensure_device()

        import torch

        self._pipe.scheduler = _get_scheduler_cls(scheduler).from_config(
            self._pipe.scheduler.config
        )

        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        generator = torch.Generator(device="cpu").manual_seed(seed)

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
            self._emergency_reset()
            raise RuntimeError(f"GPU error during txt2img — engine reset: {exc}") from exc

        return result.images

    # ── IP-Adapter Generate (2D Directions) ──────────────────

    def generate_with_reference(
        self,
        reference_image: "Image.Image",
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 30,
        cfg_scale: float = 7.5,
        ip_adapter_scale: float = 0.6,
        seed: int = -1,
        scheduler: str = "dpmpp_2m",
        on_progress: Optional[ProgressCallback] = None,
    ) -> "Image.Image":
        """
        Generate an image using txt2img + IP-Adapter identity conditioning.

        The reference image provides CHARACTER IDENTITY (face, outfit,
        proportions) while the text prompt controls POSE and DIRECTION.
        Unlike img2img, there is no spatial lock — the model generates
        the composition freely from the prompt.

        ip_adapter_scale controls the identity↔prompt balance:
          0.4–0.5 → more prompt freedom (stronger direction changes)
          0.6–0.7 → more identity match (less character drift)
          0.8+    → very strong identity lock (may fight prompt)

        Returns a single PIL Image.
        """
        if self._pipe is None:
            self.load()
        if not self._ip_adapter_loaded:
            self.load_ip_adapter()

        # _ensure_device() runs AFTER IP-Adapter is loaded,
        # so enable_model_cpu_offload() covers image_encoder.
        self._ensure_device()

        import torch

        self._pipe.set_ip_adapter_scale(ip_adapter_scale)
        self._pipe.scheduler = _get_scheduler_cls(scheduler).from_config(
            self._pipe.scheduler.config
        )

        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        generator = torch.Generator(device="cpu").manual_seed(seed)

        def _callback(pipe, step_index, timestep, callback_kwargs):
            if on_progress:
                on_progress(step_index + 1, steps, None)
            return callback_kwargs

        log.info(
            f"[engine] IP-Adapter generate: {steps} steps, {width}×{height}, "
            f"scale={ip_adapter_scale}, seed={seed}"
        )

        try:
            with torch.inference_mode():
                result = self._pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    ip_adapter_image=reference_image,
                    width=width,
                    height=height,
                    num_inference_steps=steps,
                    guidance_scale=cfg_scale,
                    num_images_per_prompt=1,
                    generator=generator,
                    callback_on_step_end=_callback,
                )
        except RuntimeError as exc:
            self._emergency_reset()
            raise RuntimeError(
                f"GPU error during IP-Adapter generate — engine reset: {exc}"
            ) from exc

        return result.images[0]

    # ── Image-to-Image (legacy fallback) ─────────────────────

    def img2img(
        self,
        init_image: "Image.Image",
        prompt: str,
        negative_prompt: str = "",
        strength: float = 0.55,
        steps: int = 30,
        cfg_scale: float = 7.0,
        seed: int = -1,
        scheduler: str = "euler_a",
        on_progress: Optional[ProgressCallback] = None,
        ip_adapter_image: Optional["Image.Image"] = None,
        ip_adapter_scale: float = 0.0,
    ) -> "Image.Image":
        """
        Generate a directional sprite from an existing image.

        Builds StableDiffusionXLImg2ImgPipeline from the already-loaded
        txt2img components — no second model load, no extra VRAM.

        ip_adapter_image: when IP-Adapter was previously loaded onto the
            base pipe, the UNet config (``encoder_hid_dim_type``) requires
            ``image_embeds`` on every forward pass — including img2img. Pass
            the reference image here to satisfy that contract; use
            ``ip_adapter_scale=0`` for pure-spatial-lock behavior. If the
            IP-Adapter isn't loaded, this argument is ignored.

        Returns a single PIL Image.
        """
        if self._pipe is None:
            self.load()
        self._ensure_device()

        import torch
        from diffusers import StableDiffusionXLImg2ImgPipeline

        # Reuse loaded weights — no extra VRAM cost
        img2img_pipe = StableDiffusionXLImg2ImgPipeline(**self._pipe.components)
        img2img_pipe.scheduler = _get_scheduler_cls(scheduler).from_config(
            img2img_pipe.scheduler.config
        )

        # If IP-Adapter was previously loaded on the shared UNet, the config
        # demands image_embeds on every call. Supply the caller's reference
        # (or the init_image itself as a last resort) and pin the scale so
        # img2img stays spatial-lock-dominant.
        if self._ip_adapter_loaded:
            if ip_adapter_image is None:
                ip_adapter_image = init_image
            try:
                self._pipe.set_ip_adapter_scale(ip_adapter_scale)
            except Exception:
                pass

        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        generator = torch.Generator(device="cpu").manual_seed(seed)

        def _callback(pipe, step_index, timestep, callback_kwargs):
            if on_progress:
                on_progress(step_index + 1, steps, None)
            return callback_kwargs

        log.info(f"[engine] img2img: strength={strength}, steps={steps}, seed={seed}")

        pipe_kwargs: dict = dict(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image=init_image,
            strength=strength,
            num_inference_steps=steps,
            guidance_scale=cfg_scale,
            num_images_per_prompt=1,
            generator=generator,
            callback_on_step_end=_callback,
        )
        if ip_adapter_image is not None:
            pipe_kwargs["ip_adapter_image"] = ip_adapter_image

        try:
            with torch.inference_mode():
                result = img2img_pipe(**pipe_kwargs)
        except RuntimeError as exc:
            self._emergency_reset()
            raise RuntimeError(f"GPU error during img2img — engine reset: {exc}") from exc

        return result.images[0]

    # ── ControlNet OpenPose (Sprite Sheet) ───────────────────

    def load_controlnet_openpose(self) -> None:
        """
        Load the ControlNet-OpenPose-SDXL model into RAM.

        Downloads ~2.5GB on first run (cached in ~/.cache/huggingface/).
        The ControlNet is held as a separate module; we instantiate the
        combined StableDiffusionXLControlNetPipeline per-call from the
        base pipe's components so we don't double VRAM.
        """
        if self._controlnet_openpose is not None:
            return
        if self._pipe is None:
            self.load()

        import torch
        from diffusers import ControlNetModel

        log.info("[engine] Loading ControlNet OpenPose SDXL…")
        log_vram("before ControlNet load")

        # Prefer the Setup-Wizard-managed local copy if present; otherwise
        # fall back to huggingface_hub's cache via repo id.
        local_dir = _APPDATA / "IterForge" / "models" / "controlnet" / "openpose-sdxl"
        env_override = os.environ.get("INTERFORGE_CONTROLNET_OPENPOSE")
        if env_override:
            ckpt = env_override
        elif (local_dir / "config.json").exists():
            ckpt = str(local_dir)
        else:
            # xinsir's OpenPose SDXL has markedly stronger pose adherence than
            # thibaud's (the previous default) — stances thibaud ignored at
            # cn=0.85, xinsir locks at 0.5–0.7. Drop-in ControlNetModel.
            ckpt = "xinsir/controlnet-openpose-sdxl-1.0"

        # torch_dtype handles any needed cast to fp16 on load. Do not pass
        # variant="fp16" — these repos don't all ship a separate fp16 variant.
        self._controlnet_openpose = ControlNetModel.from_pretrained(
            ckpt,
            torch_dtype=self._dtype,
        )

        # Freshly loaded — not yet on device. Invalidate device state so
        # the next generate call re-runs offload registration with the
        # ControlNet included.
        self._device_ready = False

        log.info("[engine] ControlNet OpenPose loaded")
        log_vram("after ControlNet load")

    def generate_with_pose_and_reference(
        self,
        reference_image: "Image.Image",
        pose_image: "Image.Image",
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 30,
        cfg_scale: float = 7.5,
        ip_adapter_scale: float = 0.55,
        controlnet_scale: float = 0.85,
        seed: int = -1,
        scheduler: str = "dpmpp_2m",
        on_progress: Optional[ProgressCallback] = None,
    ) -> "Image.Image":
        """
        Generate a sprite with ControlNet-driven pose + IP-Adapter identity.

        The pose_image is an OpenPose skeleton (see core.pose_library); it
        locks the character's stance and viewing direction. The reference
        image preserves identity via IP-Adapter. The text prompt fills in
        the stylistic details that neither skeleton nor reference can
        convey (motion blur, effects, lighting).

        Scales:
          controlnet_scale 0.7–0.9 → strong pose lock, recommended default
          ip_adapter_scale 0.4–0.6 → enough identity without fighting pose

        Returns a single PIL Image.
        """
        if self._pipe is None:
            self.load()
        if not self._ip_adapter_loaded:
            self.load_ip_adapter()
        if self._controlnet_openpose is None:
            self.load_controlnet_openpose()

        import torch
        from diffusers import StableDiffusionXLControlNetPipeline

        # Build the ControlNet pipeline that REUSES the base pipe's components —
        # no duplicate weights, no extra VRAM beyond the ControlNet itself.
        cn_pipe = StableDiffusionXLControlNetPipeline(
            **self._pipe.components,
            controlnet=self._controlnet_openpose,
        )

        # IP-Adapter weights live inside UNet; carrying the same UNet across
        # means the ControlNet pipe also sees the adapter. Set the scale on
        # the shared UNet.
        self._pipe.set_ip_adapter_scale(ip_adapter_scale)

        cn_pipe.scheduler = _get_scheduler_cls(scheduler).from_config(
            cn_pipe.scheduler.config
        )

        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        generator = torch.Generator(device="cpu").manual_seed(seed)

        def _callback(pipe, step_index, timestep, callback_kwargs):
            if on_progress:
                on_progress(step_index + 1, steps, None)
            return callback_kwargs

        # ControlNet expects the pose image at target resolution — resize
        # up front so diffusers doesn't silently stretch it.
        if pose_image.size != (width, height):
            pose_image = pose_image.resize((width, height), Image.LANCZOS)

        log.info(
            f"[engine] ControlNet+IPA generate: {steps} steps, {width}×{height}, "
            f"cn={controlnet_scale}, ipa={ip_adapter_scale}, seed={seed}"
        )

        try:
            with torch.inference_mode():
                if self._device == "cuda":
                    # ── 8GB-aware deterministic placement ──
                    # Accelerate's offload hooks shuttle the UNet/ControlNet
                    # CPU<->GPU every step (~13s/step on a 3070). Instead we
                    # encode the prompt + reference up front with the encoders
                    # briefly on the GPU, move them back to CPU, then run the
                    # denoising loop with UNet + ControlNet + VAE pinned and
                    # pre-computed embeds. The 2.8GB of encoders never occupy
                    # VRAM during the loop, so there are zero per-step transfers
                    # → the loop runs at native GPU speed (~1s/step).
                    for _p in (self._pipe, cn_pipe):
                        try:
                            _p.remove_all_hooks()
                        except Exception:
                            pass

                    dev = "cuda"
                    # Pin the loop models. VAE is the first registered component,
                    # so placing it on cuda also fixes the pipe's execution device.
                    cn_pipe.vae.to(dev)
                    cn_pipe.unet.to(dev)
                    cn_pipe.controlnet.to(dev)

                    # Encode the text prompt (encoders on GPU only for this call).
                    cn_pipe.text_encoder.to(dev)
                    cn_pipe.text_encoder_2.to(dev)
                    (
                        prompt_embeds,
                        negative_prompt_embeds,
                        pooled_prompt_embeds,
                        negative_pooled_prompt_embeds,
                    ) = cn_pipe.encode_prompt(
                        prompt=prompt,
                        prompt_2=None,
                        device=dev,
                        num_images_per_prompt=1,
                        do_classifier_free_guidance=True,
                        negative_prompt=negative_prompt,
                        negative_prompt_2=None,
                    )
                    cn_pipe.text_encoder.to("cpu")
                    cn_pipe.text_encoder_2.to("cpu")

                    # Encode the IP-Adapter reference (image encoder on GPU briefly).
                    if cn_pipe.image_encoder is not None:
                        cn_pipe.image_encoder.to(dev)
                    ip_image_embeds = cn_pipe.prepare_ip_adapter_image_embeds(
                        ip_adapter_image=reference_image,
                        ip_adapter_image_embeds=None,
                        device=dev,
                        num_images_per_prompt=1,
                        do_classifier_free_guidance=True,
                    )
                    if cn_pipe.image_encoder is not None:
                        cn_pipe.image_encoder.to("cpu")
                    torch.cuda.empty_cache()

                    cn_pipe.enable_vae_slicing()
                    cn_pipe.enable_vae_tiling()

                    result = cn_pipe(
                        prompt_embeds=prompt_embeds,
                        negative_prompt_embeds=negative_prompt_embeds,
                        pooled_prompt_embeds=pooled_prompt_embeds,
                        negative_pooled_prompt_embeds=negative_pooled_prompt_embeds,
                        ip_adapter_image_embeds=ip_image_embeds,
                        image=pose_image,
                        controlnet_conditioning_scale=controlnet_scale,
                        width=width,
                        height=height,
                        num_inference_steps=steps,
                        guidance_scale=cfg_scale,
                        num_images_per_prompt=1,
                        generator=generator,
                        callback_on_step_end=_callback,
                    )
                else:
                    cn_pipe = cn_pipe.to(self._device)
                    result = cn_pipe(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        image=pose_image,
                        ip_adapter_image=reference_image,
                        controlnet_conditioning_scale=controlnet_scale,
                        width=width,
                        height=height,
                        num_inference_steps=steps,
                        guidance_scale=cfg_scale,
                        num_images_per_prompt=1,
                        generator=generator,
                        callback_on_step_end=_callback,
                    )
        except RuntimeError as exc:
            self._emergency_reset()
            raise RuntimeError(
                f"GPU error during ControlNet+IPA generate — engine reset: {exc}"
            ) from exc

        return result.images[0]

    def generate_with_pose(
        self,
        pose_image: "Image.Image",
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 30,
        cfg_scale: float = 7.5,
        controlnet_scale: float = 0.85,
        seed: int = -1,
        scheduler: str = "dpmpp_2m",
        on_progress: Optional[ProgressCallback] = None,
    ) -> "Image.Image":
        """
        Generate from a text prompt + OpenPose skeleton, NO IP-Adapter.

        Built for the one-shot tiled sprite sheet: a single composite skeleton
        canvas (several poses laid out in a grid) is denoised in ONE pass, so
        every figure shares identity / costume / lighting by construction.
        Identity comes from the prompt; the skeleton locks each figure's stance.

        Returns a single PIL Image at width×height.
        """
        if self._pipe is None:
            self.load()
        if self._controlnet_openpose is None:
            self.load_controlnet_openpose()

        # ControlNet-only: a resident IP-Adapter would make the shared UNet
        # demand image_embeds we don't supply here. Strip it (as txt2img does).
        if self._ip_adapter_loaded:
            log.info("[engine] generate_with_pose: unloading resident IP-Adapter (ControlNet-only path)")
            try:
                self._pipe.unload_ip_adapter()
            except Exception as exc:  # noqa: BLE001 — best-effort cleanup
                log.warning(f"[engine] unload_ip_adapter failed, neutralizing manually: {exc}")
                try:
                    self._pipe.unet.encoder_hid_proj = None
                    self._pipe.unet.config.encoder_hid_dim_type = None
                except Exception:
                    pass
            self._ip_adapter_loaded = False
            self._device_ready = False

        import torch
        from diffusers import StableDiffusionXLControlNetPipeline

        cn_pipe = StableDiffusionXLControlNetPipeline(
            **self._pipe.components,
            controlnet=self._controlnet_openpose,
        )
        cn_pipe.scheduler = _get_scheduler_cls(scheduler).from_config(
            cn_pipe.scheduler.config
        )

        if seed < 0:
            seed = random.randint(0, 2**32 - 1)
        generator = torch.Generator(device="cpu").manual_seed(seed)

        def _callback(pipe, step_index, timestep, callback_kwargs):
            if on_progress:
                on_progress(step_index + 1, steps, None)
            return callback_kwargs

        if pose_image.size != (width, height):
            pose_image = pose_image.resize((width, height), Image.LANCZOS)

        log.info(
            f"[engine] ControlNet generate (no IPA): {steps} steps, {width}×{height}, "
            f"cn={controlnet_scale}, seed={seed}"
        )

        try:
            with torch.inference_mode():
                if self._device == "cuda":
                    # Same 8GB-aware placement as the IPA path: pin the loop
                    # models, encode the prompt with encoders briefly on GPU,
                    # then move encoders to CPU so the loop runs transfer-free.
                    for _p in (self._pipe, cn_pipe):
                        try:
                            _p.remove_all_hooks()
                        except Exception:
                            pass

                    dev = "cuda"
                    cn_pipe.vae.to(dev)
                    cn_pipe.unet.to(dev)
                    cn_pipe.controlnet.to(dev)
                    cn_pipe.text_encoder.to(dev)
                    cn_pipe.text_encoder_2.to(dev)
                    (
                        prompt_embeds,
                        negative_prompt_embeds,
                        pooled_prompt_embeds,
                        negative_pooled_prompt_embeds,
                    ) = cn_pipe.encode_prompt(
                        prompt=prompt,
                        prompt_2=None,
                        device=dev,
                        num_images_per_prompt=1,
                        do_classifier_free_guidance=True,
                        negative_prompt=negative_prompt,
                        negative_prompt_2=None,
                    )
                    cn_pipe.text_encoder.to("cpu")
                    cn_pipe.text_encoder_2.to("cpu")
                    torch.cuda.empty_cache()

                    cn_pipe.enable_vae_slicing()
                    cn_pipe.enable_vae_tiling()

                    result = cn_pipe(
                        prompt_embeds=prompt_embeds,
                        negative_prompt_embeds=negative_prompt_embeds,
                        pooled_prompt_embeds=pooled_prompt_embeds,
                        negative_pooled_prompt_embeds=negative_pooled_prompt_embeds,
                        image=pose_image,
                        controlnet_conditioning_scale=controlnet_scale,
                        width=width,
                        height=height,
                        num_inference_steps=steps,
                        guidance_scale=cfg_scale,
                        num_images_per_prompt=1,
                        generator=generator,
                        callback_on_step_end=_callback,
                    )
                else:
                    cn_pipe = cn_pipe.to(self._device)
                    result = cn_pipe(
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        image=pose_image,
                        controlnet_conditioning_scale=controlnet_scale,
                        width=width,
                        height=height,
                        num_inference_steps=steps,
                        guidance_scale=cfg_scale,
                        num_images_per_prompt=1,
                        generator=generator,
                        callback_on_step_end=_callback,
                    )
        except RuntimeError as exc:
            self._emergency_reset()
            raise RuntimeError(
                f"GPU error during ControlNet generate — engine reset: {exc}"
            ) from exc

        return result.images[0]

    # ── Internal helpers ─────────────────────────────────────

    def _emergency_reset(self) -> None:
        """Clean up after a GPU error — free everything."""
        _cuda_safe_cleanup()
        try:
            self._pipe.remove_all_hooks()
        except Exception:
            pass
        self._pipe = None
        self._ip_adapter_loaded = False
        self._device_ready = False
        self._controlnet_openpose = None


# ── Convenience ───────────────────────────────────────────────

def get_engine() -> ForgeEngine:
    """Shortcut for ForgeEngine.get()."""
    return ForgeEngine.get()
