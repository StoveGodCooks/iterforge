/**
 * HeaderBar — Top bar: logo, stage navigation, project pill, actions, window controls.
 *
 * The stage nav lives here now (the left rail was removed) so the flow reads
 * left→right across the top instead of jumping between a rail and the content.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePipeline } from "../contexts/PipelineContext";
import type { AppView } from "../contexts/PipelineContext";
import { useAssetTray } from "../contexts/AssetTrayContext";
import { useProjects } from "../components/Projects/ProjectsContext";
import logoUrl from "../assets/logo.png";

interface HeaderBarProps {
  onSetup: () => void;
  onWalkthrough: () => void;
}

const NAV: { id: AppView; label: string; icon: JSX.Element }[] = [
  {
    id: "prospect", label: "Prospect",
    icon: (<svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>),
  },
  {
    id: "smelt", label: "Pose",
    icon: (<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>),
  },
  {
    id: "forge", label: "Forge",
    icon: (<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96L12 12.01l8.73-5.05" /><path d="M12 22.08V12" /></svg>),
  },
  {
    id: "projects", label: "Projects",
    icon: (<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>),
  },
];

export default function HeaderBar({ onSetup, onWalkthrough }: HeaderBarProps) {
  const { activeView, navigateTo } = usePipeline();
  const { toggle } = useAssetTray();
  const { activeProject } = useProjects();

  async function minimize() { await getCurrentWindow().minimize(); }
  async function maximize() {
    const win = getCurrentWindow();
    if (await win.isMaximized()) { await win.unmaximize(); } else { await win.maximize(); }
  }
  async function close() { await getCurrentWindow().close(); }

  return (
    <div className="header" data-tauri-drag-region>
      <img className="header__logo" src={logoUrl} alt="InterForge" />

      <nav className="header__nav">
        {NAV.map((btn) => (
          <button
            key={btn.id}
            className={`header__navbtn${activeView === btn.id ? " active" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => navigateTo(btn.id)}
          >
            {btn.icon}
            <span>{btn.label}</span>
          </button>
        ))}
      </nav>

      <div className="header__spacer" />

      {activeProject && <span className="header__pill">{activeProject.name}</span>}

      <button className="header__btn" onMouseDown={(e) => e.stopPropagation()} onClick={onWalkthrough}>Walkthrough</button>
      <button className="header__btn" onMouseDown={(e) => e.stopPropagation()} onClick={onSetup}>Setup</button>
      <button className="header__btn" onMouseDown={(e) => e.stopPropagation()} onClick={toggle}>Asset Tray</button>

      <div style={{ width: 8 }} />

      <button className="win-btn" onMouseDown={(e) => e.stopPropagation()} onClick={minimize} title="Minimize">&#x2013;</button>
      <button className="win-btn" onMouseDown={(e) => e.stopPropagation()} onClick={maximize} title="Maximize">&#x25A1;</button>
      <button className="win-btn win-btn--close" onMouseDown={(e) => e.stopPropagation()} onClick={close} title="Close">&#x2715;</button>
    </div>
  );
}
