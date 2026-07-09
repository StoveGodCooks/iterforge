import { useEffect } from "react";
import { useProjects } from "./ProjectsContext";
import type { InterForgeProject } from "../../types/projects";
import "../../styles/bento.css";

interface ProjectBentoProps {
  open: boolean;
  onClose: () => void;
  onOpenProjects: () => void;
}

export default function ProjectBento({ open, onClose, onOpenProjects }: ProjectBentoProps) {
  const { activeProject } = useProjects();

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  function handleOpenProjects() {
    onOpenProjects();
    onClose();
  }

  return (
    <>
      <div
        className={`bento-backdrop ${open ? "bento-backdrop--visible" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`bento-panel ${open ? "bento-panel--open" : ""}`}
        role="dialog"
        aria-label="Active project overview"
        aria-modal="true"
      >
        {activeProject ? (
          <ActiveProjectView
            project={activeProject}
            onClose={onClose}
            onOpenProjects={handleOpenProjects}
          />
        ) : (
          <NoProjectView onClose={onClose} onOpenProjects={handleOpenProjects} />
        )}
      </div>
    </>
  );
}

function ActiveProjectView({
  project,
  onClose,
  onOpenProjects,
}: {
  project: InterForgeProject;
  onClose: () => void;
  onOpenProjects: () => void;
}) {
  const pinnedNotes = project.notes.filter((n) => n.pinned);
  const previewNotes = pinnedNotes.length > 0 ? pinnedNotes.slice(0, 2) : project.notes.slice(0, 2);
  const recentActivity = project.activity.slice(0, 4);

  return (
    <>
      <header className="bento-header">
        <div className="bento-header__meta">
          <span className="bento-stage-badge">{formatStage(project.stage)}</span>
          <span className="bento-hint">Shift+P</span>
        </div>
        <div className="bento-header__title-row">
          <h2 className="bento-title">{project.name}</h2>
          <button className="bento-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {project.description && (
          <p className="bento-desc">{project.description}</p>
        )}
      </header>

      <div className="bento-stats">
        <BentoStat label="Notes" value={project.notes.length} />
        <BentoStat label="Refs" value={project.references.length} />
        <BentoStat label="Links" value={project.links.length} />
        <BentoStat label="Boards" value={project.anvilBoards.length} />
      </div>

      <div className="bento-body">
        {previewNotes.length > 0 && (
          <section className="bento-section">
            <span className="bento-section-label">
              {pinnedNotes.length > 0 ? "Pinned" : "Recent Notes"}
            </span>
            <div className="bento-notes">
              {previewNotes.map((note) => (
                <div key={note.id} className="bento-note">
                  <strong className="bento-note-title">{note.title}</strong>
                  {note.body && <p className="bento-note-body">{note.body}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {recentActivity.length > 0 && (
          <section className="bento-section">
            <span className="bento-section-label">Activity</span>
            <div className="bento-activity">
              {recentActivity.map((item) => (
                <div key={item.id} className="bento-activity-row">
                  <span className="bento-activity-label">{item.label}</span>
                  <span className="bento-activity-date">{formatRelativeDate(item.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="bento-footer">
        <button className="bento-open-btn" onClick={onOpenProjects}>
          Open Full Project
        </button>
        <span className="bento-updated">Updated {formatRelativeDate(project.updatedAt)}</span>
      </footer>
    </>
  );
}

function NoProjectView({
  onClose,
  onOpenProjects,
}: {
  onClose: () => void;
  onOpenProjects: () => void;
}) {
  return (
    <>
      <header className="bento-header">
        <div className="bento-header__title-row">
          <h2 className="bento-title">No Active Project</h2>
          <button className="bento-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="bento-desc">
          Open or create a project to track notes, references, and generation history.
        </p>
      </header>
      <footer className="bento-footer">
        <button className="bento-open-btn" onClick={onOpenProjects}>
          Go to Projects
        </button>
      </footer>
    </>
  );
}

function BentoStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bento-stat">
      <strong className="bento-stat-value">{value}</strong>
      <span className="bento-stat-label">{label}</span>
    </div>
  );
}

function formatStage(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRelativeDate(value: string) {
  try {
    const diffMs = Date.now() - new Date(value).getTime();
    const diffHours = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
    if (diffHours < 1) return "just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return value;
  }
}
