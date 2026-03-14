# IterForge Quickstart — Working in 5 Minutes

This guide gets you from zero to your first generated asset in Godot.

---

## Step 1 — Install IterForge (1 min)

```bash
npm install -g iterforge
```

Verify:
```bash
iterforge --version
```

---

## Step 2 — Initialize Your Godot 4 Project (30 sec)

```bash
cd path/to/your-godot-project
iterforge init
```

**What this does:**
- Detects your Godot version
- Creates `iterforge.json` (project config)
- Creates `.mcp.json` (for AI agents like Claude CLI)

---

## Step 3 — Install Backends (2-5 min, one-time only)

```bash
iterforge install
```

Downloads portable Python 3.11 and ComfyUI. Takes 2-5 minutes depending on your connection. This only runs once — subsequent installs are instant.

Verify everything is set up:
```bash
iterforge doctor
```

You want Node.js, Python, and ComfyUI (install) to show **OK**. Docker and GPU will show WARN if not present — that's fine for now.

---

## Step 4 — Start ComfyUI (30 sec)

```bash
iterforge start comfyui
```

Wait for the "ComfyUI started" confirmation. It polls port 8188 automatically.

> **No GPU?** ComfyUI runs in CPU mode — generation takes 8-15 min instead of 15-30 sec. It still works.

---

## Step 5 — Generate Your First Asset (15-30 sec)

Preview what will be generated (no image created):
```bash
iterforge generate arena --faction AEGIS --dry-run
```

Generate for real:
```bash
iterforge generate arena --faction AEGIS
```

Your asset appears in `assets/iterforge/`.

---

## Step 6 — Auto-Import to Godot

Copy the plugin into your project:
```
godot-plugin/addons/iterforge/  →  res://addons/iterforge/
```

Then in Godot: **Project → Project Settings → Plugins → IterForge → Enable**

The dock appears on the right. From now on, every generated asset **automatically imports** into Godot — no manual steps.

---

## You're Done

```
iterforge generate arena --faction AEGIS
→ assets/iterforge/arena_aegis_midday_standard_12345.png
→ Godot auto-imports the asset
```

---

## Common Options

```bash
# Change faction
iterforge generate arena --faction ECLIPSE

# Change atmosphere
iterforge generate arena --atmosphere rain

# Reproduce exact image
iterforge generate arena --seed 12345

# All options at once
iterforge generate arena --faction SPECTER --atmosphere nighttime --darkness 4 --zoom 2
```

---

## Use with Claude / Gemini CLI (AI Agent Mode)

After `iterforge init`, your AI agent can drive the entire pipeline:

```bash
claude "generate a rain-soaked ECLIPSE arena and import it to Godot"
# Claude calls iterforge MCP tools automatically
```

The MCP config is already written to `.mcp.json` and `.claude/settings.json` by `iterforge init`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `iterforge: command not found` | Open a new terminal, or run `npm install -g iterforge` again |
| ComfyUI not starting | Run `iterforge doctor` and follow fix instructions |
| Black image generated | SDXL model missing — run `iterforge install --model now` |
| Godot dock not showing | Ensure plugin is enabled in Project Settings → Plugins |
| Asset not importing | Click **Sync Now** in the dock, or run `iterforge doctor` |

---

## Next Steps

- **[CLI Reference](cli-reference.md)** — All commands and options
- **[Godot Setup](godot-setup.md)** — Full plugin documentation
- **[Architecture](architecture.md)** — How it all fits together
