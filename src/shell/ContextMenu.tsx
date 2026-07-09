/**
 * ContextMenu — Portal-based right-click "Send to" menu.
 *
 * Any image or card across the app can trigger this via useContextMenu().
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import "../styles/context-menu.css";

/* ── Types ────────────────────────────────────────────────── */

export interface ContextMenuItem {
  label: string;
  icon?: string;
  hint?: string;
  action: () => void;
  separator?: false;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuState {
  show: (e: React.MouseEvent, items: ContextMenuEntry[]) => void;
}

const ContextMenuCtx = createContext<ContextMenuState | null>(null);

/* ── Provider + Renderer ──────────────────────────────────── */

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [items, setItems] = useState<ContextMenuEntry[]>([]);

  const show = useCallback(
    (e: React.MouseEvent, menuItems: ContextMenuEntry[]) => {
      e.preventDefault();
      e.stopPropagation();
      setPos({ x: e.clientX, y: e.clientY });
      setItems(menuItems);
      setVisible(true);
    },
    [],
  );

  // Close on any click
  useEffect(() => {
    if (!visible) return;
    function handleClose() {
      setVisible(false);
    }
    window.addEventListener("click", handleClose);
    window.addEventListener("contextmenu", handleClose);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("contextmenu", handleClose);
    };
  }, [visible]);

  return (
    <ContextMenuCtx.Provider value={{ show }}>
      {children}
      {visible && (
        <div
          className="ctx-menu show"
          style={{ left: pos.x, top: pos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="ctx-sep" />
            ) : (
              <button
                key={i}
                className="ctx-item"
                onClick={() => {
                  item.action();
                  setVisible(false);
                }}
              >
                {item.icon && <span className="ctx-item__icon">{item.icon}</span>}
                <span className="ctx-item__label">{item.label}</span>
                {item.hint && <span className="ctx-item__hint">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </ContextMenuCtx.Provider>
  );
}

/* ── Hook ─────────────────────────────────────────────────── */

export function useContextMenu(): ContextMenuState {
  const ctx = useContext(ContextMenuCtx);
  if (!ctx) throw new Error("useContextMenu must be used within ContextMenuProvider");
  return ctx;
}
