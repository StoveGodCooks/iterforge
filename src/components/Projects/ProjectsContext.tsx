import { createContext, useContext, type ReactNode } from "react";
import { useProjectsState } from "./useProjectsState";

type ProjectsContextValue = ReturnType<typeof useProjectsState>;

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const state = useProjectsState();
  return <ProjectsContext.Provider value={state}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used inside ProjectsProvider");
  return ctx;
}
