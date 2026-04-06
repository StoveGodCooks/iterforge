import type { InterForgeProject } from "../../types/projects";

export const PROJECTS_ROOT_DIRNAME = "interforge-projects";
export const PROJECT_MANIFEST_FILENAME = "project.json";

export const PROJECT_SUBDIRS = {
  notes: "notes",
  references: "references",
  links: "links",
  prompts: "prompts",
  anvil: "anvil",
  anvilBoards: "anvil/boards",
  anvilExports: "anvil/exports",
  anvilPreviews: "anvil/previews",
  generations: "generations",
  exports: "exports",
  prospecting: "prospecting",
  smelting: "smelting",
  forge: "forge",
} as const;

export interface ProjectDiskLayout {
  root: string;
  manifest: string;
  notesDir: string;
  referencesDir: string;
  linksDir: string;
  promptsDir: string;
  anvilDir: string;
  anvilBoardsDir: string;
  anvilExportsDir: string;
  anvilPreviewsDir: string;
  generationsDir: string;
  exportsDir: string;
  prospectingDir: string;
  smeltingDir: string;
  forgeDir: string;
}

export function slugifyProjectName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled-project";
}

export function buildProjectDiskLayout(projectId: string): ProjectDiskLayout {
  const root = `${PROJECTS_ROOT_DIRNAME}/${projectId}`;

  return {
    root,
    manifest: `${root}/${PROJECT_MANIFEST_FILENAME}`,
    notesDir: `${root}/${PROJECT_SUBDIRS.notes}`,
    referencesDir: `${root}/${PROJECT_SUBDIRS.references}`,
    linksDir: `${root}/${PROJECT_SUBDIRS.links}`,
    promptsDir: `${root}/${PROJECT_SUBDIRS.prompts}`,
    anvilDir: `${root}/${PROJECT_SUBDIRS.anvil}`,
    anvilBoardsDir: `${root}/${PROJECT_SUBDIRS.anvilBoards}`,
    anvilExportsDir: `${root}/${PROJECT_SUBDIRS.anvilExports}`,
    anvilPreviewsDir: `${root}/${PROJECT_SUBDIRS.anvilPreviews}`,
    generationsDir: `${root}/${PROJECT_SUBDIRS.generations}`,
    exportsDir: `${root}/${PROJECT_SUBDIRS.exports}`,
    prospectingDir: `${root}/${PROJECT_SUBDIRS.prospecting}`,
    smeltingDir: `${root}/${PROJECT_SUBDIRS.smelting}`,
    forgeDir: `${root}/${PROJECT_SUBDIRS.forge}`,
  };
}

export function createEmptyProject(projectId: string, name: string, createdAt: string): InterForgeProject {
  return {
    id: projectId,
    name,
    description: "",
    createdAt,
    updatedAt: createdAt,
    stage: "ideation",
    folder: `${PROJECTS_ROOT_DIRNAME}/${projectId}`,
    coverImage: null,
    tags: [],
    notes: [],
    links: [],
    references: [],
    prompts: [],
    anvilBoards: [],
    generations: [],
    exports: [],
    activity: [],
    prospecting: null,
    smelting: null,
    forge: null,
  };
}
