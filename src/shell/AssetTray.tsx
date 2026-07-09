/**
 * AssetTray — Collapsible right sidebar showing project asset thumbnails.
 *
 * Persists across all stages. Items are added as the user generates,
 * locks, or imports assets.
 */
import { useAssetTray } from "../contexts/AssetTrayContext";
import { usePipeline } from "../contexts/PipelineContext";
import { useContextMenu } from "./ContextMenu";
import type { ContextMenuEntry } from "./ContextMenu";

export default function AssetTray() {
  const { items, isOpen, toggle, removeItem } = useAssetTray();
  const { navigateTo } = usePipeline();
  const ctxMenu = useContextMenu();

  function handleThumbContext(e: React.MouseEvent, itemId: string) {
    const menuItems: ContextMenuEntry[] = [
      { label: "Edit in Sketch", icon: "🖌", action: () => navigateTo("prospect") },
      { label: "Pin to Board", icon: "📌", action: () => navigateTo("prospect") },
      { label: "Send to Prospect", icon: "🔷", hint: "as ref", action: () => navigateTo("prospect") },
      { separator: true },
      { label: "Remove from tray", icon: "🗑", action: () => removeItem(itemId) },
    ];
    ctxMenu.show(e, menuItems);
  }

  if (!isOpen) return null;

  return (
    <aside className="tray">
      <div className="tray__header">
        <span className="tray__title">Asset Tray</span>
        <button className="tray__toggle" onClick={toggle} title="Close tray">
          &times;
        </button>
      </div>
      <div className="tray__grid">
        {items.length === 0 && (
          <div className="tray__empty">
            Assets will appear here as you generate and lock images across stages.
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="tray__thumb" title={item.label} onContextMenu={(e) => handleThumbContext(e, item.id)}>
            <img src={item.thumbnailSrc} alt={item.label} />
            <span className="tray__thumb-label">{item.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
