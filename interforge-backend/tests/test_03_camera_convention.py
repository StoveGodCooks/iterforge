"""
tests/test_03_camera_convention.py — Camera math & grid convention tests.

These tests validate the reconstruction pipeline's camera geometry against
the official Zero123++ v1.2 specifications.  They are the primary defense
against the class of bugs that caused fragmented meshes in Sessions 03–06.

No GPU or model weights required — pure math tests.

Audit items covered:
  - Grid splitting correctness (2×3, not 3×2)
  - Camera pose conformance (az/el/radius match upstream)
  - Intrinsic focal length from FoV
  - Intrinsic scaling proportionality under resize
  - Extrinsic Y-flip for OpenCV convention
  - Volume bounds auto-computation from FoV
  - Projection sanity: world origin projects to image center
  - Projection sanity: world-Y-up projects to image-top
"""
import math

import numpy as np
import pytest


# ── Upstream ground truth ────────────────────────────────────────
# Source: https://github.com/SUDO-AI-3D/zero123plus (Camera Parameters)

UPSTREAM_AZIMUTHS = [30, 90, 150, 210, 270, 330]
UPSTREAM_ELEVATIONS_V12 = [20, -10, 20, -10, 20, -10]
UPSTREAM_FOV_V12 = 30.0
UPSTREAM_OUTPUT_WIDTH = 640
UPSTREAM_OUTPUT_HEIGHT = 960
UPSTREAM_CELL_SIZE = 320


# ═══════════════════════════════════════════════════════════════
#  Test 1: Grid Splitting
# ═══════════════════════════════════════════════════════════════

class TestGridSplitting:
    """Guard against the 3×2 vs 2×3 bug (Session 03, Bug #15)."""

    def test_grid_dimensions(self):
        """Output is 640×960 → 2 columns × 3 rows of 320×320 cells."""
        w, h = UPSTREAM_OUTPUT_WIDTH, UPSTREAM_OUTPUT_HEIGHT
        cell_w = w // 2
        cell_h = h // 3
        assert cell_w == 320, f"cell width should be 320, got {cell_w}"
        assert cell_h == 320, f"cell height should be 320, got {cell_h}"

    def test_grid_split_indexing(self):
        """Each view index maps to the correct (col, row) in the 2×3 grid."""
        from inference.zero123 import VIEW_ORDER

        for idx, name in enumerate(VIEW_ORDER):
            col = idx % 2
            row = idx // 2
            assert 0 <= col <= 1, f"View {name}: col={col} out of range [0,1]"
            assert 0 <= row <= 2, f"View {name}: row={row} out of range [0,2]"

    def test_grid_split_produces_distinct_crops(self):
        """Given a synthetic 640×960 image with distinct colors per cell,
        verify each crop maps to the correct cell."""
        from PIL import Image
        from inference.zero123 import Zero123Engine

        # Create a test image: each cell gets a unique RGB value
        # Grid layout: 2 cols × 3 rows
        cell_colors = [
            (255, 0, 0),      # idx 0: front       (0,0)
            (0, 255, 0),      # idx 1: front_right  (1,0)
            (0, 0, 255),      # idx 2: right        (0,1)
            (255, 255, 0),    # idx 3: back         (1,1)
            (255, 0, 255),    # idx 4: left          (0,2)
            (0, 255, 255),    # idx 5: front_left    (1,2)
        ]

        composite = Image.new("RGB", (640, 960), (0, 0, 0))
        for idx, color in enumerate(cell_colors):
            col = idx % 2
            row = idx // 2
            x0 = col * 320
            y0 = row * 320
            cell = Image.new("RGB", (320, 320), color)
            composite.paste(cell, (x0, y0))

        views = Zero123Engine._split_grid(composite)

        from inference.zero123 import VIEW_ORDER
        for idx, name in enumerate(VIEW_ORDER):
            view = views[name]
            # Sample center pixel
            cx, cy = view.size[0] // 2, view.size[1] // 2
            pixel = view.getpixel((cx, cy))
            expected = cell_colors[idx]
            assert pixel[:3] == expected, (
                f"View '{name}' (idx {idx}): center pixel {pixel[:3]} != expected {expected}"
            )

    def test_all_six_views_present(self):
        """_split_grid returns exactly 6 named views."""
        from PIL import Image
        from inference.zero123 import Zero123Engine, VIEW_ORDER

        composite = Image.new("RGB", (640, 960), (128, 128, 128))
        views = Zero123Engine._split_grid(composite)

        assert len(views) == 6
        for name in VIEW_ORDER:
            assert name in views, f"Missing view: {name}"
            assert views[name].size == (320, 320), f"View {name} size: {views[name].size}"


