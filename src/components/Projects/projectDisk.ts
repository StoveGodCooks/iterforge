import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { InterForgeProject } from "../../types/projects";

const PROJECTS_DIR = "interforge-projects";

const PROJECT_SUBDIRS = [
  "references",
  "notes",
  "links",
  "prompts",
  "anvil/boards",
  "anvil/exports",
  "anvil/previews",
  "generations",
  "exports",
  "prospecting",
  "smelting",
  "forge",
];

export async function ensureProjectFolders(projectId: string): Promise<void> {
  const root = `${PROJECTS_DIR}/${projectId}`;
  await mkdir(root, { baseDir: BaseDirectory.AppData, recursive: true });
  await Promise.all(
    PROJECT_SUBDIRS.map((sub) =>
      mkdir(`${root}/${sub}`, { baseDir: BaseDirectory.AppData, recursive: true }),
    ),
  );
}

export async function saveProjectManifest(project: InterForgeProject): Promise<void> {
  try {
    const root = `${PROJECTS_DIR}/${project.id}`;
    await mkdir(root, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextFile(
      `${root}/project.json`,
      JSON.stringify(project, null, 2),
      { baseDir: BaseDirectory.AppData },
    );
  } catch (err) {
    console.warn("[InterForge] Failed to save project manifest:", err);
  }
}

export async function loadAllProjectsFromDisk(): Promise<InterForgeProject[]> {
  try {
    const rootExists = await exists(PROJECTS_DIR, { baseDir: BaseDirectory.AppData });
    if (!rootExists) return [];

    const entries = await readDir(PROJECTS_DIR, { baseDir: BaseDirectory.AppData });
    const results = await Promise.allSettled(
      entries
        .filter((e) => e.isDirectory && e.name)
        .map(async (e) => {
          const raw = await readTextFile(
            `${PROJECTS_DIR}/${e.name}/project.json`,
            { baseDir: BaseDirectory.AppData },
          );
          return JSON.parse(raw) as InterForgeProject;
        }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<InterForgeProject> => r.status === "fulfilled")
      .map((r) => r.value)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch (err) {
    console.warn("[InterForge] Failed to load projects from disk:", err);
    return [];
  }
}

export async function deleteProjectFromDisk(projectId: string): Promise<void> {
  try {
    const root = `${PROJECTS_DIR}/${projectId}`;
    const projectExists = await exists(root, { baseDir: BaseDirectory.AppData });
    if (projectExists) {
      await remove(root, { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch (err) {
    console.warn("[InterForge] Failed to delete project from disk:", err);
  }
}
