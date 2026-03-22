"""
multiview.py - Merging side views into a unified depth profile.
Used in MASTERFORGE stage when left/right views are available.
"""

import numpy as np
from masterforge.ingest import load_rgba, get_mask
from masterforge.trace import trace_contour, scanline_profile, smooth_profile

def extract_side_profile(image_path: str, n_slices: int = 300) -> np.ndarray:
    """
    Trace a side view image and return its width profile.
    This width becomes the 'depth' (Z) for the main front mesh.
    """
    rgba = load_rgba(image_path)
    mask = get_mask(rgba, image_path=image_path)
    
    contour, _ = trace_contour(mask)
    raw = scanline_profile(contour, n_slices=n_slices)
    profile = smooth_profile(raw)
    
    # Side view width = (xr - xl)
    widths = np.array([row[2] - row[1] for row in profile], dtype=np.float32)
    return widths

def merge_depth_profiles(left_widths: np.ndarray = None, right_widths: np.ndarray = None) -> np.ndarray:
    """
    Average left and right profiles. 
    Handles single-view fallback if one side is missing.
    Detects significant asymmetry if they differ by > 20%.
    """
    if left_widths is None and right_widths is None:
        raise ValueError('At least one side profile required for multiview depth')
    
    if left_widths is None:
        return right_widths
    if right_widths is None:
        return left_widths

    if left_widths.shape != right_widths.shape:
        # Resample if lengths differ (unlikely with fixed n_slices but defensive)
        from scipy.interpolate import interp1d
        x_new = np.linspace(0, 1, len(left_widths))
        f_right = interp1d(np.linspace(0, 1, len(right_widths)), right_widths, kind='linear', fill_value="extrapolate")
        right_widths = f_right(x_new).astype(np.float32)

    # Calculate symmetry
    diff = np.abs(left_widths - right_widths)
    avg_w = (left_widths + right_widths) / 2.0 + 1e-6
    asymmetry = diff / avg_w
    
    if asymmetry.mean() > 0.20:
        print(f"[masterforge.multiview] WARNING: High asymmetry detected ({asymmetry.mean()*100:.1f}%)")
        
    return (left_widths + right_widths) / 2.0

def validate_view_set(views: dict) -> bool:
    """
    Ensure front, left, and right views are present and aligned.
    """
    required = ['front', 'left', 'right']
    for r in required:
        if r not in views or not views[r]:
            return False
    return True

if __name__ == "__main__":
    import argparse
    import json
    import sys
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--args', help='JSON file containing arguments')
    a = parser.parse_args()
    
    if a.args:
        with open(a.args, encoding='utf-8') as f:
            opts = json.load(f)
        
        if 'views' in opts:
            res = validate_view_set(opts['views'])
            print(json.dumps({"valid": res}))
            sys.exit(0)
    
    # Legacy / Manual call placeholder
    print(json.dumps({"valid": False, "error": "No arguments provided"}))
