/**
 * AnvilBoardContext — the Anvil Sketch Board (comic storyboard) store.
 *
 * Holds one board (title + story + panels), persisted to localStorage. Also
 * owns the full-screen overlay open state and a `pendingReference` bridge so a
 * panel can be handed to Prospect's img2img generation.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import type { AnvilBoard, AnvilPanel } from "../types/pipeline";

const STORAGE_KEY = "interforge.anvil.board";

let nextId = 1;

const emptyBoard = (): AnvilBoard => ({ title: "", story: "", panels: [] });

function loadBoard(): AnvilBoard {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBoard();
    const parsed = JSON.parse(raw) as AnvilBoard;
    return {
      title:  parsed.title ?? "",
      story:  parsed.story ?? "",
      panels: Array.isArray(parsed.panels) ? parsed.panels : [],
    };
  } catch {
    return emptyBoard();
  }
}

interface AnvilBoardState {
  board: AnvilBoard;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  setTitle: (title: string) => void;
  setStory: (story: string) => void;
  addPanel: (partial?: Partial<Omit<AnvilPanel, "id">>) => void;
  updatePanel: (id: string, patch: Partial<AnvilPanel>) => void;
  removePanel: (id: string) => void;
  reorder: (id: string, dir: -1 | 1) => void;
  /* Bridge: a filesystem path staged for the Prospect img2img reference. */
  pendingReference: string | null;
  sendToReference: (path: string) => void;
  clearPendingReference: () => void;
}

const AnvilBoardContext = createContext<AnvilBoardState | null>(null);

export function AnvilBoardProvider({ children }: { children: ReactNode }) {
  const [board, setBoard] = useState<AnvilBoard>(loadBoard);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingReference, setPendingReference] = useState<string | null>(null);

  // Persist the board on every change.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(board)); } catch { /* storage full/unavailable */ }
  }, [board]);

  const open  = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const setTitle = useCallback((title: string) => setBoard(b => ({ ...b, title })), []);
  const setStory = useCallback((story: string) => setBoard(b => ({ ...b, story })), []);

  const addPanel = useCallback((partial?: Partial<Omit<AnvilPanel, "id">>) => {
    setBoard(b => ({
      ...b,
      panels: [...b.panels, {
        id:        `ap-${Date.now()}-${nextId++}`,
        imageSrc:  partial?.imageSrc  ?? null,
        imagePath: partial?.imagePath ?? null,
        caption:   partial?.caption   ?? "",
      }],
    }));
  }, []);

  const updatePanel = useCallback((id: string, patch: Partial<AnvilPanel>) => {
    setBoard(b => ({ ...b, panels: b.panels.map(p => p.id === id ? { ...p, ...patch } : p) }));
  }, []);

  const removePanel = useCallback((id: string) => {
    setBoard(b => ({ ...b, panels: b.panels.filter(p => p.id !== id) }));
  }, []);

  const reorder = useCallback((id: string, dir: -1 | 1) => {
    setBoard(b => {
      const idx = b.panels.findIndex(p => p.id === id);
      if (idx < 0) return b;
      const j = idx + dir;
      if (j < 0 || j >= b.panels.length) return b;
      const panels = [...b.panels];
      [panels[idx], panels[j]] = [panels[j], panels[idx]];
      return { ...b, panels };
    });
  }, []);

  const sendToReference      = useCallback((path: string) => setPendingReference(path), []);
  const clearPendingReference = useCallback(() => setPendingReference(null), []);

  return (
    <AnvilBoardContext.Provider value={{
      board, isOpen, open, close, setTitle, setStory,
      addPanel, updatePanel, removePanel, reorder,
      pendingReference, sendToReference, clearPendingReference,
    }}>
      {children}
    </AnvilBoardContext.Provider>
  );
}

export function useAnvilBoard(): AnvilBoardState {
  const ctx = useContext(AnvilBoardContext);
  if (!ctx) throw new Error("useAnvilBoard must be used within AnvilBoardProvider");
  return ctx;
}
