import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { InterForgeProject, ProjectImageSource } from "../../types/projects";
import { buildProjectDiskLayout } from "./projectStorage";
import { useProjectsState } from "./useProjectsState";
import "../../styles/projects.css";

type ProjectSection =
  | "overview"
  | "notes"
  | "references"
  | "links"
  | "anvil"
  | "generations"
  | "exports";

const PROJECT_SECTIONS: Array<{ id: ProjectSection; label: string; available: boolean }> = [
  { id: "overview", label: "Overview", available: true },
  { id: "notes", label: "Notes", available: true },
  { id: "references", label: "References", available: true },
  { id: "links", label: "Links", available: true },
  { id: "anvil", label: "Anvil Boards", available: false },
  { id: "generations", label: "Generations", available: false },
  { id: "exports", label: "Exports", available: false },
];

const REFERENCE_SOURCES: ProjectImageSource[] = ["imported", "web", "generated", "anvil", "export", "smelting"];

export default function ProjectsShell() {
  const {
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
  } = useProjectsState();

  const [activeSection, setActiveSection] = useState<ProjectSection>("overview");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectDescription, setEditProjectDescription] = useState("");

  useEffect(() => {
    if (!activeProject) {
      setEditProjectName("");
      setEditProjectDescription("");
      return;
    }

    setEditProjectName(activeProject.name);
    setEditProjectDescription(activeProject.description);
  }, [activeProject]);

  const availableSection = useMemo(
    () => PROJECT_SECTIONS.find(section => section.id === activeSection)?.available ?? false,
    [activeSection],
  );

  function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    createProject(trimmed, newProjectDescription);
    setNewProjectName("");
    setNewProjectDescription("");
    setActiveSection("overview");
  }

  function handleSaveMeta() {
    if (!activeProject) return;
    updateProjectMeta(activeProject.id, {
      name: editProjectName.trim() || activeProject.name,
      description: editProjectDescription.trim(),
    });
  }

  return (
    <div className="projects-shell">
      <aside className="projects-shell__sidebar panel panel--forge">
        <span className="projects-shell__sidebar-label">Project Workspace</span>
        <h2 className="projects-shell__sidebar-title">Creative Vault</h2>
        <p className="projects-shell__sidebar-body">
          Build out an asset’s memory here: notes, links, references, and eventually Anvil boards,
          generations, and exports all tied to one recoverable project.
        </p>

        <form className="projects-shell__create" onSubmit={handleCreateProject}>
          <input
            className="projects-shell__input"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="New project name"
          />
          <textarea
            className="projects-shell__textarea"
            value={newProjectDescription}
            onChange={(e) => setNewProjectDescription(e.target.value)}
            placeholder="Short description or direction"
            rows={3}
          />
          <button className="btn btn--primary projects-shell__create-btn" type="submit">
            Create Project
          </button>
        </form>

        <div className="projects-shell__project-list">
          <div className="projects-shell__list-header">
            <span className="projects-shell__label">Projects</span>
            <span className="projects-shell__count">{projects.length}</span>
          </div>

          {projects.length === 0 && (
            <div className="projects-shell__empty-list">
              No projects yet. Create one to start saving ideas, references, and notes.
            </div>
          )}

          {projects.map(project => (
            <button
              key={project.id}
              className={`projects-shell__project-btn ${project.id === activeProjectId ? "projects-shell__project-btn--active" : ""}`}
              onClick={() => setActiveProjectId(project.id)}
            >
              <span className="projects-shell__project-name">{project.name}</span>
              <span className="projects-shell__project-meta">{project.stage}</span>
            </button>
          ))}
        </div>

        {activeProject && (
          <nav className="projects-shell__nav" aria-label="Project sections">
            {PROJECT_SECTIONS.map(item => (
              <button
                key={item.id}
                className={`projects-shell__nav-btn ${item.id === activeSection ? "projects-shell__nav-btn--active" : ""}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span>{item.label}</span>
                {!item.available && <span className="projects-shell__soon">Soon</span>}
              </button>
            ))}
          </nav>
        )}
      </aside>

      <section className="projects-shell__content">
        {!activeProject ? (
          <div className="projects-shell__hero panel panel--forge">
            <span className="projects-shell__eyebrow">No Active Project</span>
            <h1 className="projects-shell__title">Create your first project to start saving ideas.</h1>
            <p className="projects-shell__body">
              Projects are where InterForge will keep your references, notes, links, boards, generations,
              and exports together. Start with a name and a short design brief on the left.
            </p>
          </div>
        ) : (
          <>
            <div className="projects-shell__hero panel panel--forge">
              <span className="projects-shell__eyebrow">Active Project</span>
              <h1 className="projects-shell__title">{activeProject.name}</h1>
              <p className="projects-shell__body">
                {activeProject.description || "This project does not have a description yet. Add one to define the art direction and intended output."}
              </p>
            </div>

            <div className="projects-shell__section-strip">
              {PROJECT_SECTIONS.map(item => (
                <button
                  key={item.id}
                  className={`projects-shell__section-pill ${item.id === activeSection ? "projects-shell__section-pill--active" : ""}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span>{item.label}</span>
                  {!item.available && <span className="projects-shell__soon">Soon</span>}
                </button>
              ))}
            </div>

            <div className="projects-shell__workspace">
              <section className="projects-shell__workspace-main">
                {activeSection === "overview" && (
                  <OverviewSection
                    project={activeProject}
                    projectName={editProjectName}
                    projectDescription={editProjectDescription}
                    onProjectNameChange={setEditProjectName}
                    onProjectDescriptionChange={setEditProjectDescription}
                    onSaveMeta={handleSaveMeta}
                    onDeleteProject={() => deleteProject(activeProject.id)}
                  />
                )}
                {activeSection === "notes" && (
                  <NotesSection
                    project={activeProject}
                    onAddNote={(title, body) => addNote(activeProject.id, { title, body })}
                    onDeleteNote={(noteId) => deleteNote(activeProject.id, noteId)}
                    onTogglePin={(noteId) => togglePinNote(activeProject.id, noteId)}
                  />
                )}
                {activeSection === "references" && (
                  <ReferencesSection
                    project={activeProject}
                    onAddReference={(title, path, note, source) => addReference(activeProject.id, { title, path, note, source })}
                    onDeleteReference={(referenceId) => deleteReference(activeProject.id, referenceId)}
                  />
                )}
                {activeSection === "links" && (
                  <LinksSection
                    project={activeProject}
                    onAddLink={(title, url, note) => addLink(activeProject.id, { title, url, note })}
                    onDeleteLink={(linkId) => deleteLink(activeProject.id, linkId)}
                  />
                )}
                {!availableSection && (
                  <ComingSoonSection section={activeSection} project={activeProject} />
                )}
              </section>

              <aside className="projects-shell__workspace-side panel panel--forge">
                <span className="projects-shell__label">Recent Activity</span>
                {activeProject.activity.length === 0 ? (
                  <p className="projects-shell__body">Activity will appear here as the project grows.</p>
                ) : (
                  <div className="projects-shell__activity">
                    {activeProject.activity.slice(0, 6).map(item => (
                      <div key={item.id} className="projects-shell__activity-item">
                        <span className="projects-shell__activity-label">{item.label}</span>
                        <span className="projects-shell__activity-date">{formatDate(item.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function OverviewSection({
  project,
  projectName,
  projectDescription,
  onProjectNameChange,
  onProjectDescriptionChange,
  onSaveMeta,
  onDeleteProject,
}: {
  project: InterForgeProject;
  projectName: string;
  projectDescription: string;
  onProjectNameChange: (value: string) => void;
  onProjectDescriptionChange: (value: string) => void;
  onSaveMeta: () => void;
  onDeleteProject: () => void;
}) {
  const diskLayout = buildProjectDiskLayout(project.id);

  return (
    <div className="projects-shell__section">
      <section className="projects-shell__card panel panel--forge">
        <span className="projects-shell__label">Quick Notes Preview</span>
        {project.notes.length === 0 ? (
          <p className="projects-shell__body">No notes yet. Open the Notes section above to start writing design direction, material ideas, or reminders.</p>
        ) : (
          <div className="projects-shell__stack">
            {project.notes.slice(0, 2).map(note => (
              <div key={note.id} className="projects-shell__preview-note">
                <strong className="projects-shell__path-label">{note.title}</strong>
                <p className="projects-shell__body">{note.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="projects-shell__card panel panel--forge">
        <span className="projects-shell__label">Project Details</span>
        <div className="projects-shell__form-grid">
          <input
            className="projects-shell__input"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder="Project name"
          />
          <textarea
            className="projects-shell__textarea"
            value={projectDescription}
            onChange={(e) => onProjectDescriptionChange(e.target.value)}
            placeholder="Describe the asset direction, mood, and purpose"
            rows={4}
          />
        </div>
        <div className="projects-shell__actions">
          <button className="btn btn--primary" onClick={onSaveMeta}>Save Details</button>
          <button className="btn btn--secondary" onClick={onDeleteProject}>Delete Project</button>
        </div>
      </section>

      <div className="projects-shell__stats-grid">
        <StatCard label="Notes" value={project.notes.length} />
        <StatCard label="Links" value={project.links.length} />
        <StatCard label="References" value={project.references.length} />
        <StatCard label="Boards" value={project.anvilBoards.length} />
      </div>

      <section className="projects-shell__card panel panel--forge">
        <span className="projects-shell__label">Project Folder Layout</span>
        <div className="projects-shell__paths">
          <PathRow label="Root" value={diskLayout.root} />
          <PathRow label="Manifest" value={diskLayout.manifest} />
          <PathRow label="Anvil Boards" value={diskLayout.anvilBoardsDir} />
          <PathRow label="References" value={diskLayout.referencesDir} />
          <PathRow label="Exports" value={diskLayout.exportsDir} />
        </div>
      </section>
    </div>
  );
}

function NotesSection({
  project,
  onAddNote,
  onDeleteNote,
  onTogglePin,
}: {
  project: InterForgeProject;
  onAddNote: (title: string, body: string) => void;
  onDeleteNote: (noteId: string) => void;
  onTogglePin: (noteId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && !title.trim()) return;
    onAddNote(title, body);
    setTitle("");
    setBody("");
  }

  return (
    <div className="projects-shell__section">
      <section className="projects-shell__card panel panel--forge">
        <span className="projects-shell__label">New Note</span>
        <form className="projects-shell__stack" onSubmit={submit}>
          <input className="projects-shell__input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" />
          <textarea className="projects-shell__textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Design brief, reminders, gameplay role, materials, lore fragments..." rows={5} />
          <button className="btn btn--primary projects-shell__align-start" type="submit">Save Note</button>
        </form>
      </section>

      <div className="projects-shell__stack">
        {project.notes.length === 0 && (
          <section className="projects-shell__card panel panel--forge">
            <p className="projects-shell__body">No notes yet. Use this section for art direction, gameplay intent, materials, and decision logs.</p>
          </section>
        )}
        {project.notes.map(note => (
          <section key={note.id} className="projects-shell__card panel panel--forge">
            <div className="projects-shell__row">
              <div>
                <span className="projects-shell__label">{note.pinned ? "Pinned Note" : "Note"}</span>
                <h3 className="projects-shell__card-title">{note.title}</h3>
              </div>
              <div className="projects-shell__mini-actions">
                <button className="projects-shell__mini-btn" onClick={() => onTogglePin(note.id)}>{note.pinned ? "Unpin" : "Pin"}</button>
                <button className="projects-shell__mini-btn" onClick={() => onDeleteNote(note.id)}>Delete</button>
              </div>
            </div>
            <p className="projects-shell__body">{note.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function LinksSection({
  project,
  onAddLink,
  onDeleteLink,
}: {
  project: InterForgeProject;
  onAddLink: (title: string, url: string, note: string) => void;
  onDeleteLink: (linkId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    onAddLink(title, url, note);
    setTitle("");
    setUrl("");
    setNote("");
  }

  return (
    <div className="projects-shell__section">
      <section className="projects-shell__card panel panel--forge">
        <span className="projects-shell__label">Save Link</span>
        <form className="projects-shell__stack" onSubmit={submit}>
          <input className="projects-shell__input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Link title" />
          <input className="projects-shell__input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/reference" />
          <textarea className="projects-shell__textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this link matters" rows={3} />
          <button className="btn btn--primary projects-shell__align-start" type="submit">Save Link</button>
        </form>
      </section>

      <div className="projects-shell__stack">
        {project.links.length === 0 && (
          <section className="projects-shell__card panel panel--forge">
            <p className="projects-shell__body">No saved links yet. Use this to keep tutorials, references, and research trails tied to the project.</p>
          </section>
        )}
        {project.links.map(link => (
          <section key={link.id} className="projects-shell__card panel panel--forge">
            <div className="projects-shell__row">
              <div>
                <span className="projects-shell__label">Saved Link</span>
                <h3 className="projects-shell__card-title">{link.title}</h3>
              </div>
              <button className="projects-shell__mini-btn" onClick={() => onDeleteLink(link.id)}>Delete</button>
            </div>
            <a className="projects-shell__external-link" href={link.url} target="_blank" rel="noreferrer">
              {link.url}
            </a>
            {link.note && <p className="projects-shell__body">{link.note}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

function ReferencesSection({
  project,
  onAddReference,
  onDeleteReference,
}: {
  project: InterForgeProject;
  onAddReference: (title: string, path: string, note: string, source: ProjectImageSource) => void;
  onDeleteReference: (referenceId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState<ProjectImageSource>("imported");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    onAddReference(title, path, note, source);
    setTitle("");
    setPath("");
    setNote("");
    setSource("imported");
  }

  return (
    <div className="projects-shell__section">
      <section className="projects-shell__card panel panel--forge">
        <span className="projects-shell__label">Add Reference</span>
        <form className="projects-shell__stack" onSubmit={submit}>
          <input className="projects-shell__input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reference title" />
          <input className="projects-shell__input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Image path or URL" />
          <select className="projects-shell__input" value={source} onChange={(e) => setSource(e.target.value as ProjectImageSource)}>
            {REFERENCE_SOURCES.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <textarea className="projects-shell__textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should this reference influence?" rows={3} />
          <button className="btn btn--primary projects-shell__align-start" type="submit">Save Reference</button>
        </form>
      </section>

      <div className="projects-shell__stack">
        {project.references.length === 0 && (
          <section className="projects-shell__card panel panel--forge">
            <p className="projects-shell__body">No references yet. Save image paths or URLs here now; disk import and previews will come in the persistence phase.</p>
          </section>
        )}
        {project.references.map(reference => (
          <section key={reference.id} className="projects-shell__card panel panel--forge">
            <div className="projects-shell__row">
              <div>
                <span className="projects-shell__label">{reference.source}</span>
                <h3 className="projects-shell__card-title">{reference.title}</h3>
              </div>
              <button className="projects-shell__mini-btn" onClick={() => onDeleteReference(reference.id)}>Delete</button>
            </div>
            <div className="projects-shell__path-chip">{reference.path}</div>
            {reference.note && <p className="projects-shell__body">{reference.note}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

function ComingSoonSection({
  section,
  project,
}: {
  section: ProjectSection;
  project: InterForgeProject;
}) {
  return (
    <section className="projects-shell__card panel panel--forge">
      <span className="projects-shell__label">Coming Soon</span>
      <h3 className="projects-shell__card-title">{PROJECT_SECTIONS.find(item => item.id === section)?.label}</h3>
      <p className="projects-shell__body">
        This workspace is reserved for the next phase. It will plug directly into the current
        project, which already has {project.notes.length} notes, {project.links.length} links,
        and {project.references.length} saved references.
      </p>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <section className="projects-shell__stat panel panel--forge">
      <span className="projects-shell__label">{label}</span>
      <strong className="projects-shell__stat-value">{value}</strong>
    </section>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="projects-shell__path-row">
      <span className="projects-shell__path-label">{label}</span>
      <code className="projects-shell__path-value">{value}</code>
    </div>
  );
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
