"""
pose_library.py — programmatic OpenPose (COCO-18) skeleton renderer.

Builds the pose-conditioning images that ControlNet-OpenPose-SDXL consumes.
Skeletons are generated from (x, y) keypoint coordinates at draw time, so no
external skeleton PNGs need to ship with the app.

COCO-18 keypoint ordering (matching controlnet-openpose-sdxl-1.0 training):
    0 nose            1 neck
    2 r_shoulder      3 r_elbow       4 r_wrist
    5 l_shoulder      6 l_elbow       7 l_wrist
    8 r_hip           9 r_knee       10 r_ankle
   11 l_hip          12 l_knee       13 l_ankle
   14 r_eye          15 l_eye
   16 r_ear          17 l_ear

Pose presets below are authored for a roughly 1024×1024 canvas with the
character centered and occupying ~75% of the vertical extent. They are
scale-normalized at render time so callers can request any canvas size.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Iterable

from PIL import Image, ImageDraw


# ── OpenPose drawing conventions ──────────────────────────────
#
# The 17 limb edges and their canonical colors come straight from the
# OpenPose reference renderer. ControlNet-OpenPose-SDXL was trained on
# frames with exactly these colors, so we must match them.

_LIMBS: tuple[tuple[int, int], ...] = (
    (1, 2),   (1, 5),              # neck → shoulders
    (2, 3),   (3, 4),              # right arm
    (5, 6),   (6, 7),              # left arm
    (1, 8),   (8, 9),   (9, 10),   # right leg
    (1, 11), (11, 12), (12, 13),   # left leg
    (1, 0),                        # neck → nose
    (0, 14), (14, 16),             # right eye/ear
    (0, 15), (15, 17),             # left eye/ear
)

_LIMB_COLORS: tuple[tuple[int, int, int], ...] = (
    (255,   0,   0), (255,  85,   0),
    (255, 170,   0), (255, 255,   0),
    (170, 255,   0), ( 85, 255,   0),
    (  0, 255,   0), (  0, 255,  85),
    (  0, 255, 170), (  0, 255, 255),
    (  0, 170, 255), (  0,  85, 255),
    (  0,   0, 255),
    ( 85,   0, 255), (170,   0, 255),
    (255,   0, 255), (255,   0, 170),
)

# Canonical OpenPose COCO-18 keypoint colors (indices 0-17). ControlNet-OpenPose
# was trained on exactly these. The eye/ear dots (14-17) are the model's main
# orientation cue — they must be exact, especially for back-facing poses. The old
# table had indices 15-17 wrong (17 even duplicated index 3's yellow).
_KEYPOINT_COLORS: tuple[tuple[int, int, int], ...] = (
    (255,   0,   0), (255,  85,   0), (255, 170,   0), (255, 255,   0),
    (170, 255,   0), ( 85, 255,   0), (  0, 255,   0), (  0, 255,  85),
    (  0, 255, 170), (  0, 255, 255), (  0, 170, 255), (  0,  85, 255),
    (  0,   0, 255), ( 85,   0, 255), (170,   0, 255), (255,   0, 255),
    (255,   0, 170), (255,   0,  85),
)


Keypoint = tuple[float, float, float]  # (x_norm, y_norm, confidence 0|1)


@dataclass(frozen=True)
class PosePreset:
    """A named pose — keypoints in normalized [0,1] image space."""
    name: str
    label: str          # human-readable
    direction: str      # "front" | "back" | "side"
    prompt_hint: str    # merged into the SDXL prompt for pose context
    keypoints: tuple[Keypoint, ...]

    def render(self, size: int = 1024) -> Image.Image:
        """Render this pose as an OpenPose skeleton RGB image."""
        return render_skeleton(self.keypoints, size)


def render_skeleton(
    keypoints: Iterable[Keypoint],
    size: int = 1024,
    stroke: int | None = None,
    dot_radius: int | None = None,
) -> Image.Image:
    """
    Draw an OpenPose skeleton onto a black RGB canvas.

    Missing keypoints (confidence 0) are skipped; limbs touching a missing
    endpoint are skipped too. Line/dot thickness scale with canvas size so
    the skeleton stays legible at any resolution without being bossy at
    the trained 768-1024 range.
    """
    kps = list(keypoints)
    if len(kps) != 18:
        raise ValueError(f"Expected 18 COCO keypoints, got {len(kps)}")

    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    stroke = stroke or max(3, size // 128)
    dot_r  = dot_radius or max(3, size // 110)

    pts: list[tuple[int, int] | None] = []
    for (x, y, c) in kps:
        if c <= 0.0:
            pts.append(None)
        else:
            pts.append((int(round(x * size)), int(round(y * size))))

    for (a, b), color in zip(_LIMBS, _LIMB_COLORS):
        pa, pb = pts[a], pts[b]
        if pa is None or pb is None:
            continue
        draw.line([pa, pb], fill=color, width=stroke)

    for p, color in zip(pts, _KEYPOINT_COLORS):
        if p is None:
            continue
        x, y = p
        draw.ellipse(
            (x - dot_r, y - dot_r, x + dot_r, y + dot_r),
            fill=color,
        )

    return canvas


# ── Pose authoring helpers ────────────────────────────────────
#
# Keypoints are edited in normalized coordinates so the same preset renders
# cleanly at 512/768/1024/1344. The base layout below is a neutral standing
# figure; mutators (walk, hurt, attack, back) modify only the joints that
# change so we don't re-type 18 points per pose.

def _neutral_standing() -> list[Keypoint]:
    """Idle standing, arms slightly away from body, facing camera."""
    return [
        (0.500, 0.130, 1.0),  # 0 nose
        (0.500, 0.220, 1.0),  # 1 neck
        # Shoulders/hips widened (0.40/0.60, 0.435/0.565) so the silhouette
        # reads as an unambiguous SQUARE FRONTAL figure. A narrow skeleton is
        # geometrically consistent with a ¾-turned body, which let ControlNet
        # rotate the character off-axis.
        (0.400, 0.230, 1.0),  # 2 r_shoulder
        (0.380, 0.370, 1.0),  # 3 r_elbow
        (0.365, 0.510, 1.0),  # 4 r_wrist
        (0.600, 0.230, 1.0),  # 5 l_shoulder
        (0.620, 0.370, 1.0),  # 6 l_elbow
        (0.635, 0.510, 1.0),  # 7 l_wrist
        (0.435, 0.520, 1.0),  # 8 r_hip
        (0.435, 0.700, 1.0),  # 9 r_knee
        (0.432, 0.885, 1.0),  # 10 r_ankle
        (0.565, 0.520, 1.0),  # 11 l_hip
        (0.565, 0.700, 1.0),  # 12 l_knee
        (0.568, 0.885, 1.0),  # 13 l_ankle
        # Eyes/ears spread a touch wider to strengthen the frontal-face cue.
        (0.475, 0.115, 1.0),  # 14 r_eye
        (0.525, 0.115, 1.0),  # 15 l_eye
        (0.455, 0.125, 1.0),  # 16 r_ear
        (0.545, 0.125, 1.0),  # 17 l_ear
    ]


def _as_back_facing(kps: list[Keypoint]) -> list[Keypoint]:
    """
    Convert a front-facing skeleton to back-facing.

    OpenPose encodes orientation implicitly via the head keypoints. Dropping
    nose + eyes and keeping only ears — with the left/right ears swapped —
    reads as "figure turned around" to the ControlNet model. The torso/limb
    keypoints are mirror-symmetric so they survive the flip unchanged.
    """
    out = list(kps)
    out[0]  = (0.500, 0.130, 0.0)  # nose hidden
    out[14] = (0.465, 0.115, 0.0)  # r_eye hidden
    out[15] = (0.535, 0.115, 0.0)  # l_eye hidden
    # Ears stay visible, positions already mirror-symmetric
    return out


def _walk_step(kps: list[Keypoint], phase: float) -> list[Keypoint]:
    """
    BOLD marching step. A subtle front-facing walk is indistinguishable from
    an idle stand, so we lift the forward leg's knee HIGH (thigh near
    horizontal) and pump the arms hard. The raised knee is clearly visible
    head-on, so the stride reads as motion even in a front view.

    phase +1 → right knee raised (right-leg step)
    phase -1 → left knee raised  (left-leg step)
    """
    out = list(kps)
    if phase > 0:
        # Right leg lifted high; left leg plants and supports.
        out[9]  = (0.470, 0.560, 1.0)   # r_knee up high (thigh ~horizontal)
        out[10] = (0.455, 0.700, 1.0)   # r_ankle off the ground, tucked under
        out[12] = (0.560, 0.705, 1.0)   # l_knee planted
        out[13] = (0.560, 0.885, 1.0)   # l_ankle planted
        # Contralateral pump: left arm forward/up, right arm down/back.
        out[6]  = (0.615, 0.355, 1.0)   # l_elbow
        out[7]  = (0.565, 0.290, 1.0)   # l_wrist up (forward swing)
        out[3]  = (0.400, 0.385, 1.0)   # r_elbow
        out[4]  = (0.420, 0.520, 1.0)   # r_wrist down (back swing)
    else:
        # Left leg lifted high; right leg plants and supports.
        out[12] = (0.530, 0.560, 1.0)   # l_knee up high
        out[13] = (0.545, 0.700, 1.0)   # l_ankle tucked under
        out[9]  = (0.440, 0.705, 1.0)   # r_knee planted
        out[10] = (0.440, 0.885, 1.0)   # r_ankle planted
        out[3]  = (0.385, 0.355, 1.0)   # r_elbow
        out[4]  = (0.435, 0.290, 1.0)   # r_wrist up (forward swing)
        out[6]  = (0.600, 0.385, 1.0)   # l_elbow
        out[7]  = (0.580, 0.520, 1.0)   # l_wrist down (back swing)
    return out


def _hurt_recoil(kps: list[Keypoint]) -> list[Keypoint]:
    """
    Violent hit reaction — head snapped back, BOTH arms flung up and outward,
    knees buckling into a stagger. The old version barely differed from idle;
    this one reads unmistakably as 'taking damage' from the front.
    """
    out = list(kps)
    out[0]  = (0.500, 0.095, 1.0)   # head snapped back/up
    out[1]  = (0.500, 0.235, 1.0)   # neck
    # Both arms flung up and out (not pulled in).
    out[2]  = (0.405, 0.235, 1.0)   # r_shoulder
    out[3]  = (0.330, 0.300, 1.0)   # r_elbow out
    out[4]  = (0.295, 0.185, 1.0)   # r_wrist up high
    out[5]  = (0.595, 0.235, 1.0)   # l_shoulder
    out[6]  = (0.670, 0.300, 1.0)   # l_elbow out
    out[7]  = (0.705, 0.185, 1.0)   # l_wrist up high
    # Stagger: knees buckle, back foot kicks out behind.
    out[8]  = (0.450, 0.530, 1.0)
    out[9]  = (0.425, 0.700, 1.0)
    out[10] = (0.400, 0.880, 1.0)
    out[11] = (0.560, 0.530, 1.0)
    out[12] = (0.585, 0.690, 1.0)
    out[13] = (0.615, 0.855, 1.0)   # back foot staggered out
    return out


def _attack_swing(kps: list[Keypoint]) -> list[Keypoint]:
    """Right arm extended forward in a swinging strike pose."""
    out = list(kps)
    out[3]  = (0.340, 0.300, 1.0)   # r_elbow pulled back + up
    out[4]  = (0.250, 0.220, 1.0)   # r_wrist high, out to the side
    out[6]  = (0.600, 0.400, 1.0)   # l_elbow forward for balance
    out[7]  = (0.640, 0.470, 1.0)
    # Feet stagger: right foot back, left foot forward
    out[9]  = (0.430, 0.695, 1.0)
    out[10] = (0.410, 0.885, 1.0)
    out[12] = (0.565, 0.705, 1.0)
    out[13] = (0.575, 0.885, 1.0)
    return out


# ── Preset catalog ────────────────────────────────────────────

def _preset(name, label, direction, prompt_hint, kps) -> PosePreset:
    return PosePreset(
        name=name, label=label, direction=direction,
        prompt_hint=prompt_hint, keypoints=tuple(kps),
    )


_neutral = _neutral_standing()

PRESETS: tuple[PosePreset, ...] = (
    _preset(
        "idle_front", "Idle — Front", "front",
        "standing idle, relaxed stance, arms at sides, facing camera",
        _neutral,
    ),
    _preset(
        "idle_back", "Idle — Back", "back",
        "standing idle, relaxed stance, viewed from behind, back to camera",
        _as_back_facing(_neutral),
    ),
    _preset(
        "walk_front_a", "Walk — Front A", "front",
        "marching step, right knee raised high, arms pumping, dynamic stride, facing camera",
        _walk_step(_neutral, +1.0),
    ),
    _preset(
        "walk_front_b", "Walk — Front B", "front",
        "marching step, left knee raised high, arms pumping, dynamic stride, facing camera",
        _walk_step(_neutral, -1.0),
    ),
    _preset(
        "walk_back_a", "Walk — Back A", "back",
        "mid-stride walk cycle, right leg forward, viewed from behind",
        _as_back_facing(_walk_step(_neutral, +1.0)),
    ),
    _preset(
        "hurt_front", "Hurt — Front", "front",
        "violent hit reaction, head thrown back, arms flung up, staggering, taking damage",
        _hurt_recoil(_neutral),
    ),
    _preset(
        "attack_front", "Attack — Front", "front",
        "melee attack swing, right arm extended forward, weapon strike pose, "
        "dynamic action stance",
        _attack_swing(_neutral),
    ),
)

PRESETS_BY_NAME: dict[str, PosePreset] = {p.name: p for p in PRESETS}


def default_sprite_sheet() -> tuple[str, ...]:
    """The recommended starter sprite-sheet lineup (front-heavy, 6 frames)."""
    return (
        "idle_front", "idle_back",
        "walk_front_a", "walk_front_b",
        "hurt_front", "attack_front",
    )


def get_preset(name: str) -> PosePreset:
    if name not in PRESETS_BY_NAME:
        raise KeyError(f"Unknown pose preset: {name!r}")
    return PRESETS_BY_NAME[name]


def render_preset_to_png_bytes(name: str, size: int = 1024) -> bytes:
    """Convenience: render a named preset straight to PNG bytes."""
    img = get_preset(name).render(size=size)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── One-shot tiled sprite sheet helpers ───────────────────────
#
# The tiled sprite generator lays every requested pose skeleton into ONE grid
# canvas, generates the whole sheet in a single ControlNet pass (so all figures
# share identity/costume/lighting by construction), then slices the result back
# into per-pose frames. Validated recipe: 512px cells, 2 columns, skeletons
# FILLING their cells (no gutters — empty space invites a giant central figure).

def grid_dims(n: int, cols: int = 2) -> tuple[int, int]:
    """(cols, rows) for n poses at a fixed column count."""
    cols = max(1, min(cols, n))
    rows = (n + cols - 1) // cols
    return cols, rows


def compose_pose_grid(
    pose_names: Iterable[str],
    cell: int = 512,
    cols: int = 2,
) -> tuple[Image.Image, int, int, int]:
    """
    Composite the named pose skeletons into one grid canvas for one-shot
    generation. Skeletons fill their cells edge-to-edge.

    Returns (canvas, cols, rows, cell). Canvas size is (cols*cell, rows*cell).
    """
    names = list(pose_names)
    if not names:
        raise ValueError("compose_pose_grid needs at least one pose")
    cols, rows = grid_dims(len(names), cols)
    canvas = Image.new("RGB", (cols * cell, rows * cell), (0, 0, 0))
    for i, name in enumerate(names):
        skel = get_preset(name).render(cell)
        canvas.paste(skel, ((i % cols) * cell, (i // cols) * cell))
    return canvas, cols, rows, cell


def slice_pose_grid(
    sheet: Image.Image,
    count: int,
    cell: int,
    cols: int = 2,
) -> list[Image.Image]:
    """Slice a generated grid sheet back into `count` per-cell frames (row-major)."""
    frames: list[Image.Image] = []
    for i in range(count):
        x, y = (i % cols) * cell, (i // cols) * cell
        frames.append(sheet.crop((x, y, x + cell, y + cell)))
    return frames
