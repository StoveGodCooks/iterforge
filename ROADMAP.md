# IterForge Roadmap

**Last Updated:** 2026-03-14
**Status:** V1 CLI Complete | V1.1 Desktop App In Planning

---

## Project Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| **V1 CLI Core** | ✅ Complete | All 10 phases done, 8/8 tests passing |
| **ComfyUI Backend** | ✅ Complete | REST API integration, workflow injection |
| **Node.js Environment** | ✅ Complete | Python venv, ComfyUI managed install |
| **MCP Server** | ✅ Complete | 5 tools exposed via stdio JSON-RPC |
| **Godot Plugin** | ✅ Complete | Auto-sync, file locking, timer-based polling |
| **Installer (PowerShell)** | ✅ Complete | Install.ps1 with system validation |
| **CI/CD** | ✅ Complete | GitHub Actions — tests on Win/Mac/Linux + cross-platform releases |
| **AI Models** | ✅ Installed | `sd_xl_base_1.0.safetensors` (6.5GB) at `%APPDATA%\IterForge\comfyui\models\checkpoints\` |

---

## V1 — CLI Pipeline (COMPLETE)

All 10 phases finished. Users can run:
```bash
iterforge init          # Set up Godot project
iterforge doctor       # Check system health
iterforge start comfyui # Start generation server
iterforge generate arena --faction AEGIS  # Generate images
iterforge mcp          # Start AI agent server
```

### What V1 Includes
- ✅ Node.js CLI with 7 commands
- ✅ ComfyUI SDXL txt2img integration
- ✅ Atomic config management (iterforge.json)
- ✅ Godot 4 plugin with auto-import
- ✅ MCP interface for Claude/Gemini
- ✅ Python 3.11.9 venv + managed install
- ✅ Full test coverage (unit + integration + E2E)
- ✅ Privacy-first (all local, no cloud)

### Known Limitations (V1)
- No GUI — CLI only
- Single backend (ComfyUI)
- Single workflow (txt2img)
- No reference/inspiration images
- No custom templates
- No model selection UI

---

## V1.1 — Desktop App (IN PLANNING)

### Phase 12: Desktop Launcher & App Shell
**Status:** Planning Phase
**Description:** Create Node.js launcher that starts Express server + ComfyUI + opens browser
**Dependencies:** None (follows V1)
**Output:** `IterForge.exe` shortcut that opens `localhost:3000` dashboard

### Phase 13: React Frontend & UI Components
**Status:** Planning Phase
**Description:** Build web UI with left sidebar controls and dominant image display area
**Dependencies:** Phase 12
**Output:** React app with GenerationPanel, PreviewArea, HistoryPanel

### Phase 14: Express Backend & Generation API
**Status:** Planning Phase
**Description:** REST endpoints for generation, templates, history, models
**Dependencies:** Phase 12, Phase 13
**Output:** `/api/generate`, `/api/history`, `/api/templates`, `/api/models` endpoints
**Storage Strategy:**
- Images saved to disk: `%APPDATA%/IterForge/assets/generated/{timestamp}_{seed}.png`
- History metadata: `%APPDATA%/IterForge/history.json` (JSON only, no base64)
- Browser localStorage: UI state only (collapsed panels, last model)
- Express serves images as file URLs, not from memory

### Phase 15: Reference Image Handling
**Status:** Planning Phase
**Description:** Image-to-image remix + visual reference modes
**Dependencies:** Phase 14
**Output:** File upload UI, ControlNet workflow, img2img endpoints

### Phase 16: Smart Installer
**Status:** Planning Phase
**Description:** Inno Setup installer with system detection + privacy messaging
**Dependencies:** Phase 13 + Phase 14 (built app must exist)
**Output:** `IterForge-Setup.exe` with detection, recommendations, models selection

### Phase 17: Custom Template System
**Status:** Planning Phase
**Description:** Save/load generation recipes
**Dependencies:** Phase 14
**Output:** Template CRUD, UI, persistent storage

### Phase 18: Privacy-First Storage & File Management
**Status:** Planning Phase
**Description:** Transparent file handling, no telemetry
**Dependencies:** Phase 14
**Output:** Settings panel showing disk usage, folder location, privacy notices

### Phase 19: Settings Panel & Model Management
**Status:** Planning Phase
**Description:** Model selection, installation, deletion
**Dependencies:** Phase 13, Phase 14
**Output:** Settings UI with model browser, version info

### Phase 20: Error Handling & Graceful Degradation
**Status:** Planning Phase
**Description:** Helpful error messages, actionable fixes
**Dependencies:** Phase 13, Phase 14
**Output:** Error banner UI, recovery suggestions

### Phase 21: Testing & Deployment
**Status:** Planning Phase
**Description:** Unit tests, E2E tests, release automation
**Dependencies:** All other phases
**Output:** Jest tests, Cypress E2E, GitHub release workflow

---

## V1.1 Design Decisions

### UI Layout
- **Left sidebar (280px):** All generation controls (mode, prompts, advanced settings)
- **Main area:** Large image display (dominant), history thumbnails below
- **Collapsible:** Hamburger menu on mobile
- **Color scheme:** Dark mode with cyan/purple accents

### Generation Control Levels
- **Presets:** Quick arena/card/sprite/character templates
- **Custom:** Free-form text prompt + negative prompt
- **Templates:** User-defined recipes with saved parameters
- **Advanced:** Full control (model, resolution, seed, steps, CFG, sampler)

### Storage Architecture
- **All local:** No cloud sync, no subscriptions
- **Disk-first:** Images and history stored on disk, not in browser
- **Browser storage minimal:** Only UI state
- **Express backend:** Serves images and data from disk

---

## V2 — Advanced Features (Future)

- Easy Diffusion backend fallback
- InvokeAI support
- Hugging Face free tier integration
- ControlNet for advanced image manipulation
- Multi-GPU queuing
- Sprite sheet generation (ConsiderNet workflow)
- Cloud sync (optional, opt-in)
- Vectorize command (Inkscape integration)
- Real-time collaboration

---

## Implementation Order (V1.1)

1. Phase 12 — Launcher
2. Phase 13 — React UI skeleton
3. Phase 14 — Express backend
4. Integrate 13 + 14
5. Phase 15 — Reference images
6. Phase 16 — Installer
7. Phase 17 — Templates
8. Phase 18–20 — Polish
9. Phase 21 — Testing & release

---

## Amendments & Notes

### Amendment 1: Storage Strategy (2026-03-14)
**Added to:** Phase 14, Phase 18
**Reason:** User identified browser storage limits (5-10MB). Changed to disk-first architecture:
- Images written to disk immediately after generation
- History stored as JSON on disk, not in browser
- Browser only holds transient UI state
- Express backend serves images as file paths
**Impact:** Prevents storage crashes, scales to unlimited generations

---

## Current Blockers

None for V1 CLI. For V1.1:
- PyTorch CUDA installed in venv — ComfyUI server needs to be verified as launching cleanly
- Model ready: `sd_xl_base_1.0.safetensors` (6.5GB) installed in ComfyUI checkpoints folder
- Next step: verify `iterforge start comfyui` successfully opens port 8188 with the installed model

---

## Files to Create/Update (V1.1)

| Phase | Files |
|-------|-------|
| 12 | `launcher/launcher.js`, `src/app.js` |
| 13 | `frontend/src/App.jsx`, `frontend/src/components/*.jsx` |
| 14 | `src/api/routes/generation.js`, `src/api/routes/templates.js`, `src/api/routes/status.js` |
| 15 | `comfyui-workflows/arena-img2img-sdxl.json`, update `src/backends/comfyui.js` |
| 16 | `installers/windows-installer.iss`, `installers/installer-logic.js` |
| 17 | `src/api/routes/templates.js` (update), `frontend/src/components/TemplateManager.jsx` |
| 18 | `src/api/routes/storage.js` (optional), update `src/app.js` |
| 19 | `frontend/src/components/SettingsPanel.jsx`, `src/api/routes/models.js` |
| 20 | `src/api/middleware/errorHandler.js`, update all routes |
| 21 | `test/e2e/*.test.js`, `.github/workflows/build-installer.yml` |