# ═══════════════════════════════════════════════════════════════
#  Test 2: Camera Pose Conformance
# ═══════════════════════════════════════════════════════════════

class TestCameraPoseConformance:
    """Verify CAMERA_POSES matches upstream Zero123++ v1.2 spec exactly."""

    def test_azimuth_values(self):
        """Azimuths must be 30/90/150/210/270/330 (relative to input)."""
        from inference.zero123 import CAMERA_POSES, VIEW_ORDER

        actual_azimuths = [CAMERA_POSES[name]["azimuth"] for name in VIEW_ORDER]
        assert actual_azimuths == UPSTREAM_AZIMUTHS, (
            f"Azimuths {actual_azimuths} != upstream {UPSTREAM_AZIMUTHS}"
        )

    def test_elevation_values(self):
        """Elevations must alternate +20°/−10° for v1.2."""
        from inference.zero123 import CAMERA_POSES, VIEW_ORDER

        actual_elevations = [CAMERA_POSES[name]["elevation"] for name in VIEW_ORDER]
        assert actual_elevations == UPSTREAM_ELEVATIONS_V12, (
            f"Elevations {actual_elevations} != upstream {UPSTREAM_ELEVATIONS_V12}"
        )

    def test_elevation_alternation_pattern(self):
        """Left column (even indices) = high elevation (+20°).
        Right column (odd indices) = low elevation (−10°)."""
        from inference.zero123 import CAMERA_POSES, VIEW_ORDER

        for idx, name in enumerate(VIEW_ORDER):
            el = CAMERA_POSES[name]["elevation"]
            if idx % 2 == 0:  # left column
                assert el == 20.0, f"View {name} (left col): elevation {el} should be +20"
            else:              # right column
                assert el == -10.0, f"View {name} (right col): elevation {el} should be -10"

    def test_radius_consistent(self):
        """All views use the same camera radius (1.5)."""
        from inference.zero123 import CAMERA_POSES

        for name, pose in CAMERA_POSES.items():
            assert pose["radius"] == 1.5, f"View {name}: radius {pose['radius']} != 1.5"

    def test_six_views_defined(self):
        """Exactly 6 camera poses defined."""
        from inference.zero123 import CAMERA_POSES
        assert len(CAMERA_POSES) == 6

    def test_view_order_matches_camera_poses(self):
        """VIEW_ORDER contains exactly the keys of CAMERA_POSES."""
        from inference.zero123 import CAMERA_POSES, VIEW_ORDER
        assert set(VIEW_ORDER) == set(CAMERA_POSES.keys())


# ═══════════════════════════════════════════════════════════════
#  Test 3: Camera Intrinsics
# ═══════════════════════════════════════════════════════════════

class TestCameraIntrinsics:
    """Verify focal length derivation from FoV and scaling behavior."""

    def test_focal_from_fov_30_at_768(self):
        """focal = (768/2) / tan(15°) ≈ 1433.1"""
        from inference.reconstruct import _build_intrinsic

        K = _build_intrinsic(768, fov_deg=30.0)
        expected_focal = (768.0 / 2.0) / math.tan(math.radians(15.0))

        assert abs(K[0, 0] - expected_focal) < 0.01, (
            f"fx = {K[0, 0]:.2f}, expected {expected_focal:.2f}"
        )
        assert abs(K[1, 1] - expected_focal) < 0.01, (
            f"fy = {K[1, 1]:.2f}, expected {expected_focal:.2f}"
        )

    def test_principal_point_at_center(self):
        """cx, cy should be at image_size / 2."""
        from inference.reconstruct import _build_intrinsic

        K = _build_intrinsic(768)
        assert K[0, 2] == 384.0, f"cx = {K[0, 2]}, expected 384.0"
        assert K[1, 2] == 384.0, f"cy = {K[1, 2]}, expected 384.0"

    def test_focal_scales_with_image_size(self):
        """If we resize from 320 to 768, focal scales proportionally.
        This is required when using SVG masks at a different resolution
        than the original views."""
        from inference.reconstruct import _build_intrinsic

        K_320 = _build_intrinsic(320, fov_deg=30.0)
        K_768 = _build_intrinsic(768, fov_deg=30.0)
        K_1024 = _build_intrinsic(1024, fov_deg=30.0)

        ratio_768_320 = K_768[0, 0] / K_320[0, 0]
        ratio_1024_320 = K_1024[0, 0] / K_320[0, 0]

        assert abs(ratio_768_320 - 768.0 / 320.0) < 0.001, (
            f"768/320 focal ratio = {ratio_768_320:.4f}, expected {768/320:.4f}"
        )
        assert abs(ratio_1024_320 - 1024.0 / 320.0) < 0.001, (
            f"1024/320 focal ratio = {ratio_1024_320:.4f}, expected {1024/320:.4f}"
        )

    def test_focal_not_image_size_times_1_2(self):
        """Regression: old code used focal = image_size * 1.2 (Bug #17).
        This gave an effective FoV of ~45° instead of 30°."""
        from inference.reconstruct import _build_intrinsic

        K = _build_intrinsic(768, fov_deg=30.0)
        wrong_focal = 768 * 1.2  # = 921.6 (the old wrong value)

        assert K[0, 0] != pytest.approx(wrong_focal, abs=1.0), (
            f"Focal {K[0,0]:.1f} matches old wrong value {wrong_focal:.1f}!"
        )
        assert K[0, 0] > 1400, (
            f"Focal {K[0,0]:.1f} too small for 30° FoV at 768px (should be >1400)"
        )


