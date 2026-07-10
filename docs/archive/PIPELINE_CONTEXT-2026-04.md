# InterForge 3D Asset Pipeline — Full Technical Context

> **Purpose**: Reference document for auditing, researching, and validating the InterForge mesh pipeline.
> **Date**: 2026-04-05
> **Stack**: Tauri 2 (desktop shell) + React (frontend) + FastAPI (backend) + diffusers/PyTorch (inference)

---

## 1. What InterForge Does

InterForge is a desktop AI game asset generator. It takes a **text prompt**, generates a **2D concept image**, converts it to **6 multi-view images** using Zero123++, then reconstructs a **3D mesh** with vertex colors and exports it as GLB/OBJ for game engines.

### 3-Stage Asset Pipeline

| Stage | Name | What Happens |
|---|---|---|
| **Stage 1** | **Prospecting** | SDXL generates a single 2D concept image from a text prompt. rembg removes background → RGBA. vtracer generates SVG silhouette. |
| **Stage 2** | **Smelting** | Zero123++ v1.2 generates 6 consistent views from the prospect image in one forward pass. Each view gets rembg + SVG traced. |
| **Stage 3** | **Forging** | 6 RGBA views + SVG masks → visual hull carving → photo-consistency refinement → Poisson surface reconstruction → vertex coloring → mesh cleanup → LOD generation → GLB export. |

---

## 2. Zero123++ Multi-View Generation (Stage 2)

### Model
- **Model ID**: `sudo-ai/zero123plus-v1.2`
- **Custom Pipeline**: `sudo-ai/zero123plus-pipeline` (custom diffusers `Zero123PlusPipeline`)
- **Architecture**: Stable Diffusion backbone with reference-only attention + CLIP vision encoder
- **VRAM**: ~3GB FP16 on RTX 3070 (no cpu_offload needed)
- **Local cache**: `%APPDATA%/IterForge/models/zero123pp`

### Inference Parameters
| Parameter | Value |
|---|---|
| `num_inference_steps` | 40 |
| `guidance_scale` | 4.0 |
| Output dimensions | `width=640, height=960` (defined in pipeline `__call__`) |
| Output grid | **2 columns × 3 rows** of 320×320 pixel cells |
| Output FoV | 30° (unified in v1.2) |

