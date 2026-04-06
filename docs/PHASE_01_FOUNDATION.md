# Phase 1 Foundation

This document locks the product rules for the InterForge expansion before the larger UI and feature work begins.

## Product Direction

InterForge is expanding from a stage-based generation tool into a creative workspace with:

- a cinematic first-run walkthrough
- a serious brainstorming board called `Anvil`
- a persistent `Projects` area for saved creative work
- a clearer split between guided workflow and Tinker experimentation

## Locked Decisions

### Onboarding

- The app shows a branded walkthrough on first launch.
- The walkthrough is cinematic in tone, but still practical.
- The walkthrough must explain the exact role of Prospecting, Smelting, Forge, Tinker Mode, Anvil, and Projects.
- The walkthrough must be reopenable later.

### Anvil

- `Anvil` is a serious artistic brainstorming board, not a toy sketch pad.
- `Anvil` opens from the Forge tab.
- `Anvil` is part of the creative workflow, but not a pipeline stage of its own.
- `Anvil` outputs should be saveable into the current project.
- `Anvil` should support direct creative iteration for Tinker workflows.

### Tinker Mode

- Tinker Mode bypasses the standard stage gates.
- Prospecting can feed Forge directly while Tinker Mode is active.
- Anvil outputs should be usable in experimental flows.
- The UI must clearly communicate when a user is on the standard path versus the bypass path.

### Projects

- Projects become the permanent memory layer for InterForge.
- Users need a dedicated Projects area, not just loose files on disk.
- Projects must support saving:
  - generated images
  - locked concepts
  - Smelting outputs
  - Forge exports
  - Anvil boards
  - notes
  - links
  - imported reference images
  - prompt drafts
- Project content should be stored in the user's InterForge projects folder on disk.

## Product Systems To Build

### Guided Workflow

The standard path remains:

1. Prospecting
2. Smelting
3. Forge

This is the recommended production path and must stay legible for new users.

### Experimental Workflow

Tinker Mode unlocks:

- direct navigation between stages
- Prospecting-to-Forge bypass
- Anvil-assisted experimentation
- looser creative iteration before production cleanup

### Project Memory

Every major creative artifact should be saveable into a project and recoverable later.

This includes:

- visual references
- prompt intent
- sketch boards
- saved generations
- final exports

## Implementation Boundaries

### Phase 1 Includes

- locking product rules in the repo
- creating minimal top-level scaffolding for the Projects area
- keeping the codebase ready for onboarding and Anvil work

### Phase 1 Does Not Include

- the actual walkthrough UI
- the actual Anvil workspace
- full project persistence
- large visual redesign work

Those begin in later phases after the foundation is stable.

## Next Phases

- Phase 2: information architecture and top-level app layout
- Phase 3: project data model and disk structure
- Phase 4: Projects tab implementation
- Phase 5: onboarding overlay
- Phase 6: Anvil v1
- Phase 7+: polish, persistence, and cross-linking
