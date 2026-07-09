/**
 * AssetTrayContext — Manages the persistent Asset Tray sidebar.
 *
 * Items are added as the user generates/locks assets across stages.
 * The tray persists across stage switches.
 */
import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { PipelineStage } from "./PipelineContext";

/* ── Public types ─────────────────────────────────────────── */

export interface AssetTrayItem {
  id: string;
  src: string;
  thumbnailSrc: string;
  label: string;
  sourceStage: PipelineStage;
  sourceJobId: string | null;
  tags: string[];
  createdAt: string;
}

interface AssetTrayState {
  items: AssetTrayItem[];
  isOpen: boolean;
  toggle: () => void;
  addItem: (item: Omit<AssetTrayItem, "id" | "createdAt">) => void;
  removeItem: (id: string) => void;
  clear: () => void;
}

const AssetTrayContext = createContext<AssetTrayState | null>(null);

/* ── Provider ─────────────────────────────────────────────── */

let nextId = 1;

export function AssetTrayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AssetTrayItem[]>([]);
  const [isOpen, setIsOpen] = useState(true);

  const toggle = useCallback(() => setIsOpen((p) => !p), []);

  const addItem = useCallback(
    (partial: Omit<AssetTrayItem, "id" | "createdAt">) => {
      const item: AssetTrayItem = {
        ...partial,
        id: `tray-${nextId++}`,
        createdAt: new Date().toISOString(),
      };
      setItems((prev) => [item, ...prev]);
    },
    [],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return (
    <AssetTrayContext.Provider
      value={{ items, isOpen, toggle, addItem, removeItem, clear }}
    >
      {children}
    </AssetTrayContext.Provider>
  );
}

/* ── Hook ─────────────────────────────────────────────────── */

export function useAssetTray(): AssetTrayState {
  const ctx = useContext(AssetTrayContext);
  if (!ctx) throw new Error("useAssetTray must be used within AssetTrayProvider");
  return ctx;
}
