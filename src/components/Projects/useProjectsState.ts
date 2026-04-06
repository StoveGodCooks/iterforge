import { useEffect, useMemo, useState } from "react";
import { createEmptyProject, slugifyProjectName } from "./projectStorage";
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
  if (typeof window === "undefined") {
    return { projects: [] };
  }

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

function createActivity(kind: ProjectActivity["kind"], label: string, relatedId: string | null = null): ProjectActivity {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    createdAt: new Date().toISOString(),
    relatedId,
  };
}

function appendActivity(project: InterForgeProject, activity: ProjectActivity): InterForgeProject {
  return {
    ...project,
    updatedAt: activity.createdAt,
    activity: [activity, ...project.activity].slice(0, 50),
  };
}

export function useProjectsState() {
  const [projects, setProjects] = useState<InterForgeProject[]>(() => safeReadProjectsState().projects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => safeReadActiveProjectId());

  useEffect(() => {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify({ projects }));
  }, [projects]);

  useEffect(() => {
    if (activeProjectId) {
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
    } else {
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (projects.length === 0) {
      setActiveProjectId(null);
      return;
    }

    if (!activeProjectId || !projects.some(project => project.id === activeProjectId)) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId]);

  const activeProject = useMemo(
    () => projects.find(project => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  function createProject(name: string, description: string) {
    const timestamp = new Date().toISOString();
    const projectId = `${slugifyProjectName(name)}-${Date.now().toString(36)}`;
    const project = createEmptyProject(projectId, name.trim(), timestamp);
    project.description = description.trim();
    project.activity = [createActivity("project_created", "Project created")];

    setProjects(prev => [project, ...prev]);
    setActiveProjectId(project.id);
  }

  function deleteProject(projectId: string) {
    setProjects(prev => prev.filter(project => project.id !== projectId));
  }

  function updateProject(projectId: string, updater: (project: InterForgeProject) => InterForgeProject) {
    setProjects(prev => prev.map(project => (
      project.id === projectId ? updater(project) : project
    )));
  }

  function updateProjectMeta(projectId: string, fields: Pick<InterForgeProject, "name" | "description">) {
    updateProject(projectId, project => ({
      ...project,
      name: fields.name,
      description: fields.description,
      updatedAt: new Date().toISOString(),
    }));
  }

  function addNote(projectId: string, input: Pick<ProjectNote, "title" | "body">) {
    updateProject(projectId, project => appendActivity({
      ...project,
      notes: [
        {
          id: crypto.randomUUID(),
          title: input.title.trim() || "Untitled Note",
          body: input.body.trim(),
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        ...project.notes,
      ],
    }, createActivity("note_saved", "Note saved")));
  }

  function deleteNote(projectId: string, noteId: string) {
    updateProject(projectId, project => ({
      ...project,
      updatedAt: new Date().toISOString(),
      notes: project.notes.filter(note => note.id !== noteId),
    }));
  }

  function togglePinNote(projectId: string, noteId: string) {
    updateProject(projectId, project => ({
      ...project,
      updatedAt: new Date().toISOString(),
      notes: project.notes.map(note => note.id === noteId
        ? { ...note, pinned: !note.pinned, updatedAt: new Date().toISOString() }
        : note),
    }));
  }

  function addLink(projectId: string, input: Pick<ProjectLink, "title" | "url" | "note">) {
    updateProject(projectId, project => appendActivity({
      ...project,
      links: [
        {
          id: crypto.randomUUID(),
          title: input.title.trim() || "Untitled Link",
          url: input.url.trim(),
          note: input.note.trim(),
          pinned: false,
          createdAt: new Date().toISOString(),
        },
        ...project.links,
      ],
    }, createActivity("link_saved", "Link saved")));
  }

  function deleteLink(projectId: string, linkId: string) {
    updateProject(projectId, project => ({
      ...project,
      updatedAt: new Date().toISOString(),
      links: project.links.filter(link => link.id !== linkId),
    }));
  }

  function addReference(projectId: string, input: Pick<ProjectImageRef, "title" | "path" | "note" | "source">) {
    updateProject(projectId, project => appendActivity({
      ...project,
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
        ...project.references,
      ],
    }, createActivity("reference_added", "Reference added")));
  }

  function deleteReference(projectId: string, referenceId: string) {
    updateProject(projectId, project => ({
      ...project,
      updatedAt: new Date().toISOString(),
      references: project.references.filter(reference => reference.id !== referenceId),
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
