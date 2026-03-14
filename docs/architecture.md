# IterForge Architecture

## Overview

IterForge is a **pipeline orchestrator**, not an image generator. It coordinates tools and backends — ComfyUI does the actual image work, Godot handles the game engine, AI agents drive it all via MCP.

```
┌─────────────────────────────────────────────────────────┐
│                     Interfaces                          │
│  CLI (human)    GUI (Electron)    MCP (AI agents)       │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                  IterForge Core                         │
│  generate.js  ←  router.js  ←  backends/               │
│  context/      env/            prompts/                 │
└───────┬────────────────────────────────┬────────────────┘
        │                                │
┌───────▼──────┐              ┌──────────▼──────────┐
│  ComfyUI     │              │  Godot 4 Plugin      │
│  (host GPU)  │              │  (auto-import dock)  │
└──────────────┘              └─────────────────────┘
```

## Two Modes

| Mode | How | Who |
|------|-----|-----|
| **CLI / Agent** | Headless subprocess. Returns JSON. | Claude CLI, Gemini CLI, humans |
| **GUI** | Electron popup with sliders/preview. | Developers manually |

## Hybrid Container Model (V2)

V1 runs everything natively. V2 will use Docker for orchestration tools (Inkscape, Blender) while ComfyUI stays on the host for direct GPU access.

| Layer | Contents | Reason |
|-------|----------|--------|
| Host (V1) | Everything | Simple, direct GPU access |
| Docker container (V2) | Inkscape, Blender, Synfig | Clean isolated installs |
| Host native (V2) | ComfyUI, LLM CLIs, Godot | Needs direct GPU access |
| RunPod serverless (V2) | Cloud ComfyUI | Pro/Studio users, zero idle cost |

## Key Files

```
bin/iterforge.js          ← CLI entry point (Commander.js)
src/
  cli/                    ← One file per command
    init.js               ← Project setup, MCP config writing
    doctor.js             ← Dependency health check
    generate.js           ← Asset generation (builds prompt, routes backend, updates context)
    start.js / stop.js    ← Backend lifecycle
  backends/
    router.js             ← Priority chain: ComfyUI → Easy Diffusion → HF → RunPod
    comfyui.js            ← ComfyUI API client (healthCheck, verifyModel, generate)
  context/
    manager.js            ← iterforge.json CRUD (atomic writes)
    schema.js             ← DEFAULT_CONFIG shape
  env/
    reader.js             ← Read env.json (ITERFORGE_HOME)
    writer.js             ← Write env.json (atomic, deep merge)
    detector.js           ← System health checks (node, python, comfyui, gpu)
    manager.js            ← Tool installers (Python, ComfyUI)
  prompts/
    engine.js             ← PromptEngine.build() → { positive, negative }
    templates.js          ← All faction/atmosphere/condition/level term arrays
  mcp/
    server.js             ← MCP stdio server (5 tools)
godot-plugin/addons/iterforge/
  plugin.cfg              ← Godot plugin metadata (min_godot_version=4.0)
  iterforge_dock.gd       ← EditorPlugin — adds dock to editor
  iterforge_client.gd     ← Polls iterforge.json, triggers filesystem scan
  iterforge_dock.tscn     ← Dock UI scene
comfyui-workflows/
  arena-txt2img-sdxl.json ← SDXL workflow with __TOKEN__ placeholders
```

## Data Flow — Generate Command

```
iterforge generate arena --faction AEGIS
    │
    ▼
1.  Read iterforge.json     (ContextManager.read)
2.  Merge CLI flags over stored settings
3.  Build prompt            (PromptEngine.build)
4.  Verify model loaded     (comfyui.verifyModel → GET /object_info)
5.  Submit workflow         (comfyui.generate → POST /prompt)
6.  Poll until done         (GET /history/{id} every 500ms)
7.  Fetch PNG               (GET /view?filename=...)
8.  Rename to spec §A9 convention
9.  Write iterforge.json    (last_generated, history, pending_assets)
    │
    ▼
Godot plugin detects pending_assets → scan() → asset appears in editor
```

## Data Flow — MCP (AI Agent)

```
Claude CLI
    │  calls tool via MCP stdio
    ▼
iterforge mcp (StdioServerTransport)
    │  dispatches to handler
    ▼
generate_asset handler
    │  calls runGenerate() (same as CLI)
    ▼
{ success, image_path, seed, backend_used, prompt_used }
    │
    ▼
Claude CLI receives JSON result
```

## Config Files

### `iterforge.json` (project-level, git-safe)
Tracks project state: active faction, settings, history, pending Godot assets.

### `%APPDATA%/IterForge/env.json` (user-level, never commit)
Tracks installed tool paths, tier, RunPod endpoint. No API keys ever stored here.

### `pids.json` (runtime, user-level)
Maps backend name → PID. Written by `start`, read by `stop`.

## Error Handling Pattern

Every error follows spec §A1 format:
```
✗ [ERR_CODE] Short message
  Detail: what failed
  Fix:    exact command
```

MCP errors return the same codes in JSON:
```json
{ "success": false, "error": { "code": "ERR_CODE", "message": "...", "fix": "..." } }
```

## Atomic Write Protocol

Both Node.js and the Godot plugin use the same protocol to prevent write collisions:

**Node.js side:**
1. Write to `iterforge.json.tmp`
2. Rename to `iterforge.json`
3. Check for `iterforge.json.lock` before writing

**Godot plugin side:**
1. Create `iterforge.json.lock` before writing
2. Write to `iterforge.json.tmp` → rename
3. Delete `iterforge.json.lock`

If the lock exists, the Godot plugin skips that poll cycle.

## V1 Scope vs Future

| Feature | V1 | V1.1 | V2 |
|---------|-----|-------|-----|
| ComfyUI backend | ✓ | ✓ | ✓ |
| Easy Diffusion / InvokeAI | — | ✓ | ✓ |
| HuggingFace Free Tier | — | ✓ | ✓ |
| RunPod cloud (Pro/Studio) | — | — | ✓ |
| MCP server | ✓ | ✓ | ✓ |
| Electron GUI | — | — | ✓ |
| Docker orchestration | — | — | ✓ |
| Blender / Inkscape | — | — | ✓ |
| Arena + card generation | ✓ | ✓ | ✓ |
| Sprite + icon generation | — | ✓ | ✓ |
