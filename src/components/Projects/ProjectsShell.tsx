import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { InterForgeProject, ProjectImageSource, ProjectNote } from "../../types/projects";
import { useProjects } from "./ProjectsContext";
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
  { id: "overview",     label: "Overview",      available: true  },
  { id: "notes",        label: "Notes",         available: true  },
  { id: "references",   label: "References",    available: true  },
  { id: "links",        label: "Links",         available: true  },
  { id: "anvil",        label: "Anvil Boards",  available: false },
  { id: "generations",  label: "Generations",   available: false },
  { id: "exports",      label: "Exports",       available: false },
];

const REFERENCE_SOURCES: ProjectImageSource[] = [
  "imported", "web", "generated", "anvil", "export", "smelting",
];

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
  } = useProjects();

  const [activeSection, setActiveSection] = useState<ProjectSection>("overview");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectDescription, setEditProjectDescription] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(projects.length === 0);

  useEffect(() => {
    if (!activeProject) {
      setEditProjectName("");
      setEditProjectDescription("");
      return;
    }
    setEditProjectName(activeProject.name);
    setEditProjectDescription(activeProject.description);
  }, [activeProject]);

  useEffect(() => {
    if (projects.length === 0) setShowCreateForm(true);
  }, [projects.length]);

  const availableSection = useMemo(
    () => PROJECT_SECTIONS.find((s) => s.id === activeSection)?.available ?? false,
    [activeSection],
  );

  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.stage.toLowerCase().includes(query),
    );
  }, [projects, projectQuery]);

  function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    createProject(trimmed, newProjectDescription);
    setNewProjectName("");
    setNewProjectDescription("");
    setShowCreateForm(false);
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
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="projects-shell__panel">
        <div className="projects-shell__panel-scroll">
          <div className="projects-shell__panel-head">
            <h2 className="projects-shell__panel-title">Creative Vault</h2>
            <button
              className="projects-shell__panel-toggle"
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
            >
              {showCreateForm ? "Hide" : "New"}
            </button>
          </div>

          <input
            className="projects-shell__input"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
            placeholder="Find a project"
          />

          {showCreateForm && (
            <form className="projects-shell__create-form" onSubmit={handleCreateProject}>
              <input
                className="projects-shell__input"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                autoFocus
              />
              <textarea
                className="projects-shell__textarea"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="Art direction, role, mood, constraints"
                rows={3}
              />
              <button className="btn btn--primary projects-shell__panel-btn" type="submit">
                Create Project
              </button>
            </form>
          )}

          <div className="projects-shell__library">
            <div className="projects-shell__library-head">
              <span className="projects-shell__label">Library</span>
              <span className="projects-shell__library-count">{filteredProjects.length}</span>
            </div>

            {filteredProjects.length === 0 && (
              <div className="projects-shell__empty-list">
                {projects.length === 0
                  ? "No projects yet. Create one above."
                  : "No projects match that search."}
              </div>
            )}

            {filteredProjects.map((project) => (
              <button
                key={project.id}
                className={`projects-shell__project-btn ${
                  project.id === activeProjectId ? "projects-shell__project-btn--active" : ""
                }`}
                onClick={() => setActiveProjectId(project.id)}
              >
                <div className="projects-shell__project-top">
                  <strong className="projects-shell__project-name">{project.name}</strong>
                  <span className="projects-shell__project-stage">
                    {formatStage(project.stage)}
                  </span>
                </div>
                <p className="projects-shell__project-desc">
                  {project.description || "No direction written yet."}
                </p>
                <div className="projects-shell__project-stats">
                  <span>{project.notes.length} notes</span>
                  <span>{project.references.length} refs</span>
                  <span>{formatRelativeDate(project.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="projects-shell__panel-footer">
          <div className="projects-shell__footer-metric">
            <span className="projects-shell__footer-label">{projects.length} total</span>
            <strong>{activeProject ? activeProject.name : "No active project"}</strong>
          </div>
        </div>
      </aside>

      {/* ── Main stage ──────────────────────────────────────── */}
      <section className="projects-shell__stage">
        {!activeProject ? (
          <div className="projects-shell__empty-stage">
            <div className="projects-shell__empty-stage-inner">
              <span className="projects-shell__eyebrow">No Active Project</span>
              <h1 className="projects-shell__title">
                Open or create a project to enter the workspace.
              </h1>
              <p className="projects-shell__body">
                The right side becomes the live board for notes, references, activity, and
                generation history.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="projects-shell__stage-header">
              <div className="projects-shell__stage-copy">
                <h1 className="projects-shell__title">{activeProject.name}</h1>
                <p className="projects-shell__body">
                  {activeProject.description ||
                    "Add direction to define the visual target, gameplay role, and intended output."}
                </p>
              </div>
              <div className="projects-shell__stage-meta">
                <StageMeta label="Stage" value={formatStage(activeProject.stage)} />
                <StageMeta label="Updated" value={formatDate(activeProject.updatedAt)} />
              </div>
            </header>

            <nav className="projects-shell__section-bar" aria-label="Project sections">
              {PROJECT_SECTIONS.map((item) => (
                <button
                  key={item.id}
                  className={`projects-shell__section-tab ${
                    item.id === activeSection ? "projects-shell__section-tab--active" : ""
                  }`}
                  onClick={() => setActiveSection(item.id)}
                >
                  {item.label}
                  {!item.available && (
                    <span className="projects-shell__soon">Soon</span>
                  )}
                </button>
              ))}
            </nav>

            <div className="projects-shell__stage-body">
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
                  onAddReference={(title, path, note, source) =>
                    addReference(activeProject.id, { title, path, note, source })
                  }
                  onDeleteReference={(referenceId) =>
                    deleteReference(activeProject.id, referenceId)
                  }
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
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────── */

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
  const recentActivity = project.activity.slice(0, 8);

  return (
    <div className="projects-shell__overview">
      <section className="projects-shell__overview-column projects-shell__overview-column--primary">
        <div className="projects-shell__surface projects-shell__surface--hero">
          <div className="projects-shell__overview-metrics">
            <MetricTile label="Notes"   value={project.notes.length}       />
            <MetricTile label="Refs"    value={project.references.length}  />
            <MetricTile label="Links"   value={project.links.length}       />
            <MetricTile label="Boards"  value={project.anvilBoards.length} />
          </div>
        </div>

        <div className="projects-shell__surface">
          <h3 className="projects-shell__card-title">Project Details</h3>
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
          <div className="projects-shell__actions">
            <button className="btn btn--primary" onClick={onSaveMeta}>
              Save Details
            </button>
            <button className="btn btn--ghost projects-shell__delete-btn" onClick={onDeleteProject}>
              Delete Project
            </button>
          </div>
        </div>
      </section>

      <section className="projects-shell__overview-column">
        <div className="projects-shell__surface">
          <h3 className="projects-shell__card-title">Recent Activity</h3>
          {recentActivity.length === 0 ? (
            <p className="projects-shell__body">
              Activity will appear here as the project grows.
            </p>
          ) : (
            <div className="projects-shell__item-list">
              {recentActivity.map((item) => (
                <div key={item.id} className="projects-shell__item-row">
                  <span className="projects-shell__item-label">{item.label}</span>
                  <span className="projects-shell__item-date">
                    {formatDate(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ── Notes ───────────────────────────────────────────────────── */

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
    <div className="projects-shell__section-layout">
      <aside className="projects-shell__composer">
        <div className="projects-shell__surface">
          <h3 className="projects-shell__card-title">Capture Direction</h3>
          <form className="projects-shell__stack" onSubmit={submit}>
            <input
              className="projects-shell__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title"
            />
            <textarea
              className="projects-shell__textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Design brief, reminders, gameplay role, materials..."
              rows={7}
            />
            <button className="btn btn--primary projects-shell__align-start" type="submit">
              Save Note
            </button>
          </form>
        </div>
      </aside>

      <div className="projects-shell__list-stage">
        {project.notes.length === 0 ? (
          <div className="projects-shell__surface">
            <p className="projects-shell__body">
              No notes yet. Use this section for art direction, gameplay intent, and decision logs.
            </p>
          </div>
        ) : (
          <div className="projects-shell__surface">
            {project.notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onTogglePin={() => onTogglePin(note.id)}
                onDelete={() => onDeleteNote(note.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteRow({
  note,
  onTogglePin,
  onDelete,
}: {
  note: ProjectNote;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="projects-shell__item-row projects-shell__item-row--block">
      <div className="projects-shell__item-head">
        <div className="projects-shell__item-title-group">
          <strong className="projects-shell__item-title">{note.title}</strong>
          {note.pinned && <span className="projects-shell__badge">Pinned</span>}
        </div>
        <div className="projects-shell__mini-actions">
          <button className="projects-shell__mini-btn" onClick={onTogglePin}>
            {note.pinned ? "Unpin" : "Pin"}
          </button>
          <button className="projects-shell__mini-btn" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {note.body && <p className="projects-shell__body">{note.body}</p>}
    </div>
  );
}

/* ── Links ───────────────────────────────────────────────────── */

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
    <div className="projects-shell__section-layout">
      <aside className="projects-shell__composer">
        <div className="projects-shell__surface">
          <h3 className="projects-shell__card-title">Research Trail</h3>
          <form className="projects-shell__stack" onSubmit={submit}>
            <input
              className="projects-shell__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Link title"
            />
            <input
              className="projects-shell__input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
            <textarea
              className="projects-shell__textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this link matters"
              rows={4}
            />
            <button className="btn btn--primary projects-shell__align-start" type="submit">
              Save Link
            </button>
          </form>
        </div>
      </aside>

      <div className="projects-shell__list-stage">
        {project.links.length === 0 ? (
          <div className="projects-shell__surface">
            <p className="projects-shell__body">
              No saved links yet. Keep tutorials, references, and research trails here.
            </p>
          </div>
        ) : (
          <div className="projects-shell__surface">
            {project.links.map((link) => (
              <div key={link.id} className="projects-shell__item-row projects-shell__item-row--block">
                <div className="projects-shell__item-head">
                  <strong className="projects-shell__item-title">{link.title}</strong>
                  <button
                    className="projects-shell__mini-btn"
                    onClick={() => onDeleteLink(link.id)}
                  >
                    Delete
                  </button>
                </div>
                <a
                  className="projects-shell__external-link"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.url}
                </a>
                {link.note && <p className="projects-shell__body">{link.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── References ──────────────────────────────────────────────── */

function ReferencesSection({
  project,
  onAddReference,
  onDeleteReference,
}: {
  project: InterForgeProject;
  onAddReference: (
    title: string,
    path: string,
    note: string,
    source: ProjectImageSource,
  ) => void;
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
    <div className="projects-shell__section-layout">
      <aside className="projects-shell__composer">
        <div className="projects-shell__surface">
          <h3 className="projects-shell__card-title">Visual Inputs</h3>
          <form className="projects-shell__stack" onSubmit={submit}>
            <input
              className="projects-shell__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reference title"
            />
            <input
              className="projects-shell__input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Image path or URL"
            />
            <select
              className="projects-shell__input"
              value={source}
              onChange={(e) => setSource(e.target.value as ProjectImageSource)}
            >
              {REFERENCE_SOURCES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <textarea
              className="projects-shell__textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should this reference influence?"
              rows={4}
            />
            <button className="btn btn--primary projects-shell__align-start" type="submit">
              Save Reference
            </button>
          </form>
        </div>
      </aside>

      <div className="projects-shell__reference-stage">
        {project.references.length === 0 && (
          <div className="projects-shell__surface">
            <p className="projects-shell__body">
              No references yet. Save image paths or URLs here; previews can be layered in later.
            </p>
          </div>
        )}
        {project.references.map((reference) => (
          <div key={reference.id} className="projects-shell__ref-card">
            <div className="projects-shell__ref-card-head">
              <div>
                <span className="projects-shell__badge projects-shell__badge--source">
                  {reference.source}
                </span>
                <strong className="projects-shell__item-title">{reference.title}</strong>
              </div>
              <button
                className="projects-shell__mini-btn"
                onClick={() => onDeleteReference(reference.id)}
              >
                Delete
              </button>
            </div>
            <div className="projects-shell__path-chip">{reference.path}</div>
            {reference.note && (
              <p className="projects-shell__body">{reference.note}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Coming soon ─────────────────────────────────────────────── */

function ComingSoonSection({
  section,
  project,
}: {
  section: ProjectSection;
  project: InterForgeProject;
}) {
  return (
    <div className="projects-shell__surface projects-shell__coming-soon">
      <span className="projects-shell__label">Coming Soon</span>
      <h3 className="projects-shell__card-title">
        {PROJECT_SECTIONS.find((s) => s.id === section)?.label}
      </h3>
      <p className="projects-shell__body">
        This workspace is reserved for the next phase. It will plug directly into this project,
        which already has {project.notes.length} notes, {project.links.length} links, and{" "}
        {project.references.length} saved references.
      </p>
    </div>
  );
}

/* ── Small components ────────────────────────────────────────── */

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="projects-shell__metric-tile">
      <span className="projects-shell__metric-label">{label}</span>
      <strong className="projects-shell__metric-value">{value}</strong>
    </div>
  );
}

function StageMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="projects-shell__meta-chip">
      <span className="projects-shell__meta-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────── */

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatRelativeDate(value: string) {
  try {
    const diffMs = Date.now() - new Date(value).getTime();
    const diffHours = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
    if (diffHours < 1) return "Updated now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return value;
  }
}

function formatStage(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
