#!/usr/bin/env python3
"""
Comprehensive Diagnostic Suite for MasterForge Pipeline.
Tests each stage of the pipeline in isolation.
"""

import os
import sys
import numpy as np
import json
import traceback

# Ensure masterforge package is importable
_pkg_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _pkg_dir not in sys.path:
    sys.path.insert(0, _pkg_dir)

def run_diagnostics(image_path, asset_type='sword'):
    print(f"\n{'='*60}")
    print(f"MASTERFORGE DIAGNOSTICS: {os.path.basename(image_path)}")
    print(f"Asset Type: {asset_type}")
    print(f"{'='*60}\n")

    results = {}

    # -- STAGE 0: File Check --
    print("[1/5] Checking input file...")
    if not os.path.exists(image_path):
        print(f"  FAILED: File not found at {image_path}")
        return
    print(f"  OK: Found {image_path} ({os.path.getsize(image_path)} bytes)")
    results['file_ok'] = True

    # -- STAGE 1: Ingest (Masking) --
    print("[2/5] Testing Ingest & Masking...")
    try:
        from masterforge.ingest import load_rgba, get_mask
        rgba = load_rgba(image_path)
        mask = get_mask(rgba, image_path=image_path)
        fg_pixels = int(mask.sum())
        print(f"  OK: Masked {fg_pixels} foreground pixels")
        if fg_pixels == 0:
            print("  WARNING: Mask is completely empty! Check background removal.")
        results['mask_ok'] = True
        results['fg_pixels'] = fg_pixels
    except Exception:
        print("  FAILED: Ingest/Masking stage crashed")
        traceback.print_exc()
        results['mask_ok'] = False

    # -- STAGE 2: Trace (Silhouette) --
    print("[3/5] Testing Silhouette Trace...")
    try:
        from masterforge.trace import trace_contour, scanline_profile, smooth_profile
        contour, centroid = trace_contour(mask)
        print(f"  OK: Traced contour with {len(contour)} points")
        
        raw_profile = scanline_profile(contour, n_slices=300)
        print(f"  OK: Generated {len(raw_profile)} scanline intersections")
        
        profile_sm = smooth_profile(raw_profile)
        print(f"  OK: Profile smoothed, {len(profile_sm)} slices remaining")
        
        if len(profile_sm) < 2:
            print("  WARNING: Profile too short for lofting!")
            
        results['trace_ok'] = True
        results['n_slices'] = len(profile_sm)
    except Exception:
        print("  FAILED: Tracing stage crashed")
        traceback.print_exc()
        results['trace_ok'] = False

    # -- STAGE 3: Depth Estimation --
    print("[4/5] Testing Depth Estimation...")
    try:
        from masterforge.config import load_asset_config
        from masterforge.depth import get_depth_profile
        asset_config = load_asset_config(asset_type)
        
        depth_profile, depth_map = get_depth_profile(mask, asset_config, image_path=image_path)
        print(f"  OK: Depth profile generated (min={depth_profile.min():.4f}, max={depth_profile.max():.4f})")
        results['depth_ok'] = True
    except Exception:
        print("  FAILED: Depth stage crashed")
        traceback.print_exc()
        results['depth_ok'] = False

    # -- STAGE 4: Skeleton & Zones --
    print("[5/5] Testing Skeleton & Zones...")
    try:
        from masterforge.skeleton import detect_zones, get_cross_section_types
        widths = np.array([row[2] - row[1] for row in profile_sm], dtype=np.float32)
        zones = detect_zones(widths, asset_config)
        cs_types = get_cross_section_types(zones, asset_config)
        
        unique_zones = set(zones)
        print(f"  OK: Detected zones: {', '.join(map(str, unique_zones))}")
        results['skeleton_ok'] = True
    except Exception:
        print("  FAILED: Skeleton stage crashed")
        traceback.print_exc()
        results['skeleton_ok'] = False

    print(f"\n{'='*60}")
    print("DIAGNOSTIC SUMMARY")
    print(f"{'='*60}")
    for k, v in results.items():
        status = "PASS" if v is True else ("FAIL" if v is False else v)
        print(f"{k:15}: {status}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python comprehensive_diagnostics.py <image_path> [asset_type]")
        sys.exit(1)
    
    img = sys.argv[1]
    atype = sys.argv[2] if len(sys.argv) > 2 else 'sword'
    run_diagnostics(img, atype)