# ═══════════════════════════════════════════════════════════════
#  Test 4: Camera Extrinsics
# ═══════════════════════════════════════════════════════════════

class TestCameraExtrinsics:
    """Verify extrinsic matrix construction: rotation order, Y-flip, translation."""

    def test_extrinsic_is_4x4(self):
        """Extrinsic should be a 4×4 matrix."""
        from inference.reconstruct import _build_extrinsic

        ext = _build_extrinsic("front")
        assert ext.shape == (4, 4)

    def test_y_flip_present(self):
        """The Y row (row 1) should be negated for OpenCV convention.
        Regression: Bug #18 — missing Y-flip caused vertical inversion."""
        from inference.reconstruct import _build_extrinsic

        ext = _build_extrinsic("front")
        # For a view with az=30° el=+20°, the Y-flip means the
        # determinant of the rotation part should be -1 (reflection).
        R = ext[:3, :3]
        det = np.linalg.det(R)
        assert det < 0, (
            f"Rotation determinant = {det:.3f}, expected < 0 (Y-flip missing)"
        )

    def test_translation_along_z(self):
        """Camera is at distance `radius` along the Z axis (after rotation)."""
        from inference.reconstruct import _build_extrinsic

        ext = _build_extrinsic("front")
        # ext[2, 3] should equal the radius (1.5)
        assert abs(ext[2, 3] - 1.5) < 0.01, (
            f"Z-translation = {ext[2,3]}, expected 1.5"
        )

    def test_unknown_view_returns_identity(self):
        """Unknown view name should return identity (graceful fallback)."""
        from inference.reconstruct import _build_extrinsic

        ext = _build_extrinsic("nonexistent_view")
        np.testing.assert_array_almost_equal(ext, np.eye(4))

    def test_world_origin_projects_near_image_center(self):
        """The world origin (0,0,0) should project near the image center
        for any camera view.  This is a key sanity check: the object
        is centered at the world origin, so it should appear centered
        in every view."""
        from inference.reconstruct import _build_intrinsic, _build_extrinsic, CAMERA_POSES

        image_size = 768
        K = _build_intrinsic(image_size, fov_deg=30.0)

        for view_name in CAMERA_POSES:
            ext = _build_extrinsic(view_name)
            P = K @ ext[:3, :]

            # Project world origin (0,0,0,1)
            origin = np.array([0, 0, 0, 1], dtype=np.float64)
            proj = P @ origin
            u = proj[0] / proj[2]
            v = proj[1] / proj[2]

            center = image_size / 2.0
            tolerance = image_size * 0.15  # within 15% of center

            assert abs(u - center) < tolerance, (
                f"View '{view_name}': origin u={u:.1f}, expected ~{center:.0f} "
                f"(off by {abs(u - center):.1f}px)"
            )
            assert abs(v - center) < tolerance, (
                f"View '{view_name}': origin v={v:.1f}, expected ~{center:.0f} "
                f"(off by {abs(v - center):.1f}px)"
            )

    def test_positive_y_projects_to_upper_image(self):
        """A point at (0, +0.2, 0) — top of object — should project to
        the UPPER half of the image (v < center).

        Regression: Bug #18 — without Y-flip, this point projected to
        the lower half, inverting the silhouette lookup."""
        from inference.reconstruct import _build_intrinsic, _build_extrinsic

        image_size = 768
        K = _build_intrinsic(image_size, fov_deg=30.0)
        center = image_size / 2.0

        # Test on front view (should be representative)
        ext = _build_extrinsic("front")
        P = K @ ext[:3, :]

        # Point above origin
        top_point = np.array([0, 0.2, 0, 1], dtype=np.float64)
        proj = P @ top_point
        v_top = proj[1] / proj[2]

        assert v_top < center, (
            f"Top point projects to v={v_top:.1f} (below center {center:.0f}) — "
            f"Y-flip is broken!"
        )

    def test_positive_z_in_front_of_camera(self):
        """All views should have the world origin in front of the camera
        (positive Z in camera space)."""
        from inference.reconstruct import _build_extrinsic, CAMERA_POSES

        for view_name in CAMERA_POSES:
            ext = _build_extrinsic(view_name)
            origin_cam = ext @ np.array([0, 0, 0, 1], dtype=np.float64)
            z_cam = origin_cam[2]
            assert z_cam > 0, (
                f"View '{view_name}': world origin z_cam={z_cam:.3f} "
                f"(behind camera!)"
            )


