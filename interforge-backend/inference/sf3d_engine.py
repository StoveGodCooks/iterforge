"""
inference/sf3d_engine.py — Stable Fast 3D (SF3D) single-image → textured mesh engine.

Replaces the Zero123++ + visual-hull reconstruction chain. Takes ONE image
(the locked prospect) and returns a UV-unwrapped, PBR-textured trimesh.Trimesh
in a few seconds. Runs GPU-primary (~6.5GB peak on an RTX 3070); only the
texture bake overflows to CPU because the extension is built without CUDA.

Model:  stabilityai/stable-fast-3d  (Stability AI Community License — free for
        commercial use under $1M/yr revenue; outputs are yours. See vendor/
        stable-fast-3d/LICENSE.md.)

Singleton, mirroring ForgeEngine / Zero123Engine:
    from inference.sf3d_engine import SF3DEngine
    eng = SF3DEngine.get()
    mesh = eng.generate_mesh(pil_image)   # trimesh.Trimesh (textured GLB-ready)
    eng.offload()   # push weights to CPU RAM (GPU-primary / CPU-overflow arbiter)
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# Vendored SF3D source (the `sf3d` package lives here).
_VENDOR = Path(__file__).resolve().parent.parent / "vendor" / "stable-fast-3d"
_MODEL_ID = os.environ.get("INTERFORGE_SF3D_MODEL", "stabilityai/stable-fast-3d")

_shims_applied = False


def _apply_compat_shims() -> None:
    """
    SF3D was written against transformers 4.42 / numpy 1.26. InterForge runs
    transformers 5.x / numpy 2.x. These four tiny shims bridge the gap and MUST
    run before `import sf3d`. Proven necessary+sufficient by the Phase 15.0 spike.
    """
    global _shims_applied
    if _shims_applied:
        return

    import numpy as np
    import torch

    # 1. numpy 2.0 removed these aliases; gpytoolbox (an SF3D dep) still uses them.
    for _name, _val in (
        ("Inf", np.inf), ("infty", np.inf), ("NaN", np.nan), ("NAN", np.nan),
        ("float_", np.float64), ("int_", np.int64), ("bool8", np.bool_),
    ):
        if not hasattr(np, _name):
            setattr(np, _name, _val)

    # 2. transformers 5.x removed this pruning helper that SF3D's vendored dinov2
    #    imports at module load (never called at inference).
    import transformers.pytorch_utils as _tpu
    if not hasattr(_tpu, "find_pruneable_heads_and_indices"):
        def _fphi(heads, n_heads, head_size, already_pruned_heads):
            mask = torch.ones(n_heads, head_size)
            heads = set(heads) - already_pruned_heads
            for head in heads:
                head = head - sum(1 if h < head else 0 for h in already_pruned_heads)
                mask[head] = 0
            mask = mask.view(-1).contiguous().eq(1)
            index = torch.arange(len(mask))[mask].long()
            return heads, index
        _tpu.find_pruneable_heads_and_indices = _fphi

    # 3. transformers 5.x moved get_head_mask off PreTrainedModel; dinov2 calls it
    #    in forward(). At inference head_mask is always None → [None]*num_layers.
    from transformers.modeling_utils import PreTrainedModel as _PTM
    if not hasattr(_PTM, "get_head_mask"):
        def _get_head_mask(self, head_mask, num_hidden_layers, is_attention_chunked=False):
            if head_mask is None:
                return [None] * num_hidden_layers
            return head_mask
        _PTM.get_head_mask = _get_head_mask

    _shims_applied = True
    log.info("[sf3d] compatibility shims applied (numpy2 / transformers5)")


def _patch_texture_baker_cpu() -> None:
    """
    Our texture_baker is a CPU-only build (no CUDA toolkit at setup). SF3D calls
    it with CUDA tensors → dispatch error. Route the bake through CPU and move
    results back to the source device. GPU-primary, bake overflows to CPU.
    """
    import torch
    import texture_baker.baker as _tbb

    if getattr(_tbb.TextureBaker, "_interforge_cpu_patched", False):
        return

    def _cpu_rasterize(self, uv, face_indices, bake_resolution):
        dev = uv.device
        return torch.ops.texture_baker_cpp.rasterize(
            uv.cpu(), face_indices.to(torch.int32).cpu(), bake_resolution
        ).to(dev)

    def _cpu_interpolate(self, attr, rast, face_indices):
        dev = attr.device
        return torch.ops.texture_baker_cpp.interpolate(
            attr.cpu(), face_indices.to(torch.int32).cpu(), rast.cpu()
        ).to(dev)

    _tbb.TextureBaker.rasterize = _cpu_rasterize
    _tbb.TextureBaker.interpolate = _cpu_interpolate
    _tbb.TextureBaker._interforge_cpu_patched = True
    log.info("[sf3d] texture_baker routed to CPU (GPU-primary / CPU-overflow)")


class SF3DEngine:
    _instance: Optional["SF3DEngine"] = None

    def __init__(self):
        self._model = None
        self._device: Optional[str] = None
        self._on_gpu = False
        self._rembg_session = None

    @classmethod
    def get(cls) -> "SF3DEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    # ── Load / Unload / Offload ──────────────────────────────────

    def load(self) -> None:
        """Load SF3D weights onto the GPU (downloads ~1.5GB on first run)."""
        if self._model is not None:
            self.to_gpu()
            return

        import torch

        _apply_compat_shims()
        if str(_VENDOR) not in sys.path:
            sys.path.insert(0, str(_VENDOR))

        from sf3d.system import SF3D

        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        log.info(f"[sf3d] Loading {_MODEL_ID} on {self._device}…")
        self._model = SF3D.from_pretrained(
            _MODEL_ID, config_name="config.yaml", weight_name="model.safetensors",
        )
        self._model.eval()
        # texture_baker is imported by the sf3d package; patch after it's importable.
        _patch_texture_baker_cpu()
        self.to_gpu()
        log.info("[sf3d] Model ready")

    def to_gpu(self) -> None:
        """Move weights onto the GPU (part of the GPU-primary arbiter)."""
        if self._model is None or self._device != "cuda" or self._on_gpu:
            return
        self._model.to("cuda")
        self._on_gpu = True

    def offload(self) -> None:
        """
        Push weights to CPU RAM without freeing them — the CPU-overflow arbiter.
        Lets a heavier stage (SDXL sprite stack) take the GPU, then reload fast.
        """
        if self._model is None or not self._on_gpu:
            return
        import torch
        self._model.to("cpu")
        self._on_gpu = False
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        log.info("[sf3d] Offloaded to CPU RAM (GPU freed for another stage)")

    def unload(self) -> None:
        """Fully free the model from RAM and VRAM."""
        if self._model is not None:
            del self._model
            self._model = None
            self._on_gpu = False
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            log.info("[sf3d] Unloaded")

    # ── Generation ───────────────────────────────────────────────

    def generate_mesh(
        self,
        image,
        foreground_ratio: float = 0.85,
        texture_resolution: int = 1024,
        remesh: str = "none",
        target_vertex_count: int = -1,
        remove_bg: bool = True,
    ) -> "trimesh.Trimesh":
        """
        Single image → UV-textured trimesh.Trimesh.

        image:        PIL.Image (RGB or RGBA). If it already has a clean alpha,
                      pass remove_bg=False to skip rembg.
        remesh:       "none" | "triangle" | "quad"
        target_vertex_count: -1 = no reduction.
        """
        if self._model is None:
            self.load()
        else:
            self.to_gpu()

        import torch
        from PIL import Image as _PIL
        from sf3d.utils import remove_background, resize_foreground

        img = image.convert("RGBA")
        if remove_bg:
            if self._rembg_session is None:
                import rembg
                self._rembg_session = rembg.new_session()
            img = remove_background(img, self._rembg_session)
        img = resize_foreground(img, foreground_ratio)

        dev = self._device or "cpu"
        autocast = (
            torch.autocast(device_type="cuda", dtype=torch.bfloat16)
            if dev == "cuda" else _nullcontext()
        )
        with torch.no_grad():
            with autocast:
                mesh, _ = self._model.run_image(
                    img,
                    bake_resolution=texture_resolution,
                    remesh=remesh,
                    vertex_count=target_vertex_count,
                )
        return mesh


class _nullcontext:
    def __enter__(self):
        return None

    def __exit__(self, *a):
        return False


def get_sf3d_engine() -> SF3DEngine:
    return SF3DEngine.get()
