/**
 * SpriteSheet — 6-view sprite export grid.
 * Shows real smelting view images with export options.
 */
import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { usePipeline } from "../../contexts/PipelineContext";
import type { ViewAngle } from "../../types/pipeline";

const VIEW_ORDER: ViewAngle[] = [
  "front", "front_right", "right", "back", "left", "front_left",
];

const VIEW_LABELS: Record<ViewAngle, string> = {
  front:       "Front 0°",
  front_right: "FR 60°",
  right:       "Right 120°",
  back:        "Back 180°",
  left:        "Left 240°",
  front_left:  "FL 300°",
};

const BACKEND = "http://127.0.0.1:7842";

export default function SpriteSheet() {
  const { smeltData } = usePipeline();
  const [exporting, setExporting] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const hasViews = smeltData.locked && smeltData.data;
  const views    = smeltData.data?.views ?? null;

  async function handleExportAtlas() {
    if (!smeltData.data?.smeltJobId) return;
    setExporting(true);
    setError(null);

    try {
      const targetPath = await save({
        title: "Export PNG Atlas",
        defaultPath: "sprite_atlas.png",
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!targetPath) return;

      const res = await fetch(`${BACKEND}/api/publish/sprite-atlas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smelt_job_id: smeltData.data.smeltJobId }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      await writeFile(targetPath, new Uint8Array(await res.arrayBuffer()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportWithJson() {
    if (!smeltData.data?.smeltJobId) return;
    setExporting(true);
    setError(null);

    try {
      const targetPath = await save({
        title: "Export Atlas + JSON",
        defaultPath: "sprite_atlas.json",
        filters: [{ name: "JSON Metadata", extensions: ["json"] }],
      });
      if (!targetPath) return;

      const res = await fetch(`${BACKEND}/api/publish/sprite-atlas?include_json=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smelt_job_id: smeltData.data.smeltJobId }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const blob = await res.json() as { atlas_url: string; json: object };

      // Save JSON manifest
      await writeFile(targetPath, new TextEncoder().encode(JSON.stringify(blob.json, null, 2)));

      // Save atlas PNG alongside
      const pngPath = targetPath.replace(/\.json$/, ".png");
      const pngRes = await fetch(blob.atlas_url);
      if (pngRes.ok) {
        await writeFile(pngPath, new Uint8Array(await pngRes.arrayBuffer()));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="sprite-grid">
        {VIEW_ORDER.map((angle) => (
          <div key={angle} className="sprite-cell">
            <div className="sprite-cell__img">
              {views?.[angle] ? (
                <img
                  src={views[angle]}
                  alt={VIEW_LABELS[angle]}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  {VIEW_LABELS[angle]}
                </span>
              )}
            </div>
            <span className="sprite-cell__label">{VIEW_LABELS[angle]}</span>
          </div>
        ))}
      </div>

      {error && (
        <p style={{ textAlign: "center", color: "var(--ember-bright)", fontSize: 12, marginTop: 8 }}>
          ⚠ {error}
        </p>
      )}

      <div className="sprite-actions">
        <button
          className="sprite-export-btn"
          disabled={!hasViews || exporting}
          onClick={handleExportAtlas}
        >
          {exporting ? "Exporting…" : "Export PNG Atlas"}
        </button>
        <button
          className="sprite-export-btn"
          disabled={!hasViews || exporting}
          onClick={handleExportWithJson}
        >
          Export + JSON Metadata
        </button>
        <button className="sprite-export-btn" disabled>
          Export for Godot
        </button>
      </div>

      {!hasViews && (
        <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginTop: 16 }}>
          Generate and lock views in Smelt to enable sprite export.
        </p>
      )}
    </div>
  );
}
