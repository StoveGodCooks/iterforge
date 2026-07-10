import { Component, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import "./styles/app.css";
import "./styles/setup.css";

import { PipelineProvider, usePipeline } from "./contexts/PipelineContext";
import { AssetTrayProvider } from "./contexts/AssetTrayContext";
import { AnvilBoardProvider } from "./contexts/AnvilBoardContext";
import { ContextMenuProvider } from "./shell/ContextMenu";
import { ProjectsProvider } from "./components/Projects/ProjectsContext";

import HeaderBar from "./shell/HeaderBar";
import AssetTray from "./shell/AssetTray";
import AnvilSketchBoard from "./components/Anvil/AnvilSketchBoard";

import ProspectStage from "./stages/Prospect/ProspectStage";
import SmeltStage from "./stages/Smelt/SmeltStage";
import ForgeStage from "./stages/Forge/ForgeStage";
import DevTools from "./tabs/DevTools/DevTools";
import ProjectsShell from "./components/Projects/ProjectsShell";
import SetupWizard from "./components/SetupWizard/SetupWizard";
import OnboardingShell from "./components/Onboarding/OnboardingShell";
import ProjectBento from "./components/Projects/ProjectBento";

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
          justifyContent: "center", height: "100%", gap: 16,
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

/* ── App Shell (inner, needs contexts) ─────────────────────── */

const ONBOARDING_SEEN_KEY = "interforge.onboarding.seen";

function AppShell() {
  const {
    activeView, navigateTo,
    devToolsEnabled, setDevToolsEnabled,
  } = usePipeline();

  const [showSetup, setShowSetup] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [bentoOpen, setBentoOpen] = useState(false);
  const bentoOpenRef = useRef(bentoOpen);
  bentoOpenRef.current = bentoOpen;

  useEffect(() => {
    const seen = window.localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
    setShowOnboarding(!seen);
    setOnboardingReady(true);
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Shift+P → Project Bento
      if (e.shiftKey && e.key === "P" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setBentoOpen((prev) => !prev);
        return;
      }
      // Shift+D → DevTools toggle
      if (e.shiftKey && e.key === "D" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setDevToolsEnabled(!devToolsEnabled);
        return;
      }
      if (e.key === "Escape" && bentoOpenRef.current) {
        setBentoOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [devToolsEnabled, setDevToolsEnabled]);

  function markOnboardingSeen() {
    window.localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
  }

  function closeOnboarding() {
    markOnboardingSeen();
    setShowOnboarding(false);
  }

  function finishOnboarding(mode: "guided" | "tinker" | "projects") {
    markOnboardingSeen();
    setShowOnboarding(false);
    if (mode === "projects") {
      navigateTo("projects");
    } else {
      navigateTo("prospect");
    }
  }

  return (
    <div className="app-shell">
      <div className="app-main">
        <HeaderBar
          onSetup={() => setShowSetup(true)}
          onWalkthrough={() => setShowOnboarding(true)}
        />

        <div className="content-wrap">
          <main className="workspace">
            <ErrorBoundary>
              {/* Prospect + Pose + Forge stay mounted (display toggle) so their generated
                  art / frames / meshes survive navigation. Projects/DevTools remount. */}
              <div style={{ display: activeView === "prospect" ? "contents" : "none" }}><ProspectStage /></div>
              <div style={{ display: activeView === "smelt" ? "contents" : "none" }}><SmeltStage /></div>
              <div style={{ display: activeView === "forge" ? "contents" : "none" }}><ForgeStage /></div>
              {activeView === "projects" && <ProjectsShell />}
              {activeView === "devtools" && devToolsEnabled && <DevTools />}
            </ErrorBoundary>
          </main>

          <AssetTray />
        </div>
      </div>

      {/* Overlays */}
      {showSetup && <SetupWizard onClose={() => setShowSetup(false)} />}
      {onboardingReady && showOnboarding && (
        <OnboardingShell
          onClose={closeOnboarding}
          onFinish={finishOnboarding}
          onNavigate={(route) => {
            navigateTo(route as Parameters<typeof navigateTo>[0]);
            setShowOnboarding(false);
          }}
        />
      )}
      <ProjectBento
        open={bentoOpen}
        onClose={() => setBentoOpen(false)}
        onOpenProjects={() => navigateTo("projects")}
      />
      <AnvilSketchBoard />
    </div>
  );
}

/* ── Root component (wraps providers) ──────────────────────── */

export default function App() {
  return (
    <PipelineProvider>
      <ProjectsProvider>
        <AssetTrayProvider>
          <AnvilBoardProvider>
            <ContextMenuProvider>
              <AppShell />
            </ContextMenuProvider>
          </AnvilBoardProvider>
        </AssetTrayProvider>
      </ProjectsProvider>
    </PipelineProvider>
  );
}
