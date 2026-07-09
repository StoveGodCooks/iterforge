/**
 * PipelineContext — Unified pipeline state for stage navigation and data flow.
 *
 * Replaces the old App.tsx tab/stage state. All stages are always accessible
 * (no more Tinker Mode gating).
 */
import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { ProspectingOutput, SmeltingOutput } from "../types/pipeline";

/* ── Public types ─────────────────────────────────────────── */

export type PipelineStage =
  | "prospect"
  | "smelt"
  | "forge";

export type AppView = PipelineStage | "projects" | "devtools";

interface StageData<T = unknown> {
  locked: boolean;
  data: T | null;
}

interface PipelineState {
  activeView: AppView;
  navigateTo: (view: AppView) => void;

  /* Stage data — existing pipeline flow */
  prospectData: StageData<ProspectingOutput>;
  smeltData: StageData<SmeltingOutput>;
  forgeData: StageData<unknown>;
  lockStage: (stage: "prospect" | "smelt" | "forge", data: unknown) => void;

  /* DevTools visibility */
  devToolsEnabled: boolean;
  setDevToolsEnabled: (v: boolean) => void;
}

const PipelineContext = createContext<PipelineState | null>(null);

/* ── Provider ─────────────────────────────────────────────── */

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<AppView>("prospect");
  const [devToolsEnabled, setDevToolsEnabled] = useState(false);

  const [prospectData, setProspectData] = useState<StageData<ProspectingOutput>>({
    locked: false,
    data: null,
  });
  const [smeltData, setSmeltData] = useState<StageData<SmeltingOutput>>({
    locked: false,
    data: null,
  });
  const [forgeData, setForgeData] = useState<StageData<unknown>>({
    locked: false,
    data: null,
  });

  const navigateTo = useCallback((view: AppView) => {
    setActiveView(view);
  }, []);

  const lockStage = useCallback(
    (stage: "prospect" | "smelt" | "forge", data: unknown) => {
      if (stage === "prospect") {
        setProspectData({ locked: true, data: data as ProspectingOutput });
        setActiveView("forge");
      } else if (stage === "smelt") {
        setSmeltData({ locked: true, data: data as SmeltingOutput });
        setActiveView("forge");
      } else if (stage === "forge") {
        setForgeData({ locked: true, data });
      }
    },
    [],
  );

  return (
    <PipelineContext.Provider
      value={{
        activeView,
        navigateTo,
        prospectData,
        smeltData,
        forgeData,
        lockStage,
        devToolsEnabled,
        setDevToolsEnabled,
      }}
    >
      {children}
    </PipelineContext.Provider>
  );
}

/* ── Hook ─────────────────────────────────────────────────── */

export function usePipeline(): PipelineState {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within PipelineProvider");
  return ctx;
}
