/**
 * ExportHub — Export format cards.
 */
import { open } from "@tauri-apps/plugin-shell";
import { usePipeline } from "../../contexts/PipelineContext";
import type { ForgeOutput } from "../../types/pipeline";

export default function ExportHub() {
  const { forgeData, smeltData } = usePipeline();

  const forge         = forgeData.data as ForgeOutput | null;
  const projectFolder = forge?.projectFolder ?? null;
  const meshUrl       = forge?.meshPath ?? null;
  const hasForge      = !!forge;
  const hasSmelt      = smeltData.locked && !!smeltData.data;

  async function handleOpenFolder() {
    if (!projectFolder) return;
    try {
      await open(projectFolder);
    } catch { /* ignore */ }
  }

  const FORMATS = [
    {
      label:   "Open Project Folder",
      desc:    "Open the output directory containing all generated files",
      icon:    "📂",
      enabled: !!projectFolder,
      onClick: handleOpenFolder,
    },
    {
      label:   "Godot Scene",
      desc:    "Export as .tscn with materials and textures",
      icon:    "🎮",
      enabled: false,
      onClick: undefined,
    },
    {
      label:   "Unity Package",
      desc:    "Export as .unitypackage with prefab setup",
      icon:    "🔲",
      enabled: false,
      onClick: undefined,
    },
    {
      label:   "Individual Files",
      desc:    "Browse and pick files from the output folder",
      icon:    "📁",
      enabled: !!projectFolder,
      onClick: handleOpenFolder,
    },
  ];

  return (
    <div className="export-grid">
      {!hasForge && !hasSmelt && (
        <p style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
          Complete the Forge pipeline to enable exports.
        </p>
      )}

      {FORMATS.map((fmt) => (
        <div key={fmt.label} className="export-card">
          <span className="export-card__icon">{fmt.icon}</span>
          <div>
            <div className="export-card__label">{fmt.label}</div>
            <div className="export-card__desc">{fmt.desc}</div>
          </div>
          <button
            className="export-card__btn"
            disabled={!fmt.enabled}
            onClick={fmt.onClick}
          >
            {fmt.enabled ? "Open" : "Soon"}
          </button>
        </div>
      ))}

      {hasForge && meshUrl && (
        <div style={{ gridColumn: "1/-1", marginTop: 8, padding: "8px 12px", background: "var(--bg-overlay)", borderRadius: "var(--radius-sm)", fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {meshUrl.split("/").pop()} · {forge?.exportFormat}
          {forge?.polyCount ? ` · ${forge.polyCount.toLocaleString()} polys` : ""}
        </div>
      )}
    </div>
  );
}
