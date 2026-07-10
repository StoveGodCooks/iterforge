# InterForge

**A free, local, open-source AI game-asset pipeline.** Turn a text prompt into a
textured 3D model — concept art, directional sprites, and a game-ready `.glb` —
entirely on your own machine. No subscriptions, no cloud, no data leaving your PC.

> ⚠️ **Work in progress.** InterForge is under active development and not yet
> feature-complete. Expect rough edges. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## What it does

InterForge is a desktop app that walks an asset through a staged pipeline:

| Stage | What it does |
|-------|--------------|
| **Prospect** | Generate concept art from a text prompt (SDXL / DreamShaper XL via `diffusers`), optionally guided by a reference image (IP-Adapter) and pose (ControlNet). Pick the best image and lock it. |
| **Smelt** | Turn the locked concept into directional views / sprite frames (front, back, left, right) for 2D sprites or downstream 3D. |
| **Forge** | Produce geometry from the locked image. The 3D route uses **Stable Fast 3D (SF3D)** — a single image → UV-textured mesh in one pass. Also supports 2.5D depth relief, flat billboard, and 2D-only (no mesh) routes. Exports `.glb`. |
| **Anvil** | A sketch/storyboard board for planning assets. |

Models are **downloaded on first run** (via the in-app setup wizard) — no weights
are shipped in this repo.

## Tech stack

- **Desktop shell:** Tauri 2 (Rust) — uses the system WebView, ~10 MB vs Electron
- **Frontend:** React 18 + TypeScript + Vite (dev server on port **1420**)
- **Backend:** Python 3.11 + FastAPI + uvicorn (API on port **7842**), SSE job streaming
- **AI/ML:** PyTorch, `diffusers` (SDXL), `rembg`, `trimesh`, and Stable Fast 3D

## Hardware & platform support

The baseline target is an **8 GB NVIDIA GPU** (e.g. RTX 3070) with **CUDA 12.1**.
The VRAM arbiter keeps only one heavy model resident at a time so the pipeline
fits in 8 GB. A CPU-only install runs the frontend/API for development but cannot
perform GPU inference.

| Platform | UI | Image gen (SDXL) | 3D mesh (SF3D) |
|----------|----|------------------|-----------------|
| **Windows + NVIDIA (CUDA 12.1)** | ✅ | ✅ | ✅ — primary target |
| **Linux + NVIDIA (CUDA 12.1)** | ✅ | ✅ | ✅ — run the backend/frontend manually (see below) |
| **macOS** | ✅ | ⚠️ CPU-only, very slow | ❌ — see note |
| **Any, CPU-only** | ✅ | ⚠️ very slow | ❌ |

> **macOS note:** the desktop UI runs, but inference is currently **CUDA-only** and
> falls back to CPU (no Metal/MPS acceleration yet). SF3D's mesh-texture step is a
> CUDA extension that doesn't build on macOS, so the 3D pipeline won't run there.
> Metal/MPS support is on the [roadmap](docs/ROADMAP.md).

---

## Getting started

### Prerequisites

1. **Node.js** 18+ and npm
2. **Rust toolchain** (for Tauri) — install via [rustup](https://rustup.rs/)
3. **Python 3.11** (specifically 3.11 — see `.python-version`; newer versions lack some ML wheels)
4. An **NVIDIA GPU + CUDA 12.1** for inference (optional for UI-only dev)

### 1. Frontend

```bash
npm install
```

### 2. Backend (Python)

```bash
cd interforge-backend

# Create and activate a virtual environment (Python 3.11)
py -3.11 -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux

# Install PyTorch FIRST with the matching CUDA wheel:
pip install torch --index-url https://download.pytorch.org/whl/cu121
#   (CPU-only dev, no inference:  pip install torch)

# Then the rest of the backend deps:
pip install -r requirements.txt

# Finally, Stable Fast 3D (the 3D engine — GPU only, installs from git):
pip install git+https://github.com/Stability-AI/stable-fast-3d.git
```

> See [`requirements.txt`](interforge-backend/requirements.txt) for the full,
> ordered install notes. `torch` and SF3D are intentionally not in that file
> because they need special index URLs / git and can't resolve from plain PyPI.

### 3. Run it

**Full desktop app** (Tauri spawns the backend automatically):

```bash
npm run tauri dev
```

**Browser-only dev** (backend + Vite in separate windows, open http://localhost:1420):

```powershell
# Windows
./run-dev.ps1
```

The Windows launchers (`run-dev.ps1`, `Launch-InterForge-Dev.bat`) use the `py -3.11`
launcher and Windows shell tools. On macOS/Linux, start the two processes manually:

```bash
# terminal 1 — backend
cd interforge-backend && uvicorn main:app --host 127.0.0.1 --port 7842
# terminal 2 — frontend
npm run dev
```

### 4. First launch

On first run, open the **setup wizard** in-app to download the required model
weights (SDXL checkpoint, ControlNet, IP-Adapter). These are large (several GB)
and cached locally under `interforge-backend/models/` (git-ignored).

---

## Project layout

```
interforge-NEW/
├── src/                  React + TypeScript frontend
├── src-tauri/            Tauri 2 (Rust) desktop shell
├── interforge-backend/   FastAPI + Python inference backend
│   ├── api/              HTTP routes (prospect, smelt, forge, publish, setup, dev)
│   ├── core/             job manager, SSE, config, profiler
│   ├── workers/          pipeline job runners (prospect / smelt / forge / setup)
│   ├── inference/        model engines (SDXL ForgeEngine, SF3DEngine, depth)
│   ├── masterforge/      asset-type rules engine (prompts, styles, presets)
│   └── tests/            pytest unit + integration tests
└── docs/                 roadmap, dev log, phase notes (archive/ = legacy)
```

## Testing

```bash
cd interforge-backend
python -m pytest        # backend unit + integration tests

# from repo root — frontend type-check
npm run build           # runs tsc && vite build
```

## License

InterForge's **source code** is licensed under the [MIT License](LICENSE).

The **AI models and weights** it downloads and uses are governed by their own
separate licenses — see [`LICENSES.md`](LICENSES.md). Those may restrict
commercial use of the models and their outputs regardless of the code license.

## Contributing

This is an open-source project — issues and pull requests are welcome. Please
keep changes scoped and run the tests above before opening a PR.
