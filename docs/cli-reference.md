# IterForge CLI Reference

## Commands

### `iterforge init [options]`

Initialize IterForge in the current project directory.

**Options:**
- `--force` — Overwrite existing `iterforge.json`
- `--silent` — Suppress output

**Example:**
```bash
iterforge init
```

Creates `iterforge.json`, `.mcp.json`, and detects Godot version.

---

### `iterforge doctor`

Check health of the IterForge environment.

**Example:**
```bash
iterforge doctor
```

Verifies Node.js, Python, ComfyUI, Docker, GPU, and MCP config.

---

### `iterforge install`

Install missing managed dependencies (Python, ComfyUI).

**Example:**
```bash
iterforge install
```

Downloads portable Python 3.11 and clones ComfyUI. One-time setup.

---

### `iterforge start <backend>`

Start a generation backend.

**Supported:**
- `comfyui` — Start ComfyUI local image generation
- `all` — Start all available backends

**Example:**
```bash
iterforge start comfyui
```

---

### `iterforge stop <backend>`

Stop a generation backend.

**Example:**
```bash
iterforge stop comfyui
```

---

### `iterforge generate <type> [options]`

Generate a game asset.

**Types (V1):**
- `arena` — Battle environment background (1024×1024)
- `card` — Game card artwork

**Options:**
- `--faction <name>` — AEGIS | ECLIPSE | SPECTER
- `--atmosphere <name>` — midday | nighttime | rain | flooded
- `--condition <name>` — standard | damaged | flooded
- `--zoom <0-4>` — Framing (default: 4)
- `--darkness <0-4>` — Impact zone (default: 3)
- `--noise <0-4>` — Grain level (default: 1)
- `--steps <n>` — Inference steps (default: 30)
- `--cfg <n>` — CFG scale (default: 7.0)
- `--seed <n>` — Fixed seed for reproducibility
- `--dry-run` — Preview prompt without generating
- `--backend <name>` — Force specific backend
- `--export-godot` — Auto-export to Godot after generation

**Examples:**
```bash
# Preview what will be generated
iterforge generate arena --faction ECLIPSE --atmosphere rain --dry-run

# Generate with custom settings
iterforge generate arena --faction AEGIS --zoom 3 --darkness 2

# Reproduce exact image with seed
iterforge generate arena --seed 12345
```

---

### `iterforge mcp`

Start MCP server (stdio JSON-RPC). Used by AI agents (Claude CLI, Gemini CLI).

**Example:**
```bash
iterforge mcp
```

Exposes 5 tools: `generate_asset`, `read_project_context`, `write_project_context`, `get_generation_history`, `get_backend_status`.

---

## Configuration

### `iterforge.json`

Project-level config. Safe to commit (no API keys).

**Key fields:**
- `project.name` — Project name
- `project.godot_version` — Detected Godot version
- `active.faction` — Current faction
- `settings` — Generation defaults (zoom, darkness, steps, cfg, etc.)
- `history` — Last N generations
- `godot_sync.pending_assets` — Assets waiting for Godot import

---

### `%APPDATA%\IterForge\env.json` (Windows)

User-level environment state. Contains no API keys.

**Contains:**
- `tools` — Installed tool paths and versions
- `tier` — Subscription tier (free/plus/pro)
- `runpod` — Cloud endpoint (Pro/Studio only)

---

## Troubleshooting

**ComfyUI not running?**
```bash
iterforge start comfyui
```

**Python or ComfyUI not installed?**
```bash
iterforge install
```

**Want to reproduce an exact image?**
```bash
iterforge generate arena --seed 12345
```

**Check what settings are active?**
```bash
iterforge doctor
```
