import { useEffect, useMemo, useRef, useState } from "react";
import { createEmptyProject, slugifyProjectName } from "./projectStorage";
import {
  deleteProjectFromDisk,
  ensureProjectFolders,
  loadAllProjectsFromDisk,
  saveProjectManifest,
} from "./projectDisk";
import type {
  InterForgeProject,
  ProjectActivity,
  ProjectImageRef,
  ProjectLink,
  ProjectNote,
} from "../../types/projects";

const PROJECTS_STORAGE_KEY = "interforge.projects.v1";
const ACTIVE_PROJECT_STORAGE_KEY = "interforge.projects.activeProjectId";

interface PersistedProjectsState {
  projects: InterForgeProject[];
}

function safeReadProjectsState(): PersistedProjectsState {
  if (typeof window === "undefined") return { projects: [] };
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return { projects: [] };
    const parsed = JSON.parse(raw) as PersistedProjectsState;
    return { projects: parsed.projects ?? [] };
  } catch {
    return { projects: [] };
  }
}

function safeReadActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
}

function createActivity(
  kind: ProjectActivity["kind"],
  label: string,
  relatedId: string | null = null,
): ProjectActivity {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    createdAt: new Date().toISOString(),
    relatedId,
  };
}

function appendActivity(
  project: InterForgeProject,
  activity: ProjectActivity,
): InterForgeProject {
  return {
    ...project,
    updatedAt: activity.createdAt,
    activity: [activity, ...project.activity].slice(0, 50),
  };
}

export function useProjectsState() {
  const [projects, setProjects] = useState<InterForgeProject[]>(
    () => safeReadProjectsState().projects,
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => safeReadActiveProjectId(),
  );

  // Tracks whether the async disk hydration has completed.
  // Using a ref avoids triggering extra re-renders; the write effect
  // checks this before flushing to disk.
  const diskHydratedRef = useRef(false);

  // ── Disk hydration on mount ───────────────────────────────────
  useEffect(() => {
    loadAllProjectsFromDisk().then((diskProjects) => {
      if (diskProjects.length > 0) {
        setProjects(diskProjects);
        window.localStorage.setItem(
          PROJECTS_STORAGE_KEY,
          JSON.stringify({ projects: diskProjects }),
        );
      }
      diskHydratedRef.current = true;
    });
  }, []);

  // ── Mirror to localStorage ────────────────────────────────────
  useEffect(() => {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify({ projects }));
  }, [projects]);

  // ── Mirror to disk (after hydration) ─────────────────────────
  useEffect(() => {
    if (!diskHydratedRef.current) return;
    for (const project of projects) {
      saveProjectManifest(project);
    }
  }, [projects]);

  // ── Persist active project id ─────────────────────────────────
  useEffect(() => {
    if (activeProjectId) {
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
    } else {
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    }
  }, [activeProjectId]);

  // ── Auto-select first project when list changes ───────────────
  useEffect(() => {
    if (projects.length === 0) {
      setActiveProjectId(null);
      return;
    }
    if (!activeProjectId || !projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  // ── CRUD ──────────────────────────────────────────────────────

  function createProject(name: string, description: string) {
    const timestamp = new Date().toISOString();
    const projectId = `${slugifyProjectName(name)}-${Date.now().toString(36)}`;
    const project = createEmptyProject(projectId, name.trim(), timestamp);
    project.description = description.trim();
    project.activity = [createActivity("project_created", "Project created")];

    setProjects((prev) => [project, ...prev]);
    setActiveProjectId(project.id);

    // Fire-and-forget: create folder structure then write manifest
    ensureProjectFolders(project.id).then(() => saveProjectManifest(project));
  }

  function deleteProject(projectId: string) {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    deleteProjectFromDisk(projectId);
  }

  function updateProject(
    projectId: string,
    updater: (project: InterForgeProject) => InterForgeProject,
  ) {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? updater(p) : p)),
    );
  }

  function updateProjectMeta(
    projectId: string,
    fields: Pick<InterForgeProject, "name" | "description">,
  ) {
    updateProject(projectId, (p) => ({
      ...p,
      name: fields.name,
      description: fields.description,
      updatedAt: new Date().toISOString(),
    }));
  }

  function addNote(projectId: string, input: Pick<ProjectNote, "title" | "body">) {
    updateProject(projectId, (p) =>
      appendActivity(
        {
          ...p,
          notes: [
            {
              id: crypto.randomUUID(),
              title: input.title.trim() || "Untitled Note",
              body: input.body.trim(),
              pinned: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            ...p.notes,
          ],
        },
        createActivity("note_saved", "Note saved"),
      ),
    );
  }

  function deleteNote(projectId: string, noteId: string) {
    updateProject(projectId, (p) => ({
      ...p,
      updatedAt: new Date().toISOString(),
      notes: p.notes.filter((n) => n.id !== noteId),
    }));
  }

  function togglePinNote(projectId: string, noteId: string) {
    updateProject(projectId, (p) => ({
      ...p,
      updatedAt: new Date().toISOString(),
      notes: p.notes.map((n) =>
        n.id === noteId
          ? { ...n, pinned: !n.pinned, updatedAt: new Date().toISOString() }
          : n,
      ),
    }));
  }

  function addLink(projectId: string, input: Pick<ProjectLink, "title" | "url" | "note">) {
    updateProject(projectId, (p) =>
      appendActivity(
        {
          ...p,
          links: [
            {
              id: crypto.randomUUID(),
              title: input.title.trim() || "Untitled Link",
              url: input.url.trim(),
              note: input.note.trim(),
              pinned: false,
              createdAt: new Date().toISOString(),
            },
            ...p.links,
          ],
        },
        createActivity("link_saved", "Link saved"),
      ),
    );
  }

  function deleteLink(projectId: string, linkId: string) {
    updateProject(projectId, (p) => ({
      ...p,
      updatedAt: new Date().toISOString(),
      links: p.links.filter((l) => l.id !== linkId),
    }));
  }

  function addReference(
    projectId: string,
    input: Pick<ProjectImageRef, "title" | "path" | "note" | "source">,
  ) {
    updateProject(projectId, (p) =>
      appendActivity(
        {
          ...p,
          references: [
            {
              id: crypto.randomUUID(),
              title: input.title.trim() || "Untitled Reference",
              path: input.path.trim(),
              previewPath: null,
              source: input.source,
              createdAt: new Date().toISOString(),
              tags: [],
              note: input.note.trim(),
            },
            ...p.references,
          ],
        },
        createActivity("reference_added", "Reference added"),
      ),
    );
  }

  function deleteReference(projectId: string, referenceId: string) {
    updateProject(projectId, (p) => ({
      ...p,
      updatedAt: new Date().toISOString(),
      references: p.references.filter((r) => r.id !== referenceId),
    }));
  }

  return {
    projects,
    activeProject,
    activeProjectId,
    setActiveProjectId,
    createProject,
    deleteProject,
    updateProjectMeta,
    addNote,
    deleteNote,
    togglePinNote,
    addLink,
    deleteLink,
    addReference,
    deleteReference,
  };
}