# ═══════════════════════════════════════════════════════════════
#  Test 5: Volume Bounds
# ═══════════════════════════════════════════════════════════════

class TestVolumeBounds:
    """Verify volume bounds auto-computation from FoV and radius."""

    def test_bounds_from_30deg_fov(self):
        """For 30° FoV at radius 1.5, bounds should be ~±0.382."""
        from inference.reconstruct import _compute_vol_bounds

        lo, hi = _compute_vol_bounds(fov_deg=30.0, radius=1.5)
        expected = math.tan(math.radians(15.0)) * 1.5 * 0.95

        assert abs(hi - expected) < 0.001, f"hi={hi}, expected {expected}"
        assert abs(lo - (-expected)) < 0.001, f"lo={lo}, expected {-expected}"

    def test_bounds_symmetric(self):
        """Bounds should be symmetric around zero."""
        from inference.reconstruct import _compute_vol_bounds

        lo, hi = _compute_vol_bounds(fov_deg=30.0, radius=1.5)
        assert abs(lo + hi) < 0.0001, f"Asymmetric bounds: ({lo}, {hi})"

    def test_bounds_inside_visible_frustum(self):
        """Volume bounds must be within the camera's visible extent.
        Regression: Bug #19 — bounds were ±0.8 but visible was ±0.402."""
        from inference.reconstruct import _compute_vol_bounds

        lo, hi = _compute_vol_bounds(fov_deg=30.0, radius=1.5)
        visible_half = math.tan(math.radians(15.0)) * 1.5  # 0.402

        assert hi < visible_half, (
            f"Upper bound {hi:.4f} >= visible extent {visible_half:.4f}"
        )
        assert lo > -visible_half, (
            f"Lower bound {lo:.4f} <= visible extent {-visible_half:.4f}"
        )

    def test_bounds_not_hardcoded_0_8(self):
        """Regression: old hardcoded bounds (-0.8, 0.8) were 5× too large."""
        from inference.reconstruct import _compute_vol_bounds

        lo, hi = _compute_vol_bounds(fov_deg=30.0, radius=1.5)
        assert hi < 0.5, f"Upper bound {hi} still too large (old was 0.8)"
        assert lo > -0.5, f"Lower bound {lo} still too large (old was -0.8)"

    def test_bounds_contain_object(self):
        """The 75% fill object (±0.301) must fit inside the volume."""
        from inference.reconstruct import _compute_vol_bounds

        lo, hi = _compute_vol_bounds(fov_deg=30.0, radius=1.5)
        visible_half = math.tan(math.radians(15.0)) * 1.5
        object_half = visible_half * 0.75  # 75% fill → ~0.301

        assert hi > object_half, (
            f"Upper bound {hi:.4f} clips object at {object_half:.4f}"
        )

    def test_bounds_scale_with_fov(self):
        """Wider FoV → larger bounds."""
        from inference.reconstruct import _compute_vol_bounds

        _, hi_30 = _compute_vol_bounds(fov_deg=30.0, radius=1.5)
        _, hi_60 = _compute_vol_bounds(fov_deg=60.0, radius=1.5)

        assert hi_60 > hi_30, (
            f"60° FoV bounds ({hi_60}) should be larger than 30° ({hi_30})"
        )

    def test_bounds_scale_with_radius(self):
        """Greater radius → larger visible extent → larger bounds."""
        from inference.reconstruct import _compute_vol_bounds

        _, hi_15 = _compute_vol_bounds(fov_deg=30.0, radius=1.5)
        _, hi_30 = _compute_vol_bounds(fov_deg=30.0, radius=3.0)

        assert hi_30 > hi_15, (
            f"Radius 3.0 bounds ({hi_30}) should be larger than 1.5 ({hi_15})"
        )


