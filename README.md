# IterForge — Game Asset Generation Pipeline Orchestrator

Generate game assets using AI. Create arenas, cards, and more from text descriptions. Integrated with ComfyUI locally, with optional cloud backend.

**Status: V1 (Alpha)** — Core pipeline implemented. Test suite passes.

## Quick Start (5 Minutes)

### 1. Install

```bash
npm install -g iterforge
```

### 2. Initialize Your Project

```bash
cd your-godot-4-project
iterforge init
```

This creates `iterforge.json` and MCP config for AI agents.

### 3. Check Environment

```bash
iterforge doctor
```

Verify Node, Python, ComfyUI are ready. Install missing tools:

```bash
iterforge install
```

(Downloads Python 3.11 + ComfyUI. Takes ~2-5 min. One-time only.)

### 4. Start ComfyUI Backend

```bash
iterforge start comfyui
```

### 5. Generate Your First Asset

```bash
iterforge generate arena --faction AEGIS --dry-run
```

Try without the `--dry-run` flag to actually generate (ComfyUI must be running).

### 6. Assets Auto-Import to Godot

When you generate an asset, it's placed in `assets/iterforge/`. Enable the IterForge plugin in Godot 4 and it auto-imports to your project.

## Features (V1)

- **CLI Pipeline**: `iterforge generate` with customizable settings
- **ComfyUI Backend**: Local, GPU-powered image generation
- **Godot Integration**: Auto-import assets directly into your Godot 4 project
- **MCP Interface**: AI agents (Claude CLI, Gemini CLI) can drive the full pipeline
- **Zero Accounts**: Fully local, works offline, no logins required

## Supported Asset Types (V1)

- `arena` — Battle environment backgrounds (1024x1024)
- `card` — Game card artwork (coming soon)

## Architecture

```
iterforge (Node.js CLI)
├── ComfyUI backend (local, GPU-powered)
├── Godot plugin (4.x only)
└── MCP server (for AI agents)
```

## Documentation

- **[Godot Setup](docs/godot-setup.md)** — Install and enable the plugin
- **[CLI Reference](docs/cli-reference.md)** — All commands and options
- **[Architecture](docs/architecture.md)** — Design patterns and internals

## Development

Run tests:
```bash
npm test
```

## License

Proprietary. See LICENSE file.

## Support

- Issues: GitHub (coming soon)
- Discord: (community server — link TBA)
- Docs: https://iterforge.itch.io

---

Made with ❤️ for game developers.
