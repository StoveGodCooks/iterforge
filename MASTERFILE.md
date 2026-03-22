# INTER-FORGE: Master Architectural Blueprint

## 1. Project Vision & Goal
**Inter-Forge** is a professional-grade, open-source game asset generation orchestrator. Its primary goal is to bridge the gap between **2D AI Generation** and **3D Game-Ready Assets**. 

Unlike simple "image-to-3D" wrappers, Inter-Forge implements an **Engineered Pipeline** that treats 2D artwork as a mathematical blueprint. It uses a combination of CAD kernels, neural depth estimation, and vector path extraction to create "Solid 3D Data" that is watertight, symmetrical, and ready for industrial use or high-end game engines.

---

## 2. Core Technical Philosophies
- **Numerical over Raster:** Prefer SVG vector paths for edges to eliminate "pixel noise" and "roughness."
- **Generative over Template:** Use mathematical lofting (Adaptive Ellipsoids) to build unique geometry instead of skinning static presets.
- **Identity Locking:** Use IP-Adapter and pHash/SSIM quality gates to ensure consistency across multiviews and sprite frames.
- **Local-First:** All heavy lifting (ComfyUI, Blender, MasterForge, TripoSR) runs on the user's local machine via managed environments.

---

## 3. High-Level File Structure

### 📂 `src/pipeline/` (The "Conductor")
The central orchestration layer that standardizes end-to-end jobs.
- **`orchestrator.js`**: The MasterForgePipeline. Manages Stage 1 (Generate), Stage 2 (Multiview), Stage 3 (Forge), and Stage 4 (Deliver).
- **`job.js`**: State container and progress tracker for atomic pipeline runs.
- **`assetTypes.js`**: Registry of asset categories, IP-Adapter weights, and consistency thresholds.

### 📂 `src/3d/masterforge/` (The "Brain")
The primary generative Python engine.
- **`run.py`**: Entry point. Now supports `--left-image`, `--right-image`, and merged multiview depth routing.
- **`multiview.py`**: Merges side profiles into a unified Z-depth map; detects asymmetry.
- **`quality.py`**: IdentityLock system. Uses phash, SSIM, and color histograms to validate AI generation consistency.
- **`trace.py`**: Extracts high-precision coordinates from SVG paths or raster masks.
- **`loft.py`**: Sculptor using **CadQuery** to loft 3D rings into a solid mesh.
- **`export.py`**: Implements vertex-color GLB projection, Open3D Laplacian smoothing, and mask-aware nearest-foreground sampling.
- **`sprite_post.py`**: Frame normalization, grid packing, and Godot `.tres` metadata generation.

---

## 4. Standard User Workflow (The Three Tab Flow)

1.  **✦ FORGE (Concept):**
    - Generate concept art via ComfyUI.
    - **Lock Asset:** Freezes the identity source.
    - "Smelt This" button triggers navigation to Tab 2.

2.  **♨ SMELTING (Identity Locking):**
    - Generate 3 or 4 orthographic views (Front, Left, Right, optional Back).
    - **Identity Gate:** Automatic scoring (pHash + color histogram) against source.
    - **Alignment Gate:** Y-span validation ensures consistent scale across views.
    - Minimum requirement: Front + Left + Right approved views.

3.  **⬡ MASTERFORGE (Final Output):**
    - **Fork A (Mesh):** Standardized 3D reconstruction (GLB/STL/DXF) using multiview depth merging.
    - **Fork B (Sprites):** Robust sprite sheet loop with auto-retries and Godot metadata.

---

## 5. API Contracts & Error Handling

### `QUALITY_GATE_FAILURE` (Structured Diagnostic)
When a sprite frame or smelting view fails consistency checks, the orchestrator throws a structured JSON error:
```json
{
  "type": "QUALITY_GATE_FAILURE",
  "frame": 2,
  "attempts": 3,
  "score": "0.642",
  "threshold": 0.75,
  "diagnosis": [
    "Color palette has drifted significantly from the reference..."
  ],
  "suggestion": [
    "Try increasing the IP-Adapter weight..."
  ]
}
```
The backend routes catch this and store it in the `diagnostic` field of the job object for the frontend to render.

---

## 6. Full Rebuild Plan Status (v1.1)

- [x] **Phase 0 — Config Foundation:** `assetTypes.js` implemented.
- [x] **Phase 1 — Environment Upgrade:** `imagehash`, `Advanced-ControlNet`, `FaceID`.
- [x] **Phase 2 — Python Core Tools:** `quality.py`, `multiview.py`, `sprite_post.py`.
- [x] **Phase 3 — 3D Engine (run.py):** Multiview support & Open3D smoothing.
- [x] **Phase 4 — Smelting Route:** Asynchronous identity generation & polling.
- [x] **Phase 5 — Pipeline Orchestrator:** Unified `MasterForgePipeline` class.
- [x] **Phase 6 — Frontend (Three Tab Flow):** UI built and wired.
- [x] **Phase 7 — Cleanup:** Removed `router.js`, secured IPC, lazy-loaded `ModelViewer`.

---

## 7. Current Sprint: Manual Path Integration (v1.2)

### 🖋️ SVG Numerical Editing
- [ ] **Inkscape Bridge:** Implement `POST /api/inkscape/edit` to export current coordinates to SVG and launch Inkscape.
- [ ] **Live Watcher:** Implement a Node.js file watcher that re-ingests numerical coordinates into the forge stage on every save.

### 💎 Materials & PBR
- [ ] **Materials Engine:** Extract PBR maps (Metallic, Roughness, Normal) from 2D artwork using specialized ComfyUI nodes.

---

## 8. Future Roadmap
- **Godot Bridge:** Real-time sync of generated `.glb` and `.tres` assets into active Godot projects via Editor Plugin.