### Input Preprocessing (matches official `gradio_app.py`)
1. Keep as RGBA (pipeline's `to_rgb_image()` composites onto gray 127 background)
2. Find foreground bounding box (alpha > 32)
3. Crop to bounding box
4. Compute canvas: `side = int(max(crop_w, crop_h) / 0.75)` → object fills ~75% of frame
5. Center cropped object on square gray `(127, 127, 127)` canvas

### Camera Poses (v1.2 — from official repo)

The 6 views are arranged in a **2-column × 3-row** grid (640×960 total, 320×320 per cell).

| Grid Position | View Index | View Name | Azimuth | Elevation | Radius |
|---|---|---|---|---|---|
| Top-left | 0 | `front` | **30°** | **+20°** | 1.5 |
| Top-right | 1 | `front_right` | **90°** | **−10°** | 1.5 |
| Mid-left | 2 | `right` | **150°** | **+20°** | 1.5 |
| Mid-right | 3 | `back` | **210°** | **−10°** | 1.5 |
| Bot-left | 4 | `left` | **270°** | **+20°** | 1.5 |
| Bot-right | 5 | `front_left` | **330°** | **−10°** | 1.5 |

**Pattern**: Left column = high elevation (+20°), right column = low elevation (−10°). Azimuth increments 60° per view in reading order.

**Note**: v1.1 used elevations +30° / −20°. v1.2 changed to +20° / −10°.

### Grid Splitting Code
```python
# Output is width=640, height=960 → 2 cols × 3 rows
cell_w = w // 2   # 320
cell_h = h // 3   # 320
col = idx % 2
row = idx // 2
```

### View Order (row-major)
```python
VIEW_ORDER = ["front", "front_right", "right", "back", "left", "front_left"]
```

---

## 3. Post-Processing (rembg + vtracer)

Each of the 6 smelting views gets:

### Background Removal
- **Library**: `rembg` with `u2net` model (~175MB)
- **Output**: RGBA PNG with transparent background

### SVG Silhouette Tracing
- **Library**: `vtracer`
- **Settings**:
  | Parameter | Value |
  |---|---|
  | `colormode` | `"binary"` |
  | `layer_difference` | 16 |
  | `corner_threshold` | 60 |
  | `length_threshold` | 4.0 |
  | `max_iterations` | 10 |
  | `splice_threshold` | 45 |
  | `filter_speckle` | `max(1, int(20 * (1 - detail)))` — default detail=0.5 → speckle=10 |
  | `color_precision` | `max(4, int(6 + detail * 2))` |
  | `path_precision` | `max(3, int(3 + detail * 5))` |
- **Output**: SVG inner HTML (just `<path>` elements, no outer `<svg>` wrapper)

### File Output Pattern
```
{PROJECTS_ROOT}/{job_id}/smelt/{view_name}/
  ├── image_00.png       # Raw RGB view from Zero123++
  ├── image_00_rgba.png   # After rembg (RGBA, transparent bg)
  └── image_00.svg        # vtracer silhouette paths
```

---

## 4. 3D Reconstruction Pipeline (Stage 3)

### Architecture: 4-Stage Visual Hull + Poisson

The reconstruction takes 6 RGBA images with known camera poses and builds a 3D mesh. **No depth estimation is used** — the alpha silhouettes from 6 views are sufficient for visual hull carving.

### Stage 4.1: SVG Mask Rasterization
- Parse SVG `<path d="...">` attributes (M, L, C, Z commands)
- Cubic Bézier curves subdivided into 10 line segments
- Rasterize to **1024×1024** binary mask (vs 768px raster alpha)
- Skips white/none fills (background paths)
- **Benefit**: Sharper silhouette boundaries than raster alpha masks

### Stage 4.2: Visual Hull Carving
- **Voxel grid**: 256³ = 16.7M voxels
- **Volume bounds**: (−0.8, 0.8) in world coordinates
- **Camera matrices**: 3×4 projection P = K @ Ext[:3,:]
  - Intrinsic K: `focal = image_size × 1.2`, `cx = cy = image_size / 2`
  - Extrinsic: `Rx(−elevation) @ Ry(azimuth)`, translate Z by radius (1.5)
- **Algorithm**:
  1. Initialize all voxels to 1.0 (occupied)
  2. For each camera view:
     - Project all voxels into 2D image coordinates
     - Check which voxels land inside the silhouette mask
     - Voxels outside silhouette in ANY view → multiply by 0 (carved away)
     - Voxels outside image frame → KEPT (no information = don't carve)
  3. Intersection of all 6 silhouettes = visual hull

### Stage 4.3: Photo-Consistency Refinement
- **Purpose**: Carve concavities that silhouettes can't capture
- **Algorithm**:
  1. Find surface shell: `binary_erosion(volume > 0.3, iterations=3)` → XOR with volume
  2. For each shell voxel, project into all 6 views and sample RGB color
  3. Compute per-voxel RGB standard deviation across views where ≥ 2 views see it
  4. If std_dev > **30.0** → likely a concavity → multiply voxel by 0.1
- **Threshold**: 30.0 (RGB channel std dev)

### Stage 4.4: Surface Extraction + Poisson Reconstruction
1. **Gaussian smooth**: sigma=0.8 on voxel volume
2. **Marching cubes**: level=0.3 → vertex positions + triangle indices
3. **Gradient normals**: `np.gradient()` on smoothed volume → negate for outward
4. **Open3D Poisson reconstruction**:
   - `depth=8`, `scale=1.1`, `linear_fit=True`
   - Density-based trimming: remove vertices below 1% density quantile
5. **Vertex color projection**:
   - Project each mesh vertex into all 6 camera views
   - Sample RGB from foreground pixels (alpha > 128)
   - Average across all views that see the vertex
   - Fallback: search expanding neighborhood up to 3px radius
   - Uncolored vertices get gray (128, 128, 128)

### Output
- `trimesh.Trimesh` with vertex colors (RGBA uint8)

---

## 5. Mesh Post-Processing (Forge Worker)

### Cleanup
- `trimesh` fix_winding, fix_normals, fill_holes
- Laplacian smoothing: 3 iterations (organic) / 0 iterations (hard_surface)
- Optional quadric decimation to target face count

### Alpha Centroid Alignment (pre-reconstruction)
- For each view: find foreground centroid via alpha channel
- Shift image so centroid is at image center (if drift > 5px)
- Compensates for Zero123++ object drift between views

### SVG Path Wiring
- Resolve SVGs from: `{PROJECTS_ROOT}/{smelt_job_id}/smelt/{angle}/image_00.svg`
- Read file contents as strings
- Pass as `svg_data` dict to `visual_hull_reconstruct()`
- Graceful fallback: if no SVGs found, uses raster alpha masks only

### Decimation
- Target: 15,000 faces (configurable via `target_poly_count`)
- Method: Open3D `simplify_quadric_decimation` or trimesh fallback

### Repair
- `trimesh.repair.fill_holes()`
- `trimesh.repair.fix_normals()`
- `trimesh.repair.fix_winding()`
- Taubin smoothing: 10 iterations (organic route)

### LOD Generation
| LOD Level | Face Ratio | Min Faces |
|---|---|---|
| LOD0 | 100% | — |
| LOD1 | 50% | 4 |
| LOD2 | 25% | 4 |
| LOD3 | 10% | 4 |

### Export
- **GLB** (primary, via trimesh)
- **OBJ** (via trimesh)
- **FBX** (not supported, falls back to GLB with warning)

### Project Manifest (`project.json`)
```json
{
  "schema_version": "1.0",
  "job_id": "...",
  "export_format": "glb",
  "export_path": "asset.glb",
  "lod_paths": {"lod0": "lod0.obj", ...},
  "texturing": "v2"
}
```

---

## 6. File Structure

```
{PROJECTS_ROOT}/
  {prospect_job_id}/
    prospect/
      image_00.png           # Raw SDXL output
      image_00_rgba.png      # After rembg
      image_00.svg           # vtracer silhouette

  {smelt_job_id}/
    smelt/
      front/
        image_00.png         # Raw Zero123++ view (320x320)
        image_00_rgba.png    # After rembg
        image_00.svg         # vtracer silhouette
      front_right/
        ...
      right/
        ...
      back/
        ...
      left/
        ...
      front_left/
        ...

  {forge_job_id}/
    forge/
      mesh_raw.ply           # Visual hull output
      mesh_decimated.ply     # After quadric decimation
      mesh_repaired.ply      # After repair pass
      lod0.obj - lod3.obj    # LOD chain
      asset.glb              # Final export
      project.json           # Manifest
```

---

## 7. Dependencies & Libraries

| Library | Version | Purpose |
|---|---|---|
| `diffusers` | latest | Zero123++ pipeline |
| `torch` | 2.x | GPU inference |
| `transformers` | latest | CLIP encoder for Zero123++ |
| `rembg` | latest | Background removal (u2net) |
| `vtracer` | latest | SVG silhouette tracing |
| `open3d` | 0.19.0 | Poisson reconstruction, mesh decimation |
| `trimesh` | latest | Mesh I/O, repair, smoothing, export |
| `scipy` | latest | gaussian_filter, binary_erosion |
| `scikit-image` | latest | marching_cubes |
| `numpy` | latest | Everything |
| `Pillow` | latest | Image I/O, resizing |

---

## 8. Configuration

| Setting | Default | Env Variable |
|---|---|---|
| Projects root | `~/interforge-projects` | `INTERFORGE_PROJECTS_DIR` |
| Backend host | `127.0.0.1` | `INTERFORGE_BACKEND_HOST` |
| Backend port | `7842` | `INTERFORGE_BACKEND_PORT` |
| Models root | `%APPDATA%/IterForge/models` | `INTERFORGE_MODELS_DIR` |
| Reconstruction mode | `auto` | `INTERFORGE_RECON_MODE` |

---

## 9. Reconstruction Route Options

| Route | Build Method | Smoothing | Use Case |
|---|---|---|---|
| `hard_surface` | Visual hull + Poisson | 0 Laplacian (sharp edges) | Weapons, architecture |
| `organic` | Visual hull + Poisson | 3 Laplacian + 10 Taubin | Characters, creatures |
| `none` | No mesh generation | — | 2D assets, pass-through |

---

## 10. Key Data Points for Validation

### Camera Matrix Construction
```
Intrinsic K (3×3):
  focal = image_size × 1.2
  cx = cy = image_size / 2
  K = [[focal, 0, cx], [0, focal, cy], [0, 0, 1]]

Extrinsic (4×4):
  rot = Rx(-elevation_rad) @ Ry(azimuth_rad)
  rot[2,3] = radius (1.5)

Projection P (3×4) = K @ Extrinsic[:3,:]
```

### Questions to Validate
1. Are the azimuth values (30/90/150/210/270/330) relative to the INPUT view or absolute? The official repo says "relative to input."
2. Is `focal = image_size × 1.2` correct for Zero123++'s 30° FoV? For 30° FoV: `focal = (image_size/2) / tan(15°) ≈ image_size × 1.866`. Our `1.2` multiplier may be wrong.
3. Is the extrinsic convention `Rx(-el) @ Ry(az)` correct, or should it be `Ry(az) @ Rx(-el)`?
4. The radius 1.5 — is this the actual camera distance used during Zero123++ training?
5. Should the reconstruction account for the alternating elevation (+20°/−10°) or can we approximate all views at the same elevation?

### Known Bugs Fixed This Session
1. **Grid splitting**: Was 3×2 (wrong), fixed to 2×3 (correct). This caused every smelting view to be a mangled fragment.
2. **Camera poses**: Were 0/60/120/180/240/300 at 30° elevation. Fixed to 30/90/150/210/270/330 with alternating +20°/−10° elevation.
3. **Input preprocessing**: Was `.convert("RGB")` (black background). Fixed to proper crop + 75% fill + gray (127) background.
4. **Visual hull silhouette_val**: Was `np.zeros()` (carved everything). Fixed to `np.ones()` (keep voxels with no info).
5. **CAMERA_DISTANCE**: Was hardcoded 2.0. Fixed to read dynamically from CAMERA_POSES (1.5).

---

## 11. Future Considerations

- **InstantMesh (TencentARC)**: Purpose-built for Zero123++ output → mesh. Base variant may fit 8GB VRAM. Could replace the visual hull pipeline entirely.
- **Texture baking**: Currently vertex colors only. UV unwrap + texture map would improve visual quality.
- **Normal maps**: Not generated. Could be derived from the multi-view images.
- **Depth-conditioned generation**: Zero123++ v1.2 pipeline supports `depth_image` input for ControlNet guidance — not currently used.
