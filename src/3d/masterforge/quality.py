"""
quality.py - Identity locking, alignment, and orthographic validation.
Provides scoring for smelting views and sprite sheets.
"""

import cv2
import numpy as np
import imagehash
from PIL import Image
from skimage.metrics import structural_similarity as ssim

class IdentityLock:
    """
    Utility for checking consistency between a reference image and generated views.
    Used in Phase 2 SMELTING to ensure side views haven't drifted from front identity.
    """

    @staticmethod
    def frame_consistency_score(ref_path: str, gen_path: str, 
                                 asset_type: str = 'sword',
                                 mode: str = 'sprite') -> dict:
        """
        Combined score using pHash, SSIM, and Color Histograms.
        Returns { score: 0.0-1.0, passed: bool, warn: bool, details: {} }
        
        Modes:
          'sprite'   - All frames same angle (front). Validates temporal consistency.
          'smelting' - Frames are different angles. Validates palette identity only.
        """
        # 1. Load images
        ref_pil = Image.open(ref_path).convert('RGB')
        gen_pil = Image.open(gen_path).convert('RGB')
        
        # 2. pHash (Perceptual Hash) - good for structural fingerprint
        hash_ref = imagehash.phash(ref_pil)
        hash_gen = imagehash.phash(gen_pil)
        hash_diff = hash_ref - hash_gen 
        phash_score = max(0, (64 - hash_diff) / 64.0)

        # 3. Color Histogram (Global palette check)
        ref_np = np.array(ref_pil.resize((256, 256)))
        gen_np = np.array(gen_pil.resize((256, 256)))
        hist_ref = cv2.calcHist([ref_np], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        hist_gen = cv2.calcHist([gen_np], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        cv2.normalize(hist_ref, hist_ref)
        cv2.normalize(hist_gen, hist_gen)
        color_score = cv2.compareHist(hist_ref, hist_gen, cv2.HISTCMP_CORREL)
        color_score = max(0, color_score)

        # 4. Weighting Logic
        if mode == 'smelting':
            # Cross-angle views: silhouette changes completely between front/side/back.
            # pHash is unreliable for rotated silhouettes (a sword edge vs blade face
            # look nothing alike). Weight heavily toward palette/color identity.
            final_score = (phash_score * 0.15) + (color_score * 0.85)
            ssim_val = None
        else:
            # Sprite frames (same angle): SSIM is highly valid
            ref_gray = cv2.cvtColor(ref_np, cv2.COLOR_RGB2GRAY)
            gen_gray = cv2.cvtColor(gen_np, cv2.COLOR_RGB2GRAY)
            ssim_val, _ = ssim(ref_gray, gen_gray, full=True)
            final_score = (phash_score * 0.30) + (ssim_val * 0.30) + (color_score * 0.40)

        # Thresholds
        # Smelting (cross-angle): lower threshold — a correct side profile will always
        # have a different silhouette from the front, so we only gate on palette drift.
        # Sprite (same-angle): higher threshold — temporal frames should be near-identical.
        if mode == 'smelting':
            thresholds = {
                'sword':     0.50,
                'character': 0.52,
                'pixel':     0.45,
                'default':   0.50
            }
        else:
            thresholds = {
                'sword':     0.70,
                'character': 0.75,
                'pixel':     0.60,
                'default':   0.70
            }
        thresh = thresholds.get(asset_type, thresholds['default'])

        return {
            'score': float(final_score),
            'threshold': float(thresh),
            'passed': final_score >= thresh,
            'warn': final_score >= (thresh - 0.1),
            'details': {
                'phash': float(phash_score),
                'ssim': float(ssim_val) if ssim_val is not None else None,
                'color': float(color_score)
            }
        }

    @staticmethod
    def check_alignment(ref_mask: np.ndarray, gen_mask: np.ndarray) -> dict:
        """
        Compare Y-span (height) and vertical centering.
        Catches scale drift where a side view is taller/shorter than front.
        """
        def get_span(mask):
            ys = np.where(mask.any(axis=1))[0]
            if len(ys) == 0: return 0, 0, 0
            return ys.min(), ys.max(), ys.max() - ys.min()

        y_min_r, y_max_r, h_r = get_span(ref_mask)
        y_min_g, y_max_g, h_g = get_span(gen_mask)

        if h_r == 0 or h_g == 0:
            return {'aligned': False, 'diff': 1.0, 'reason': 'empty_mask'}

        height_diff = abs(h_r - h_g) / float(h_r)
        # Vertical center drift
        c_r = (y_min_r + y_max_r) / 2.0
        c_g = (y_min_g + y_max_g) / 2.0
        center_drift = abs(c_r - c_g) / float(ref_mask.shape[0])

        aligned = height_diff < 0.05 and center_drift < 0.03

        return {
            'aligned': bool(aligned),
            'height_diff': float(height_diff),
            'center_drift': float(center_drift),
            'reason': None if aligned else ('height' if height_diff >= 0.05 else 'center')
        }

    @staticmethod
    def validate_orthographic(mask: np.ndarray) -> bool:
        """
        Check if the silhouette is reasonably centered and vertical.
        Prevents tilted or diagonal generation failures.
        """
        from scipy.ndimage import center_of_mass
        if not mask.any(): return False
        
        cy, cx = center_of_mass(mask)
        img_h, img_w = mask.shape
        
        # Horizontal center: 10% tolerance
        center_err_x = abs(cx - (img_w / 2.0)) / float(img_w)
        if center_err_x > 0.10:
            return False
            
        # Vertical sanity: should not be hugging the extreme top/bottom
        ys = np.where(mask.any(axis=1))[0]
        y_min, y_max = ys.min(), ys.max()
        if y_min < (img_h * 0.02) or y_max > (img_h * 0.98):
            return False

        return True

if __name__ == '__main__':
    import argparse, json, sys
    parser = argparse.ArgumentParser()
    parser.add_argument('--args', required=True)
    a = parser.parse_args()
    
    with open(a.args) as f:
        opts = json.load(f)
    
    result = IdentityLock.frame_consistency_score(
        opts['ref_path'], 
        opts['gen_path'],
        asset_type=opts.get('asset_type', 'sword'),
        mode=opts.get('mode', 'smelting')
    )
    print(json.dumps(result))
