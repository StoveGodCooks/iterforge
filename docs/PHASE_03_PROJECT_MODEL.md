# Phase 3 Project Model

Phase 3 establishes the data contract and disk layout for the new InterForge project system.

## Purpose

Projects are the permanent memory layer of InterForge. They must be able to hold:

- notes
- links
- references
- prompt drafts
- saved Prospecting images
- saved Smelting outputs
- saved Forge exports
- Anvil boards
- project activity history

## Source Files

- [projects.ts](/C:/Users/beebo/OneDrive/Desktop/interforge-NEW/src/types/projects.ts)
- [projectStorage.ts](/C:/Users/beebo/OneDrive/Desktop/interforge-NEW/src/components/Projects/projectStorage.ts)

## Core Model

`InterForgeProject` is now the canonical project schema for the expanded workspace.

It includes:

- project metadata
- project stage
- notes
- links
- references
- prompts
- Anvil boards
- saved generation records
- export records
- activity log
- latest Prospecting / Smelting / Forge stage state

## Anvil Model

Anvil is modeled as a project-scoped board document with:

- dimensions
- active tool
- active layer
- palette
- layer metadata
- guide state
- preview/export paths

This keeps Anvil attached to Projects from the start, even before the drawing workspace is implemented.

## Disk Layout

All project content will live under:

```text
interforge-projects/{projectId}/
```

Expected structure:

```text
interforge-projects/
  {projectId}/
    project.json
    notes/
    references/
    links/
    prompts/
    anvil/
      boards/
      exports/
      previews/
    generations/
    exports/
    prospecting/
    smelting/
    forge/
```

## Current Scope

Phase 3 defines the contract only.

It does not yet:

- persist project files to disk
- create project folders automatically
- migrate existing stage data into project manifests
- render project records in the UI

Those behaviors begin in the next implementation phases.
