/**
 * HeaderBar — Top bar showing stage title, project pill, tray toggle, and window controls.
 *
 * Replaces the old Titlebar component. Window controls (min/max/close) live here now.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePipeline } from "../contexts/PipelineContext";
import { useAssetTray } from "../contexts/AssetTrayContext";
import { useProjects } from "../components/Projects/ProjectsContext";
import { STAGE_META } from "../types/pipeline";

interface HeaderBarProps {
  onSetup: () => void;
  onWalkthrough: () => void;
}

export default function HeaderBar({ onSetup, onWalkthrough }: HeaderBarProps) {
  const { activeView } = usePipeline();
  const { toggle } = useAssetTray();
  const { activeProject } = useProjects();

  const meta = STAGE_META[activeView];

  async function minimize() {
    await getCurrentWindow().minimize();
  }
  async function maximize() {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }
  async function close() {
    await getCurrentWindow().close();
  }

  return (
    <div className="header" data-tauri-drag-region>
      <span className="header__title">{meta.title}</span>
      <span className="header__subtitle">{meta.subtitle}</span>
      <div className="header__spacer" />

      {activeProject && (
        <span className="header__pill">{activeProject.name}</span>
      )}

      <button
        className="header__btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onWalkthrough}
      >
        Walkthrough
      </button>
      <button
        className="header__btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onSetup}
      >
        Setup
      </button>
      <button
        className="header__btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={toggle}
      >
        Asset Tray
      </button>

      <div style={{ width: 8 }} />

      <button
        className="win-btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={minimize}
        title="Minimize"
      >
        &#x2013;
      </button>
      <button
        className="win-btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={maximize}
        title="Maximize"
      >
        &#x25A1;
      </button>
      <button
        className="win-btn win-btn--close"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={close}
        title="Close"
      >
        &#x2715;
      </button>
    </div>
  );
}
