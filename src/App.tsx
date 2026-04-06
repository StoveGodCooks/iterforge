import { Component, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/app.css";
import "./styles/setup.css";
import Prospecting from "./tabs/Prospecting/Prospecting";
import Smelting from "./tabs/Smelting/Smelting";
import Forge from "./tabs/Forge/Forge";
import DevTools from "./tabs/DevTools/DevTools";
import OnboardingShell from "./components/Onboarding/OnboardingShell";
import ProjectsShell from "./components/Projects/ProjectsShell";
import SetupWizard from "./components/SetupWizard/SetupWizard";
import type { Stage, ProspectingOutput, SmeltingOutput } from "./types/pipeline";

/* ── Error Boundary ────────────────────────────────────────── */
interface EBProps { children: ReactNode }
interface EBState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[InterForge] Uncaught error:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100vh", gap: 16,
          background: "var(--bg-base, #0d1117)", color: "var(--text-primary, #e6dcc8)",
          fontFamily: "system-ui, sans-serif", padding: 32, textAlign: "center",
        }}>
          <span style={{ fontSize: 48 }}>&#x26A0;</span>
          <h2 style={{ margin: 0, fontSize: 20 }}>Something went wrong</h2>
          <p style={{ maxWidth: 500, opacity: 0.7, fontSize: 14, lineHeight: 1.6 }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); }}
            style={{
              padding: "8px 24px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)", color: "inherit", cursor: "pointer", fontSize: 14,
            }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type AppTab = Stage | "projects" | "devtools";
type OnboardingFinishMode = "guided" | "tinker" | "projects";

const ONBOARDING_SEEN_KEY = "interforge.onboarding.seen";

interface StageState<T = unknown> {
  locked: boolean;
  data: T | null;
}

export default function App() {
  const [activeTab,  setActiveTab]  = useState<AppTab>("prospecting");
  const [tinkerMode, setTinkerMode] = useState(false);
  const [showSetup,  setShowSetup]  = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);

  const [stages, setStages] = useState<{
    prospecting: StageState<ProspectingOutput>;
    smelting:    StageState<SmeltingOutput>;
    forge:       StageState<unknown>;
  }>({
    prospecting: { locked: false, data: null },
    smelting:    { locked: false, data: null },
    forge:       { locked: false, data: null },
  });

  function lockStage<T>(stage: Stage, data: T) {
    setStages(prev => ({ ...prev, [stage]: { locked: true, data } }));
    if (stage === "prospecting") setActiveTab("smelting");
    if (stage === "smelting")    setActiveTab("forge");
  }

  useEffect(() => {
    const seen = window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
    setShowOnboarding(!seen);
    setOnboardingReady(true);
  }, []);

  function markOnboardingSeen() {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
  }

  function closeOnboarding() {
    markOnboardingSeen();
    setShowOnboarding(false);
  }

  function finishOnboarding(mode: OnboardingFinishMode) {
    markOnboardingSeen();
    setShowOnboarding(false);

    if (mode === "guided") {
      setTinkerMode(false);
      setActiveTab("prospecting");
      return;
    }

    if (mode === "tinker") {
      setTinkerMode(true);
      setActiveTab("forge");
      return;
    }

    setActiveTab("projects");
  }

  // Tinker Mode bypasses all gates — all tabs accessible
  const smeltingUnlocked = stages.prospecting.locked || tinkerMode;
  const forgeUnlocked    = stages.smelting.locked    || tinkerMode;

  return (
    <div className="app">
      <Titlebar
        tinkerMode={tinkerMode}
        onToggleTinker={() => setTinkerMode(p => !p)}
        onSetup={() => setShowSetup(true)}
        onWalkthrough={() => setShowOnboarding(true)}
      />

      <nav className="tab-bar" role="tablist">
        <TabButton id="prospecting" label="Prospecting"
          active={activeTab === "prospecting"} locked={stages.prospecting.locked}
          disabled={false} tinker={false}
          onClick={() => setActiveTab("prospecting")} />
        <TabButton id="projects" label="Projects"
          active={activeTab === "projects"} locked={false}
          disabled={false} tinker={false}
          onClick={() => setActiveTab("projects")} />
        <TabButton id="smelting" label="Smelting"
          active={activeTab === "smelting"} locked={stages.smelting.locked}
          disabled={!smeltingUnlocked} tinker={tinkerMode && !stages.smelting.locked}
          onClick={() => smeltingUnlocked && setActiveTab("smelting")} />
        <TabButton id="forge" label="Forge"
          active={activeTab === "forge"} locked={stages.forge.locked}
          disabled={!forgeUnlocked} tinker={tinkerMode && !stages.forge.locked}
          onClick={() => forgeUnlocked && setActiveTab("forge")} />
        {tinkerMode && (
          <TabButton id="devtools" label="Dev"
            active={activeTab === "devtools"} locked={false}
            disabled={false} tinker={false}
            onClick={() => setActiveTab("devtools")} />
        )}
      </nav>

      {/* Tinker Mode banner */}
      {tinkerMode && (
        <div className="tinker-banner">
          ⚙ TINKER MODE — Gates bypassed. Jump to any stage freely.
        </div>
      )}

      <main className="content">
        <ErrorBoundary>
          {activeTab === "prospecting" && (
            <div className="tab-panel" role="tabpanel">
              <Prospecting
                tinkerMode={tinkerMode}
                onLock={(data) => lockStage("prospecting", data)}
                onJumpTo={(stage) => setActiveTab(stage as Stage)}
              />
            </div>
          )}
          {activeTab === "smelting" && smeltingUnlocked && (
            <div className="tab-panel" role="tabpanel">
              <Smelting
                prospectingData={stages.prospecting.data}
                onLock={(data) => lockStage<SmeltingOutput>("smelting", data)}
              />
            </div>
          )}
          {activeTab === "forge" && forgeUnlocked && (
            <div className="tab-panel" role="tabpanel">
              <Forge
                smeltingData={stages.smelting.data}
                prospectingData={stages.prospecting.data}
                tinkerMode={tinkerMode}
              />
            </div>
          )}
          {activeTab === "projects" && (
            <div className="tab-panel" role="tabpanel">
              <ProjectsShell />
            </div>
          )}
          {activeTab === "devtools" && tinkerMode && (
            <div className="tab-panel" role="tabpanel" style={{ padding: 0 }}>
              <DevTools />
            </div>
          )}
        </ErrorBoundary>
      </main>

      {/* ── Setup Wizard overlay ─────────────────────── */}
      {showSetup && <SetupWizard onClose={() => setShowSetup(false)} />}
      {onboardingReady && showOnboarding && (
        <OnboardingShell
          onClose={closeOnboarding}
          onFinish={finishOnboarding}
        />
      )}
    </div>
  );
}

