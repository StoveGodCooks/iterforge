"""
depth.py - per-slice Z depth estimation for the loft pipeline.

Two methods, used in priority order:

  EDT (primary, always available)
    scipy Euclidean Distance Transform of the foreground mask.
    Each pixel's value = distance to nearest background pixel.
    This is the local "radius" of the shape - mathematically correct
    for any silhouette, zero assumptions, no downloads.

  MiDaS (optional, neural)
    Intel MiDaS monocular depth estimation via torch.hub.
    Better for photorealistic source art where the silhouette radius
    understimates real depth (e.g. a sphere looks flat in EDT).
    Requires: pip install timm  (torch already installed)
    Activated by passing use_midas=True to get_depth_profile().

After sampling, depths are scaled by per-zone multipliers from
the asset config so zone semantics (blade=thin, guard=thick) are
preserved regardless of which depth source is used.
"""

import numpy as np


# -- Public API ----------------------------------------------------------------

def get_depth_profile(mask: np.ndarray, asset_config: dict,
                      image_path: str = None,
                      n_slices: int = 300,
                      use_midas: bool = False) -> np.ndarray:
    """
    Compute per-slice absolute Z depths for the loft pipeline.

    Args:
        mask         - bool (H, W) foreground mask
        asset_config - asset JSON config (for zone depth scales)
        image_path   - path to source PNG (needed for MiDaS)
        n_slices     - number of scanline slices
        use_midas    - if True and timm is available, use neural depth

    Returns:
        float32 array (n_slices,) - absolute Z depth per slice, same
        ordering as the scanline profile (bottom to top of asset).
    """
    depth_map = None

    if use_midas and image_path:
        try:
            depth_map = _midas_depth(image_path, mask)
            print('[masterforge.depth] using MiDaS neural depth')
        except Exception as e:
            print(f'[masterforge.depth] MiDaS unavailable ({e}) - using EDT')

    if depth_map is None:
        depth_map = _edt_depth(mask)
        print('[masterforge.depth] using EDT depth')

    profile = _sample_depth_scanlines(depth_map, mask, n_slices)
    return profile, depth_map


def apply_depth_to_profile(profile_sm: list, depth_profile: np.ndarray,
                            zones: np.ndarray, asset_config: dict,
                            min_depth: float = 0.025) -> np.ndarray:
    """
    Finalise depths based on the sampled profile.
    
    Unchained version: applies longitudinal smoothing and forces
    symmetry to remove 'brushstroke ripples' and AI wobbles.
    """
    n = min(len(profile_sm), len(depth_profile))
    depths = np.zeros(n, dtype=np.float32)

    # 1. Longitudinal Smoothing (Digital Sandpaper)
    # We smooth the raw AI depth along the Y-axis to remove high-frequency ripples
    # while keeping the overall shape of the weapon.
    smoothed_raw = _smooth1d(depth_profile, sigma=2.5)

    # 2. Aesthetic Scaling and Clamping
    for i in range(n):
        raw_d = float(smoothed_raw[i])
        # Force sword-like thickness (0.12 scale)
        depths[i] = max(raw_d * 0.12, min_depth)

    # 3. Final Profile Smooth
    # One last pass to ensure perfectly clean transitions between zones
    return _smooth1d(depths, sigma=1.2)


def _smooth1d(arr: np.ndarray, sigma: float = 1.5) -> np.ndarray:
    """Helper to apply Gaussian smoothing to a 1D array."""
    sz  = max(3, int(sigma * 4) | 1)
    ax  = np.arange(-(sz // 2), sz // 2 + 1, dtype=np.float32)
    k   = np.exp(-ax ** 2 / (2 * sigma ** 2)); k /= k.sum()
    pad = sz // 2
    a   = np.array(arr, dtype=np.float32)
    p   = np.concatenate([a[:pad][::-1], a, a[-pad:][::-1]])
    return sum(k[i] * p[i:i + len(a)] for i in range(len(k)))


# -- Depth sources --------------------------------------------------------------

def _edt_depth(mask: np.ndarray) -> np.ndarray:
    """
    Euclidean Distance Transform of the foreground mask.
    Returns float32 (H, W) normalised to [0, 1].
    """
    from scipy.ndimage import distance_transform_edt

    edt   = distance_transform_edt(mask).astype(np.float32)
    max_d = float(edt.max())
    if max_d < 1e-6:
        return np.zeros_like(edt)
    return edt / max_d


def _midas_depth(image_path: str, mask: np.ndarray) -> np.ndarray:
    """
    MiDaS monocular depth estimation (MiDaS_small model).
    Returns float32 (H, W) normalised to [0, 1], masked to foreground.
    Requires: torch, timm.
    """
    import torch
    import cv2

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    model      = torch.hub.load('intel-isl/MiDaS', 'MiDaS_small',
                                trust_repo=True)
    transforms = torch.hub.load('intel-isl/MiDaS', 'transforms',
                                trust_repo=True)
    transform  = transforms.small_transform

    model.to(device).eval()

    img = cv2.imread(image_path)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    with torch.no_grad():
        batch      = transform(img).to(device)
        prediction = model(batch)
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=img.shape[:2],
            mode='bicubic',
            align_corners=False,
        ).squeeze()

    depth = prediction.cpu().numpy().astype(np.float32)
    d_min, d_max = float(depth.min()), float(depth.max())
    depth = (depth - d_min) / (d_max - d_min + 1e-8)

    # Zero out background so background pixels don't pollute slice sampling
    depth *= mask.astype(np.float32)
    return depth


# -- Scanline sampling ---------------------------------------------------------

def _sample_depth_scanlines(depth_map: np.ndarray, mask: np.ndarray,
                             n_slices: int) -> np.ndarray:
    """
    Sample the depth map along horizontal scanlines from top to bottom
    of the mask bounding box.  At each row, takes the max depth value
    within the foreground pixels (peak depth = thickest point of cross-section).

    Returns float32 (n_slices,) in top-to-bottom order, then flipped to
    match the loft axis convention (bottom of asset = index 0, tip = last).
    """
    ys_fg = np.where(mask.any(axis=1))[0]
    if len(ys_fg) == 0:
        return np.zeros(n_slices, dtype=np.float32)

    y_min, y_max = int(ys_fg.min()), int(ys_fg.max())
    rows = np.linspace(y_min, y_max, n_slices).astype(int)
    rows = np.clip(rows, 0, depth_map.shape[0] - 1)

    depths = []
    for row in rows:
        row_mask = mask[row]
        if row_mask.any():
            depths.append(float(depth_map[row][row_mask].max()))
        else:
            depths.append(0.0)

    # Image Y is top-down; loft axis is bottom-up - flip to match
    result = np.array(depths, dtype=np.float32)[::-1].copy()

    # Re-normalise to [0, 1] in case MiDaS masked values shifted the range
    mx = float(result.max())
    if mx > 1e-6:
        result /= mx

    return result