# ═══════════════════════════════════════════════════════════════
#  Test 6: Alpha Mask Cleanup
# ═══════════════════════════════════════════════════════════════

class TestAlphaMaskCleanup:
    """Verify shadow/artifact removal from alpha masks."""

    def test_single_component_unchanged(self):
        """A mask with one connected component should pass through unchanged."""
        from inference.reconstruct import _clean_alpha_mask

        mask = np.zeros((100, 100), dtype=np.float32)
        mask[20:80, 20:80] = 1.0

        cleaned = _clean_alpha_mask(mask)
        np.testing.assert_array_equal(cleaned, mask)

    def test_small_fragments_removed(self):
        """A tiny disconnected blob should be removed."""
        from inference.reconstruct import _clean_alpha_mask

        mask = np.zeros((100, 100), dtype=np.float32)
        # Main object: 60×60 = 3600 pixels
        mask[20:80, 20:80] = 1.0
        # Shadow fragment: 3×3 = 9 pixels (0.25% of main — below 2% threshold)
        mask[5:8, 5:8] = 1.0

        cleaned = _clean_alpha_mask(mask)

        # Main object should survive
        assert cleaned[50, 50] > 0.3, "Main object was removed!"
        # Shadow fragment should be gone
        assert cleaned[6, 6] == 0.0, "Shadow fragment was not removed!"

    def test_large_component_kept(self):
        """A second component > 2% of the main should be kept."""
        from inference.reconstruct import _clean_alpha_mask

        mask = np.zeros((100, 100), dtype=np.float32)
        # Main object: 50×50 = 2500 pixels
        mask[10:60, 10:60] = 1.0
        # Large secondary: 20×20 = 400 pixels (16% of main — above threshold)
        mask[70:90, 70:90] = 1.0

        cleaned = _clean_alpha_mask(mask)

        assert cleaned[35, 35] > 0.3, "Main object was removed!"
        assert cleaned[80, 80] > 0.3, "Large secondary was incorrectly removed!"

    def test_empty_mask_unchanged(self):
        """An empty mask should pass through without error."""
        from inference.reconstruct import _clean_alpha_mask

        mask = np.zeros((100, 100), dtype=np.float32)
        cleaned = _clean_alpha_mask(mask)
        np.testing.assert_array_equal(cleaned, mask)


# ═══════════════════════════════════════════════════════════════
#  Test 7: Preprocessing
# ═══════════════════════════════════════════════════════════════

class TestPreprocessing:
    """Verify the reference image preprocessing for Zero123++."""

    def test_output_is_square(self):
        """Preprocessed image must be square."""
        from inference.zero123 import Zero123Engine
        from PIL import Image

        # Non-square input with alpha
        img = Image.new("RGBA", (200, 400), (128, 0, 0, 255))
        result = Zero123Engine._preprocess_reference(img)
        w, h = result.size
        assert w == h, f"Not square: {w}×{h}"

    def test_object_fills_approximately_75_percent(self):
        """Object should fill ~75% of the frame."""
        from inference.zero123 import Zero123Engine
        from PIL import Image
        import numpy as np

        # Create a 100×200 opaque object on a transparent 300×400 canvas
        img = Image.new("RGBA", (300, 400), (0, 0, 0, 0))
        obj = Image.new("RGBA", (100, 200), (255, 0, 0, 255))
        img.paste(obj, (100, 100))

        result = Zero123Engine._preprocess_reference(img)
        side = result.size[0]

        # The object's max dimension is 200px.
        # At 75% fill: side = 200 / 0.75 ≈ 267
        expected_side = int(200 / 0.75)
        assert abs(side - expected_side) <= 1, (
            f"Canvas {side}px, expected ~{expected_side}px for 75% fill"
        )

    def test_gray_background(self):
        """Background should be gray (127, 127, 127)."""
        from inference.zero123 import Zero123Engine
        from PIL import Image

        # Tiny object in center
        img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        obj = Image.new("RGBA", (50, 50), (255, 0, 0, 255))
        img.paste(obj, (25, 25))

        result = Zero123Engine._preprocess_reference(img)
        # Corner pixel should be gray background
        corner = result.getpixel((0, 0))
        assert corner[:3] == (127, 127, 127), (
            f"Background pixel {corner[:3]}, expected (127, 127, 127)"
        )
