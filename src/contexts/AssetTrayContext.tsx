/**
 * AssetTrayContext — Manages the persistent Asset Tray sidebar.
 *
 * Items are added as the user generates/locks assets across stages.
 * The tray persists across stage switches.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";
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

const MAX_ITEMS = 6;                         // keep only the last 6 assets
const STORAGE_KEY = "interforge.assetTray";  // persist across reloads

function loadPersisted(): AssetTrayItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AssetTrayItem[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

export function AssetTrayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AssetTrayItem[]>(loadPersisted);
  const [isOpen, setIsOpen] = useState(true);

  // Persist the tray whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [items]);

  const toggle = useCallback(() => setIsOpen((p) => !p), []);

  const addItem = useCallback(
    (partial: Omit<AssetTrayItem, "id" | "createdAt">) => {
      setItems((prev) => {
        // Skip exact-duplicate sources (same generation event firing twice).
        if (prev.some((i) => i.src === partial.src)) return prev;
        const item: AssetTrayItem = {
          ...partial,
          id: `tray-${Date.now()}-${nextId++}`,
          createdAt: new Date().toISOString(),
        };
        return [item, ...prev].slice(0, MAX_ITEMS);
      });
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