/* -- Titlebar ----------------------------------------------- */
interface TitlebarProps {
  tinkerMode:     boolean;
  onToggleTinker: () => void;
  onSetup:        () => void;
  onWalkthrough:  () => void;
}

function Titlebar({ tinkerMode, onToggleTinker, onSetup, onWalkthrough }: TitlebarProps) {
  async function minimize() {
    console.info("[InterForge] minimize window");
    await getCurrentWindow().minimize();
  }
  async function maximize() {
    console.info("[InterForge] toggle maximize window");
    const win = getCurrentWindow();
    const maximized = await win.isMaximized();
    if (maximized) {
      await win.unmaximize();
      return;
    }
    await win.maximize();
  }
  async function close() {
    console.info("[InterForge] close window");
    await getCurrentWindow().close();
  }

  return (
    <div className="titlebar">
      <div className="titlebar__logo">
        <svg className="titlebar__logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        <span className="titlebar__wordmark">
          Inter<span>Forge</span>
        </span>
      </div>

      {/* Tinker Mode — always centred in the titlebar */}
      <div className="titlebar__centre">
        <button
          className={`tinker-toggle ${tinkerMode ? "tinker-toggle--on" : ""}`}
          onClick={onToggleTinker}
          title="Bypass stage gates — jump to any pipeline directly"
        >
          <span className="tinker-toggle__icon">⚙</span>
          <span className="tinker-toggle__label">Tinker Mode</span>
          <span className="tinker-toggle__pill" />
        </button>
      </div>

      <div className="titlebar__controls">
        <button
          className="titlebar__utility"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onWalkthrough}
          title="Preview walkthrough"
        >
          Walkthrough
        </button>
        <button
          className="setup-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onSetup}
          title="Setup & Environment"
        >
          <span className="setup-btn__dot" />
          Setup
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
    </div>
  );
}

/* -- Tab button --------------------------------------------- */
interface TabButtonProps {
  id: AppTab; label: string;
  active: boolean; locked: boolean;
  disabled: boolean; tinker: boolean;
  onClick: () => void;
}

function TabButton({ label, active, locked, disabled, tinker, onClick }: TabButtonProps) {
  const classes = [
    "tab",
    active   ? "tab--active"   : "",
    disabled ? "tab--disabled" : "",
    tinker   ? "tab--tinker"   : "",
  ].filter(Boolean).join(" ");

  return (
    <button className={classes} onClick={onClick} role="tab" aria-selected={active}>
      {label}
      {locked && (
        <svg className="tab__lock" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 1a5 5 0 0 0-5 5v3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-2V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V6a3 3 0 0 1 3-3zm0 9a2 2 0 0 1 1 3.73V17a1 1 0 0 1-2 0v-1.27A2 2 0 0 1 12 12z"/>
        </svg>
      )}
      {tinker && !locked && (
        <span style={{ fontSize: 10, opacity: 0.7 }}>⚙</span>
      )}
    </button>
  );
}
