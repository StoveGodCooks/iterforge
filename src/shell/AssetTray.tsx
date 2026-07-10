/**
 * AssetTray — Collapsible right sidebar of recent generated assets.
 *
 * Left-click a thumbnail to open it in a full viewer (image lightbox, or the
 * 3D MeshViewer for GLBs). Right-click for the context menu.
 */
import { useState, useEffect, lazy, Suspense } from "react";
import { useAssetTray } from "../contexts/AssetTrayContext";
import type { AssetTrayItem } from "../contexts/AssetTrayContext";
import { usePipeline } from "../contexts/PipelineContext";
import { useContextMenu } from "./ContextMenu";
import type { ContextMenuEntry } from "./ContextMenu";

const MeshViewer = lazy(() => import("../components/MeshViewer/MeshViewer"));

function isGlb(item: AssetTrayItem): boolean {
  return item.tags.includes("glb") || item.src.toLowerCase().endsWith(".glb");
}

export default function AssetTray() {
  const { items, isOpen, toggle, removeItem } = useAssetTray();
  const { navigateTo } = usePipeline();
  const ctxMenu = useContextMenu();
  const [viewing, setViewing] = useState<AssetTrayItem | null>(null);

  // Close the viewer on Escape.
  useEffect(() => {
    if (!viewing) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setViewing(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);

  function handleThumbContext(e: React.MouseEvent, item: AssetTrayItem) {
    const menuItems: ContextMenuEntry[] = [
      { label: "Open viewer", icon: "🔍", action: () => setViewing(item) },
      { label: "Edit in Sketch", icon: "🖌", action: () => navigateTo("prospect") },
      { label: "Send to Prospect", icon: "🔷", hint: "as ref", action: () => navigateTo("prospect") },
      { separator: true },
      { label: "Remove from tray", icon: "🗑", action: () => removeItem(item.id) },
    ];
    ctxMenu.show(e, menuItems);
  }

  return (
    <>
      {isOpen && (
        <aside className="tray">
          <div className="tray__header">
            <span className="tray__title">Asset Tray</span>
            <button className="tray__toggle" onClick={toggle} title="Close tray">&times;</button>
          </div>
          <div className="tray__grid">
            {items.length === 0 && (
              <div className="tray__empty">
                Assets will appear here as you generate and lock images across stages.
              </div>
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className="tray__thumb"
                title={`${item.label} — click to view`}
                style={{ cursor: "pointer" }}
                onClick={() => setViewing(item)}
                onContextMenu={(e) => handleThumbContext(e, item)}
              >
                <img src={item.thumbnailSrc} alt={item.label} />
                {isGlb(item) && (
                  <span style={{
                    position: "absolute", top: 4, right: 4, fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.06em", padding: "1px 5px", borderRadius: 4,
                    background: "rgba(10,14,20,0.8)", color: "var(--yellow-bright)",
                    border: "1px solid rgba(200,216,236,0.3)",
                  }}>3D</span>
                )}
                <span className="tray__thumb-label">{item.label}</span>
              </div>
            ))}
          </div>
        </aside>
      )}

      {viewing && (
        <div
          onClick={() => setViewing(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(3,5,8,0.82)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 32,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(92vw, 960px)", height: "min(86vh, 760px)",
              display: "flex", flexDirection: "column",
              background: "var(--bg-base)", borderRadius: 12,
              border: "1px solid var(--steel-edge)",
              boxShadow: "var(--shadow-lg)", overflow: "hidden",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px", borderBottom: "1px solid var(--steel-edge)", flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-primary)" }}>
                {viewing.label}{isGlb(viewing) ? "  ·  3D mesh" : ""}
              </span>
              <button
                onClick={() => setViewing(null)}
                title="Close (Esc)"
                style={{
                  width: 28, height: 28, borderRadius: 6, cursor: "pointer",
                  border: "1px solid var(--steel-edge)", background: "transparent",
                  color: "var(--steel-shine)", fontSize: 16, lineHeight: 1,
                }}
              >&times;</button>
            </div>

            <div style={{
              flex: 1, minHeight: 0, position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--bg-void)",
            }}>
              {isGlb(viewing) ? (
                <Suspense fallback={<span style={{ color: "var(--steel-shine)", fontSize: 13 }}>Loading 3D…</span>}>
                  <div style={{ width: "100%", height: "100%" }}>
                    <MeshViewer glbUrl={viewing.src} />
                  </div>
                </Suspense>
              ) : (
                <img
                  src={viewing.src}
                  alt={viewing.label}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
