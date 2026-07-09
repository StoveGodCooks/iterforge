/**
 * StageRail — Vertical navigation rail on the left side.
 *
 * Shows the IF logo, 6 pipeline stage buttons, and Projects at the bottom.
 * SVG icons match the mockup exactly.
 */
import { usePipeline } from "../contexts/PipelineContext";
import type { AppView } from "../contexts/PipelineContext";
import logoUrl from "../assets/logo.png";

interface RailButton {
  id: AppView;
  label: string;
  icon: JSX.Element;
  bottom?: boolean;
}

const BUTTONS: RailButton[] = [
  {
    id: "prospect",
    label: "PROSPECT",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: "smelt",
    label: "SMELT",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    id: "forge",
    label: "FORGE",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.27 6.96L12 12.01l8.73-5.05" />
        <path d="M12 22.08V12" />
      </svg>
    ),
  },
  {
    id: "projects",
    label: "PROJECTS",
    bottom: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export default function StageRail() {
  const { activeView, navigateTo, devToolsEnabled } = usePipeline();

  const mainButtons = BUTTONS.filter((b) => !b.bottom);
  const bottomButtons = BUTTONS.filter((b) => b.bottom);

  return (
    <nav className="rail">
      <div className="rail__logo">
        <img src={logoUrl} alt="InterForge" />
      </div>

      {mainButtons.map((btn) => (
        <button
          key={btn.id}
          className={`rail__btn${activeView === btn.id ? " active" : ""}`}
          onClick={() => navigateTo(btn.id)}
          title={btn.label}
        >
          {btn.icon}
          {btn.label}
        </button>
      ))}

      <div className="rail__spacer" />

      {bottomButtons.map((btn) => (
        <button
          key={btn.id}
          className={`rail__btn rail__btn--bottom${activeView === btn.id ? " active" : ""}`}
          onClick={() => navigateTo(btn.id)}
          title={btn.label}
        >
          {btn.icon}
          {btn.label}
        </button>
      ))}

      {devToolsEnabled && (
        <button
          className={`rail__btn rail__btn--bottom${activeView === "devtools" ? " active" : ""}`}
          onClick={() => navigateTo("devtools")}
          title="Dev Tools"
        >
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          DEV
        </button>
      )}
    </nav>
  );
}
