import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";
import "../../styles/forge.css";
import type { ProspectingOutput, SmeltingOutput, ForgeOutput, ExportFormat } from "../../types/pipeline";
import { ENABLE_3D } from "../../featureFlags";
import { useAssetTray } from "../../contexts/AssetTrayContext";

const MeshViewer = lazy(() => import("../../components/MeshViewer/MeshViewer"));

import { BACKEND, jobStreamUrl } from "../../api/client";

/* ── Local types ─────────────────────────────────────────── */
type Pipeline  = "mesh" | "mesh2d" | "sprite" | "2D" | null;
type Mesh2DMode = "relief" | "extrude";
type StepStatus = "pending" | "active" | "done" | "error";

interface MeshStep {
  id: string;
  name: string;
  desc: string;
  status: StepStatus;
  statusText: string;
}

interface Props {
  smeltingData: SmeltingOutput | null;
  prospectingData: ProspectingOutput | null;
  onLock?: (data: ForgeOutput) => void;
}

/* ── Mesh pipeline steps — IDs must match forge_worker.py ───
   Order: reconstruct → decimate → repair → lod → export → save
   UV unwrap + texture bake are pinned for v2.
   ─────────────────────────────────────────────────────────── */
const INITIAL_STEPS: MeshStep[] = [
  {
    id: "build",
    name: "Build Geometry",
    desc: "Stable Fast 3D — single locked image → UV-textured mesh",
    status: "pending",
    statusText: "Waiting",
  },
  {
    id: "decimate",
    name: "Decimation",
    desc: "Reduce to target polygon count using quadric error simplification",
    status: "pending",
    statusText: "Waiting",
  },
  {
    id: "refine",
    name: "Refine",
    desc: "Smooth geometry + fix manifold — watertight, clean normals",
    status: "pending",
    statusText: "Waiting",
  },
  {
    id: "lod",
    name: "LOD Generation",
    desc: "Generate LOD0→LOD3 at 100% / 50% / 25% / 10% of decimated face count",
    status: "pending",
    statusText: "Waiting",
  },
  {
    id: "export",
    name: "Export",
    desc: "Package geometry into chosen format — GLB, FBX, or OBJ (texture in v2)",
    status: "pending",
    statusText: "Waiting",
  },
  {
    id: "save",
    name: "Save Project",
    desc: "Write project.json manifest — paths, settings, LOD table",
    status: "pending",
    statusText: "Waiting",
  },
];

const STEP_DONE_TEXT: Record<string, string> = {
  build:    "Geometry built",
  decimate: "Polygon count reduced",
  refine:   "Mesh refined",
  lod:      "4 LODs generated",
  export:   "File exported",
  save:     "Project saved",
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export default function Forge({ smeltingData, prospectingData, onLock }: Props) {
  const [pipeline, setPipeline] = useState<Pipeline>(null);

  return (
    <div className="forge">
      {pipeline === null && (
        <PipelinePicker onChoose={setPipeline} />
      )}
      {pipeline === "mesh" && (
        <MeshPipeline
          variant="3d"
          smeltingData={smeltingData}
          prospectingData={prospectingData}
          onBack={() => setPipeline(null)}
          onLock={onLock}
        />
      )}
      {pipeline === "mesh2d" && (
        <MeshPipeline
          variant="2dmesh"
          smeltingData={smeltingData}
          prospectingData={prospectingData}
          onBack={() => setPipeline(null)}
          onLock={onLock}
        />
      )}
      {pipeline === "sprite" && (
        <SpritePipeline
          smeltingData={smeltingData}
          onBack={() => setPipeline(null)}
        />
      )}
      {pipeline === "2D" && (
        <TwoDPipeline
          smeltingData={smeltingData}
          onBack={() => setPipeline(null)}
        />
      )}
    </div>
  );
}

/* ============================================================
   PIPELINE PICKER
   ============================================================ */
function PipelinePicker({
  onChoose,
}: {
  onChoose: (p: Pipeline) => void;
}) {
  return (
    <div className="forge-picker">
      <span className="forge-picker__label">Forge — Choose Pipeline</span>
      <h2 className="forge-picker__title">What are we building?</h2>

      <div className="forge-picker__cards">

        {/* ── 3D Mesh card — Stable Fast 3D (single Prospect image → mesh) ── */}
        <div className="pipeline-card pipeline-card--mesh" onClick={() => onChoose("mesh")}>
          <span className="pipeline-card__icon">🗿</span>
          <span className="pipeline-card__name">3D Mesh</span>
          <p className="pipeline-card__desc">
            Turn your locked Prospect image into a game-ready 3D model —
            UV-unwrapped and textured — with Stable Fast 3D.
          </p>
          <div className="pipeline-card__steps">
            {["Build (SF3D)", "Decimation", "Refine",
              "LOD Generation", "Export GLB / FBX", "Save Project"].map(s => (
              <span key={s} className="pipeline-card__step">
                <span className="pipeline-card__step-dot" />
                {s}
              </span>
            ))}
          </div>
          <button className="pipeline-card__cta">Enter Mesh Pipeline →</button>
        </div>

        {/* ── 2D Mesh card — depth relief (2.5D) / flat extrude (2D) ── */}
        <div className="pipeline-card pipeline-card--mesh" onClick={() => onChoose("mesh2d")}>
          <span className="pipeline-card__icon">🪧</span>
          <span className="pipeline-card__name">2D Mesh</span>
          <p className="pipeline-card__desc">
            Give a 2D asset real geometry — a depth <strong>relief (2.5D)</strong> that
            catches light, or a flat <strong>extrude</strong> billboard.
          </p>
          <div className="pipeline-card__steps">
            {["2.5D Relief (depth)", "or 2D Flat (extrude)",
              "Texture map", "Export GLB / FBX", "Save Project"].map(s => (
              <span key={s} className="pipeline-card__step">
                <span className="pipeline-card__step-dot" />
                {s}
              </span>
            ))}
          </div>
          <button className="pipeline-card__cta">Enter 2D Mesh Pipeline →</button>
        </div>

        {/* ── 3D-view Sprite card (3D — parked behind ENABLE_3D) ── */}
        {ENABLE_3D && (
        <div className="pipeline-card pipeline-card--sprite" onClick={() => onChoose("sprite")}>
          <span className="pipeline-card__icon">🎞</span>
          <span className="pipeline-card__name">Sprite Sheet</span>
          <p className="pipeline-card__desc">
            Turn your smelted images into a packed sprite sheet with animation
            frames — ready for Godot, Unity, or any 2D engine.
          </p>
          <div className="pipeline-card__steps">
            {["Frame Extraction", "Angle Tiling", "Outline / Shadow Pass",
              "BG Removal", "Sheet Packer", "Atlas JSON", "Engine Export"].map(s => (
              <span key={s} className="pipeline-card__step">
                <span className="pipeline-card__step-dot" />
                {s}
              </span>
            ))}
          </div>
          <button className="pipeline-card__cta">Enter Sprite Pipeline →</button>
        </div>
        )}

        {/* ── 2D Sprite card ─────────────────────────────── */}
        <div className="pipeline-card pipeline-card--sprite" onClick={() => onChoose("2D")}>
          <span className="pipeline-card__icon">🎮</span>
          <span className="pipeline-card__name">2D Sprite</span>
          <p className="pipeline-card__desc">
            Pack your posed sprite frames into clean, game-ready sprites
            with BG removal, pixel outline, and a packed atlas.
          </p>
          <div className="pipeline-card__steps">
            {["Load Poses", "BG Removal", "Auto-Crop", "Pixel Outline", "Pack Sheet", "Atlas JSON"].map(s => (
              <span key={s} className="pipeline-card__step">
                <span className="pipeline-card__step-dot" />
                {s}
              </span>
            ))}
          </div>
          <button className="pipeline-card__cta">Enter 2D Pipeline →</button>
        </div>

      </div>
    </div>
  );
}

/* ============================================================
   MESH PIPELINE
   ============================================================ */
interface MeshPipelineProps {
  variant?: "3d" | "2dmesh";
  smeltingData: SmeltingOutput | null;
  prospectingData: ProspectingOutput | null;
  onBack: () => void;
  onLock?: (data: ForgeOutput) => void;
}

function MeshPipeline({ variant = "3d", smeltingData, prospectingData, onBack, onLock }: MeshPipelineProps) {
  const is2DMesh = variant === "2dmesh";
  const [mesh2dMode, setMesh2dMode] = useState<Mesh2DMode>("relief");
  const { addItem: addToTray } = useAssetTray();
  const [steps,       setSteps]       = useState<MeshStep[]>(INITIAL_STEPS);
  const [running,     setRunning]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("GLB");
  const [meshUrl,     setMeshUrl]     = useState<string | null>(null);
  const [exportDir,   setExportDir]   = useState<string | null>(null);
  const [genStatus,   setGenStatus]   = useState("");
  const [jobId,       setJobId]       = useState<string | null>(null);
  const [viewPanel,   setViewPanel]   = useState<"viewer" | "publish">("viewer");
  const sseRef = useRef<EventSource | null>(null);

  /* Cleanup EventSource on unmount */
  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  const activeIndex = steps.findIndex(s => s.status === "active");
  const doneCount   = steps.filter(s => s.status === "done").length;

  const prospectJobId = prospectingData?.prospectJobId ?? null;
  const lockedImageIndex = prospectingData?.lockedImageIndex ?? 0;
  const previewImage = prospectingData?.imagePath ?? smeltingData?.views?.front ?? null;

  /* 2D-only asset types that shouldn't go through 3D pipeline */
  const ASSET_2D_ONLY = ["concept", "environment", "tileset", "vfx", "ui"];
  const is2DOnly = ASSET_2D_ONLY.includes(prospectingData?.assetType ?? "");

  /* SF3D builds the mesh from the single locked Prospect image — no smelt needed. */
  const smeltJobId = smeltingData?.smeltJobId ?? null;
  const hasSmeltJobs = !!smeltJobId;
  const hasJobs = !!prospectJobId && (is2DMesh || !is2DOnly);

  /* ── Mark a step active ──────────────────────────────────── */
  function setStepActive(stepId: string) {
    setSteps(prev => prev.map(s =>
      s.id === stepId
        ? { ...s, status: "active", statusText: "Processing…" }
        : s.status === "active"
          ? { ...s, status: "done", statusText: STEP_DONE_TEXT[s.id] ?? "Done" }
          : s
    ));
  }

  /* ── Mark a step done ────────────────────────────────────── */
  function setStepDone(stepId: string) {
    setSteps(prev => prev.map(s =>
      s.id === stepId
        ? { ...s, status: "done", statusText: STEP_DONE_TEXT[s.id] ?? "Done" }
        : s
    ));
  }

  /* ── Run pipeline ────────────────────────────────────────── */
  async function runPipeline() {
    if (!hasJobs) return;
    setRunning(true);
    setDone(false);
    setError(null);
    setMeshUrl(null);
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));

    try {
      const res = await fetch(`${BACKEND}/api/forge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospect_job_id:     prospectJobId,
          image_index:         lockedImageIndex,
          // "auto" → SF3D full 3D; "relief" → 2.5D depth mesh; "extrude" → 2D flat billboard
          reconstruction_path: is2DMesh ? mesh2dMode : "auto",
          export_format:       exportFormat.toLowerCase(),
          target_poly_count:   15000,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(
          err.detail?.message
          ?? (typeof err.detail === "string" ? err.detail : null)
          ?? "Backend error"
        );
      }

      const { job_id } = await res.json();
      setJobId(job_id);
      const sse = new EventSource(jobStreamUrl(job_id));
      sseRef.current = sse;

      sse.onmessage = (e) => {
        const event = JSON.parse(e.data) as Record<string, unknown>;
        const type  = event.type as string;

        if (type === "step_active") {
          const sid = event.step_id as string;
          setStepActive(sid);
          setGenStatus((event.description as string) || sid);
        }

        if (type === "step_done") {
          setStepDone(event.step_id as string);
        }

        if (type === "progress") {
          setGenStatus((event.message as string) ?? "Processing…");
        }

        if (type === "log") {
          setGenStatus(event.message as string);
        }

        if (type === "mesh_ready") {
          setMeshUrl(event.mesh_url as string);
        }

        if (type === "done") {
          // Mark any remaining active step as done
          setSteps(prev => prev.map(s =>
            s.status === "active"
              ? { ...s, status: "done", statusText: STEP_DONE_TEXT[s.id] ?? "Done" }
              : s
          ));
          const meshUrl_ = (event.mesh_url as string | null) ?? null;
          const outDir_  = (event.out_dir  as string | null) ?? null;
          if (meshUrl_) {
            setMeshUrl(meshUrl_);
            addToTray({
              src: meshUrl_,
              thumbnailSrc: previewImage ?? meshUrl_,
              label: is2DMesh ? (mesh2dMode === "relief" ? "2.5D Relief" : "2D Flat") : "3D Mesh",
              sourceStage: "forge",
              sourceJobId: job_id,
              tags: ["glb"],
            });
          }
          setExportDir(outDir_);
          setGenStatus("Pipeline complete");
          setDone(true);
          setRunning(false);
          sse.close();
          sseRef.current = null;

          // Lock result into pipeline context → navigates to Publish
          if (onLock && meshUrl_) {
            onLock({
              meshPath:      meshUrl_,
              lodPaths:      (event.lod_paths as Record<string, string>) ?? {},
              texturePaths:  { albedo: null, normal: null, roughness: null },
              exportFormat:  exportFormat,
              polyCount:     0,
              projectFolder: outDir_ ?? "",
              completedAt:   new Date().toISOString(),
            });
          }
        }

        if (type === "error") {
          setError((event.message as string) ?? "Unknown error");
          setRunning(false);
          sse.close();
          sseRef.current = null;
        }
      };

      sse.onerror = () => {
        setError("Connection to backend lost.");
        setRunning(false);
        sse.close();
        sseRef.current = null;
      };

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  /* Cancel running job */
  async function cancelJob() {
    if (!jobId) return;
    try {
      await fetch(`${BACKEND}/api/jobs/${jobId}`, { method: "DELETE" });
    } catch { /* ignore */ }
    sseRef.current?.close();
    sseRef.current = null;
    setRunning(false);
    setError("Pipeline cancelled.");
  }

  /* Reset */
  function reset() {
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setRunning(false);
    setDone(false);
    setError(null);
    setMeshUrl(null);
    setExportDir(null);
    setGenStatus("");
    setJobId(null);
    setViewPanel("viewer");
  }

  async function handleOpenFolder() {
    if (!exportDir) return;

    try {
      await open(exportDir);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to open export folder.");
    }
  }

  async function handleExportSave() {
    if (!meshUrl) return;

    try {
      const fileName = meshUrl.split("/").pop() ?? `asset.${exportFormat.toLowerCase()}`;
      const targetPath = await save({
        title: `Export ${exportFormat}`,
        defaultPath: fileName,
        filters: [{
          name: exportFormat,
          extensions: [exportFormat.toLowerCase()],
        }],
      });

      if (!targetPath) return;

      const response = await fetch(meshUrl);
      if (!response.ok) {
        throw new Error(`Export download failed (${response.status})`);
      }

      await writeFile(targetPath, new Uint8Array(await response.arrayBuffer()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export file.");
    }
  }

  return (
    <div className="mesh-pipeline">

      {/* ── LEFT: step-by-step panel ─────────────────────── */}
      <aside className="mesh__panel">
        <div className="mesh__panel-header">
          <span className="mesh__panel-title">{is2DMesh ? "🪧 2D Mesh Pipeline" : "🗿 Mesh Pipeline"}</span>
          <button className="forge__back-btn" onClick={onBack}>← Back</button>
        </div>

        {is2DMesh && (
          <div style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-3)", paddingBottom: 0 }}>
            {([["relief", "2.5D Relief", "depth · lit surface"], ["extrude", "2D Flat", "extruded billboard"]] as [Mesh2DMode, string, string][]).map(([m, label, hint]) => (
              <button
                key={m}
                onClick={() => setMesh2dMode(m)}
                disabled={running}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", gap: 2,
                  padding: "var(--space-2)", borderRadius: 8, textAlign: "left",
                  border: mesh2dMode === m ? "1px solid var(--yellow-core)" : "1px solid rgba(255,255,255,0.1)",
                  background: mesh2dMode === m ? "var(--forge-glow-bg)" : "transparent",
                  color: mesh2dMode === m ? "var(--yellow-bright)" : "var(--text-muted)",
                  cursor: running ? "default" : "pointer", fontWeight: 700, fontSize: "var(--text-sm)",
                }}
              >
                {label}
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 400, opacity: 0.75 }}>{hint}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mesh__panel-scroll">
          {steps.map((step, i) => (
            <MeshStepRow key={step.id} step={step} index={i + 1} />
          ))}
        </div>

        <div className="mesh__panel-footer">
          {/* Progress bar */}
          {running && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {genStatus || "Processing…"}
                </span>
                <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--yellow-bright)", flexShrink: 0, marginLeft: 8 }}>
                  {doneCount} / {steps.length}
                </span>
              </div>
              <div className="progress-track" style={{ marginBottom: "var(--space-3)" }}>
                <div className="progress-fill" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="forge__error-box">
              ⚠ {error}
            </div>
          )}

          {/* 2D asset type warning — only blocks the full-3D SF3D route */}
          {is2DOnly && !is2DMesh && !running && (
            <div className="forge__error-box" style={{ background: "rgba(255,200,0,0.08)", borderColor: "rgba(255,200,0,0.2)", color: "var(--yellow-bright)" }}>
              ⚠ <strong>{(prospectingData?.assetType ?? "").replace("_", " ").toUpperCase()}</strong> is a 2D asset type.
              The 3D Mesh pipeline needs a 3D type (Weapon, Character, Prop) — or use the <strong>2D Mesh</strong> pipeline.
            </div>
          )}

          {!hasJobs && !(is2DOnly && !is2DMesh) && !running && (
            <div className="forge__error-box" style={{ background: "rgba(255,200,0,0.08)", borderColor: "rgba(255,200,0,0.2)", color: "var(--yellow-bright)" }}>
              ⚠ Lock a Prospect image first — {is2DMesh
                ? (mesh2dMode === "relief"
                    ? "the 2.5D relief is built from your concept image's depth"
                    : "the 2D billboard is built from your concept image")
                : "Stable Fast 3D builds the mesh from your locked concept image"}
            </div>
          )}

          {/* Run / Cancel / Reset button */}
          {done ? (
            <button
              className="btn btn--secondary"
              style={{ width: "100%", height: 36 }}
              onClick={reset}
            >
              ↺ Run Again
            </button>
          ) : running ? (
            <div style={{ display: "flex", gap: "var(--space-2)", width: "100%" }}>
              <button
                className="btn btn--primary"
                style={{ flex: 1, height: 44, fontSize: "var(--text-md)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}
                disabled
              >
                <span className="spinner" style={{ borderTopColor: "#000" }} /> Processing…
              </button>
              <button
                className="btn btn--secondary"
                style={{ height: 44, fontSize: "var(--text-xs)", padding: "0 var(--space-3)" }}
                onClick={cancelJob}
                title="Cancel pipeline"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              className="btn btn--primary"
              style={{ width: "100%", height: 44, fontSize: "var(--text-md)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}
              onClick={runPipeline}
              disabled={!hasJobs}
            >
              {is2DMesh ? (mesh2dMode === "relief" ? "✦ Run 2.5D Relief" : "✦ Run 2D Flat") : "✦ Run Mesh Pipeline"}
            </button>
          )}
        </div>
      </aside>

      {/* ── RIGHT: viewport ──────────────────────────────── */}
      <div className="mesh__viewport">
        <div className="mesh__viewport-toolbar">
          <span className="mesh__viewport-title">
            ◈ Mesh Preview
            {done  && <span className="badge badge--success" style={{ marginLeft: 8 }}>Ready</span>}
            {running && <span className="badge badge--yellow" style={{ marginLeft: 8 }}>Processing</span>}
          </span>
          <div className="mesh__viewport-actions">
            {done && meshUrl && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {meshUrl.split("/").pop()}
              </span>
            )}
          </div>
        </div>

        {/* Canvas / preview area */}
        <div className="mesh__canvas">
          {viewPanel === "publish" ? (
            <ForgePublishPanel
              smeltingData={smeltingData}
              onBack={() => setViewPanel("viewer")}
            />
          ) : (
            <>
              {!running && !done && !error && (
                <div className="mesh__canvas-empty">
                  <span className="mesh__canvas-empty-icon">🗿</span>
                  <span className="mesh__canvas-empty-text">
                    Run the pipeline to generate your 3D mesh
                  </span>
                  {previewImage && (
                    <img
                      src={previewImage}
                      alt="Front view reference"
                      style={{ width: 128, height: 128, objectFit: "contain", opacity: 0.5, marginTop: "var(--space-3)", borderRadius: "var(--radius-sm)" }}
                    />
                  )}
                </div>
              )}

              {running && activeIndex >= 0 && (
                <div className="mesh__processing-overlay">
                  <span className="spinner spinner--lg" />
                  <span className="mesh__processing-step">
                    Step {activeIndex + 1} / {steps.length} — {steps[activeIndex]?.name}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", maxWidth: 320, textAlign: "center" }}>
                    {steps[activeIndex]?.desc}
                  </span>
                </div>
              )}

              {error && (
                <div className="mesh__canvas-empty">
                  <span style={{ fontSize: 48 }}>⚠</span>
                  <span className="mesh__canvas-empty-text" style={{ color: "var(--ember-bright)" }}>
                    {error}
                  </span>
                </div>
              )}

              {done && meshUrl && meshUrl.endsWith(".glb") && (
                <Suspense
                  fallback={
                    <div className="mesh__canvas-empty">
                      <span className="spinner spinner--lg" />
                      <span className="mesh__canvas-empty-text">Loading 3D viewer...</span>
                    </div>
                  }
                >
                  <MeshViewer glbUrl={meshUrl} />
                </Suspense>
              )}

              {done && (!meshUrl || !meshUrl.endsWith(".glb")) && (
                <div className="mesh__canvas-empty">
                  <span style={{ fontSize: 64 }}>&#x2705;</span>
                  <span className="mesh__canvas-empty-text">
                    Mesh pipeline complete
                  </span>
                  {meshUrl && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--yellow-bright)", fontFamily: "var(--font-mono)", marginTop: "var(--space-2)" }}>
                      {meshUrl.split("/").pop()} ready
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Export footer — hidden when publish panel is open */}
        {viewPanel === "viewer" && (
        <div className="mesh__viewport-footer">
          <div className="mesh__export-row">
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Format:
            </span>
            {(["GLB", "FBX", "OBJ"] as ExportFormat[]).map(f => (
              <button
                key={f}
                className={`mesh__format-btn ${exportFormat === f ? "mesh__format-btn--active" : ""}`}
                onClick={() => setExportFormat(f)}
                disabled={running}
              >
                {f}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button
              className="btn btn--secondary"
              style={{ height: 36, fontSize: "var(--text-xs)" }}
              disabled={!done || !exportDir}
              onClick={handleOpenFolder}
            >
              📂 Open Folder
            </button>
            <button
              className="btn btn--lock"
              style={{ height: 36, fontSize: "var(--text-xs)" }}
              disabled={!done || !meshUrl}
              onClick={handleExportSave}
            >
              Export {exportFormat}
            </button>
            <button
              className="btn btn--secondary"
              style={{ height: 36, fontSize: "var(--text-xs)" }}
              disabled={!hasSmeltJobs}
              onClick={() => setViewPanel("publish")}
            >
              Publish ↗
            </button>
          </div>
        </div>
        )}
      </div>

    </div>
  );
}

/* ── Single mesh step row ─────────────────────────────────── */
function MeshStepRow({ step, index }: { step: MeshStep; index: number }) {
  const cls = ["mesh-step", `mesh-step--${step.status}`].join(" ");

  return (
    <div className={cls}>
      <div className="mesh-step__circle">
        {step.status === "done"   ? "✓" :
         step.status === "error"  ? "✕" :
         step.status === "active" ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> :
         index}
      </div>
      <div className="mesh-step__body">
        <div className="mesh-step__name">{step.name}</div>
        <div className="mesh-step__desc">{step.desc}</div>
        <div className="mesh-step__status">{step.statusText}</div>
      </div>
    </div>
  );
}

/* ============================================================
   FORGE PUBLISH PANEL
   Inline sprite export — flips the mesh viewport when Publish is clicked.
   ============================================================ */
const PUBLISH_VIEW_ORDER = ["front", "front_right", "right", "back", "left", "front_left"] as const;
type PublishAngle = (typeof PUBLISH_VIEW_ORDER)[number];
const PUBLISH_LABELS: Record<PublishAngle, string> = {
  front: "Front 0°", front_right: "FR 60°", right: "Right 120°",
  back: "Back 180°", left: "Left 240°", front_left: "FL 300°",
};

function ForgePublishPanel({
  smeltingData,
  onBack,
}: {
  smeltingData: SmeltingOutput | null;
  onBack: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const views     = smeltingData?.views as Record<string, string> | undefined;
  const smeltJobId = smeltingData?.smeltJobId ?? null;
  const hasViews  = !!views && !!smeltJobId;

  async function exportAtlas(includeJson = false) {
    if (!smeltJobId) return;
    setExporting(true);
    setError(null);
    try {
      if (includeJson) {
        const targetPath = await save({
          title: "Export Atlas + JSON",
          defaultPath: "sprite_atlas.json",
          filters: [{ name: "JSON Metadata", extensions: ["json"] }],
        });
        if (!targetPath) return;
        const res = await fetch(`${BACKEND}/api/publish/sprite-atlas?include_json=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smelt_job_id: smeltJobId }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const blob = await res.json() as { atlas_url: string; json: object };
        await writeFile(targetPath, new TextEncoder().encode(JSON.stringify(blob.json, null, 2)));
        const pngPath = targetPath.replace(/\.json$/, ".png");
        const pngRes  = await fetch(`${BACKEND}${blob.atlas_url}`);
        if (pngRes.ok) await writeFile(pngPath, new Uint8Array(await pngRes.arrayBuffer()));
      } else {
        const targetPath = await save({
          title: "Export PNG Atlas",
          defaultPath: "sprite_atlas.png",
          filters: [{ name: "PNG Image", extensions: ["png"] }],
        });
        if (!targetPath) return;
        const res = await fetch(`${BACKEND}/api/publish/sprite-atlas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smelt_job_id: smeltJobId }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        await writeFile(targetPath, new Uint8Array(await res.arrayBuffer()));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--bg-border)", flexShrink: 0 }}>
        <button className="forge__back-btn" onClick={onBack} style={{ margin: 0 }}>← Mesh</button>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>
          Sprite Export
        </span>
      </div>

      {/* View grid */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-3)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-2)" }}>
          {PUBLISH_VIEW_ORDER.map((angle) => (
            <div key={angle} style={{ aspectRatio: "1", background: "var(--bg-overlay)", borderRadius: "var(--radius-sm)", border: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
              {views?.[angle] ? (
                <img src={views[angle]} alt={PUBLISH_LABELS[angle]} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{PUBLISH_LABELS[angle]}</span>
              )}
              <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "var(--text-muted)", background: "rgba(0,0,0,0.55)", padding: "2px 0" }}>
                {PUBLISH_LABELS[angle]}
              </span>
            </div>
          ))}
        </div>
        {!hasViews && (
          <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginTop: 16 }}>
            Complete Smelting to enable sprite export.
          </p>
        )}
        {error && (
          <p style={{ color: "var(--ember-bright)", fontSize: 12, marginTop: 8, textAlign: "center" }}>⚠ {error}</p>
        )}
      </div>

      {/* Export buttons */}
      <div style={{ padding: "var(--space-2) var(--space-3)", borderTop: "1px solid var(--bg-border)", display: "flex", flexDirection: "column", gap: "var(--space-2)", flexShrink: 0 }}>
        <button
          className="btn btn--primary"
          style={{ width: "100%", height: 36, fontSize: "var(--text-xs)" }}
          disabled={!hasViews || exporting}
          onClick={() => exportAtlas(false)}
        >
          {exporting ? "Exporting…" : "Export PNG Atlas"}
        </button>
        <button
          className="btn btn--secondary"
          style={{ width: "100%", height: 36, fontSize: "var(--text-xs)" }}
          disabled={!hasViews || exporting}
          onClick={() => exportAtlas(true)}
        >
          Export + JSON Metadata
        </button>
        <button className="btn btn--secondary" style={{ width: "100%", height: 36, fontSize: "var(--text-xs)" }} disabled>
          Export for Godot — Soon
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   SPRITE PIPELINE
   ============================================================ */
interface SpritePipelineProps {
  smeltingData: SmeltingOutput | null;
  onBack: () => void;
}

function SpritePipeline({ smeltingData, onBack }: SpritePipelineProps) {
  const [exporting, setExporting] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const views      = smeltingData?.views as Record<string, string> | undefined;
  const smeltJobId = smeltingData?.smeltJobId ?? null;
  const hasViews   = !!views && !!smeltJobId;

  async function exportAtlas(includeJson = false) {
    if (!smeltJobId) return;
    setExporting(true);
    setError(null);
    try {
      if (includeJson) {
        const targetPath = await save({
          title: "Export Atlas + JSON",
          defaultPath: "sprite_atlas.json",
          filters: [{ name: "JSON Metadata", extensions: ["json"] }],
        });
        if (!targetPath) return;
        const res = await fetch(`${BACKEND}/api/publish/sprite-atlas?include_json=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smelt_job_id: smeltJobId }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const blob = await res.json() as { atlas_url: string; json: object };
        await writeFile(targetPath, new TextEncoder().encode(JSON.stringify(blob.json, null, 2)));
        const pngPath = targetPath.replace(/\.json$/, ".png");
        const pngRes  = await fetch(`${BACKEND}${blob.atlas_url}`);
        if (pngRes.ok) await writeFile(pngPath, new Uint8Array(await pngRes.arrayBuffer()));
      } else {
        const targetPath = await save({
          title: "Export PNG Atlas",
          defaultPath: "sprite_atlas.png",
          filters: [{ name: "PNG Image", extensions: ["png"] }],
        });
        if (!targetPath) return;
        const res = await fetch(`${BACKEND}/api/publish/sprite-atlas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smelt_job_id: smeltJobId }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        await writeFile(targetPath, new Uint8Array(await res.arrayBuffer()));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mesh-pipeline">
      {/* ── LEFT: controls ───────────────────────────────── */}
      <aside className="mesh__panel">
        <div className="mesh__panel-header">
          <span className="mesh__panel-title">🎞 Sprite Pipeline</span>
          <button className="forge__back-btn" onClick={onBack}>← Back</button>
        </div>
        <div className="mesh__panel-scroll" style={{ padding: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <p>Pack your 6 smelted views into a sprite atlas — ready for Godot, Unity, or any 2D engine.</p>
          <p style={{ marginTop: "var(--space-3)", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
            The atlas is a 3×2 grid at uniform cell size. An optional JSON manifest maps each frame's position and label.
          </p>
        </div>
        <div className="mesh__panel-footer">
          {error && <div className="forge__error-box">⚠ {error}</div>}
          {!hasViews && (
            <div className="forge__error-box" style={{ background: "rgba(255,200,0,0.08)", borderColor: "rgba(255,200,0,0.2)", color: "var(--yellow-bright)" }}>
              ⚠ Complete Smelting to enable sprite export
            </div>
          )}
          <button
            className="btn btn--primary"
            style={{ width: "100%", height: 44, fontSize: "var(--text-md)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}
            disabled={!hasViews || exporting}
            onClick={() => exportAtlas(false)}
          >
            {exporting ? "Exporting…" : "✦ Export PNG Atlas"}
          </button>
          <button
            className="btn btn--secondary"
            style={{ width: "100%", height: 36, fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }}
            disabled={!hasViews || exporting}
            onClick={() => exportAtlas(true)}
          >
            Export + JSON Metadata
          </button>
          <button className="btn btn--secondary" style={{ width: "100%", height: 36, fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }} disabled>
            Export for Godot — Soon
          </button>
        </div>
      </aside>

      {/* ── RIGHT: 6-view grid ───────────────────────────── */}
      <div className="mesh__viewport">
        <div className="mesh__viewport-toolbar">
          <span className="mesh__viewport-title">◈ Sprite Preview</span>
        </div>
        <div className="mesh__canvas" style={{ padding: "var(--space-3)" }}>
          {hasViews ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-2)", height: "100%", alignContent: "start" }}>
              {PUBLISH_VIEW_ORDER.map((angle) => (
                <div key={angle} style={{ aspectRatio: "1", background: "var(--bg-overlay)", borderRadius: "var(--radius-sm)", border: "1px solid var(--bg-border)", overflow: "hidden", position: "relative" }}>
                  {views?.[angle] ? (
                    <img src={views[angle]} alt={PUBLISH_LABELS[angle]} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      {PUBLISH_LABELS[angle]}
                    </div>
                  )}
                  <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "var(--text-muted)", background: "rgba(0,0,0,0.55)", padding: "2px 0" }}>
                    {PUBLISH_LABELS[angle]}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mesh__canvas-empty">
              <span style={{ fontSize: 48 }}>🎞</span>
              <span className="mesh__canvas-empty-text">Complete Smelting to preview sprite views</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   2D SPRITE PIPELINE
   ============================================================ */
const STEP_2D = [
  { id: "load",    name: "Load",    desc: "Resolve direction images from smelt job" },
  { id: "rembg",  name: "BG Remove", desc: "Background removal on each direction" },
  { id: "trim",   name: "Trim",    desc: "Auto-crop to tight transparent bounding box" },
  { id: "outline",name: "Outline", desc: "Pixel-perfect outline via alpha dilation" },
  { id: "pack",   name: "Pack",    desc: "Sprite sheet + atlas JSON" },
  { id: "save",   name: "Save",    desc: "Write project manifest" },
] as const;

type Step2DId = typeof STEP_2D[number]["id"];

interface TwoDPipelineProps {
  smeltingData: SmeltingOutput | null;
  onBack: () => void;
}

function TwoDPipeline({ smeltingData, onBack }: TwoDPipelineProps) {
  const [stepStatus,  setStepStatus]  = useState<Record<Step2DId, StepStatus>>(
    Object.fromEntries(STEP_2D.map(s => [s.id, "pending"])) as Record<Step2DId, StepStatus>
  );
  const [running,     setRunning]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [sheetUrl,    setSheetUrl]    = useState<string | null>(null);
  const [addOutline,  setAddOutline]  = useState(true);
  const [exportSize,  setExportSize]  = useState(256);
  const [sprites,     setSprites]     = useState<Record<string, string>>({});
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => () => { sseRef.current?.close(); }, []);

  const hasSpriteSmelt = smeltingData?.smeltMode === "SPRITE" && smeltingData?.smeltJobId;

  function markStep(id: Step2DId, status: StepStatus) {
    setStepStatus(prev => ({ ...prev, [id]: status }));
  }

  async function runPipeline() {
    if (!smeltingData?.smeltJobId) return;
    setRunning(true);
    setDone(false);
    setError(null);
    setSheetUrl(null);
    setSprites({});
    STEP_2D.forEach(s => markStep(s.id, "pending"));
    sseRef.current?.close();

    try {
      const res = await fetch(`${BACKEND}/api/forge2d`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smelt_job_id:  smeltingData.smeltJobId,
          directions:    smeltingData.poses ?? Object.keys(smeltingData.views),
          add_outline:   addOutline,
          outline_width: 2,
          outline_color: "black",
          export_size:   exportSize,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((d.detail as string) ?? `Server error ${res.status}`);
      }

      const { job_id } = await res.json();
      const sse = new EventSource(jobStreamUrl(job_id));
      sseRef.current = sse;

      sse.onmessage = (e) => {
        const ev = JSON.parse(e.data) as Record<string, unknown>;
        const type = ev.type as string;

        if (type === "step_active") {
          markStep(ev.step_id as Step2DId, "active");
        } else if (type === "step_done") {
          markStep(ev.step_id as Step2DId, "done");
        } else if (type === "sprite_ready") {
          const dir = ev.direction as string;
          const url = ev.image_url as string;
          setSprites(prev => ({ ...prev, [dir]: url }));
        } else if (type === "sheet_ready") {
          setSheetUrl(ev.sheet_url as string);
        } else if (type === "done") {
          setDone(true);
          setRunning(false);
          sse.close();
        } else if (type === "error") {
          setError((ev.message as string) ?? "Pipeline failed");
          setRunning(false);
          sse.close();
        }
      };

      sse.onerror = () => {
        setError("Lost connection to backend.");
        setRunning(false);
        sse.close();
      };
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setRunning(false);
    }
  }

  async function downloadSheet() {
    if (!sheetUrl) return;
    const blob = await fetch(sheetUrl).then(r => r.blob());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sprite_sheet.png";
    a.click();
  }

  const directions = smeltingData?.poses ?? (smeltingData?.views ? Object.keys(smeltingData.views) : []);

  return (
    <div className="mesh-pipeline">
      {/* ── Left panel ─────────────────────────────────────── */}
      <div className="mesh__panel">
        <div className="mesh__panel-header">
          <span className="mesh__panel-title">2D Sprite Pipeline</span>
          <button className="forge__back-btn" onClick={onBack}>← Back</button>
        </div>

        <div className="mesh__panel-scroll">
          {/* Options */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Export Size
            </label>
            <div style={{ display: "flex", gap: "var(--space-1)" }}>
              {[64, 128, 256, 512].map(sz => (
                <button
                  key={sz}
                  className={`mesh__format-btn${exportSize === sz ? " mesh__format-btn--active" : ""}`}
                  onClick={() => setExportSize(sz)}
                  disabled={running}
                >
                  {sz}px
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            <input
              type="checkbox"
              id="outline-toggle"
              checked={addOutline}
              onChange={e => setAddOutline(e.target.checked)}
              disabled={running}
              style={{ accentColor: "var(--yellow-bright)" }}
            />
            <label htmlFor="outline-toggle" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", cursor: "pointer" }}>
              Pixel outline (2px black)
            </label>
          </div>

          {/* Step tracker */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            {STEP_2D.map(s => (
              <div key={s.id} className={`mesh-step mesh-step--${stepStatus[s.id]}`}>
                <div className="mesh-step__circle">
                  {stepStatus[s.id] === "done"   ? "✓" :
                   stepStatus[s.id] === "error"  ? "!" :
                   stepStatus[s.id] === "active" ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> :
                   STEP_2D.indexOf(s) + 1}
                </div>
                <div className="mesh-step__body">
                  <div className="mesh-step__name">{s.name}</div>
                  <div className="mesh-step__desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {error && <div className="forge__error-box">{error}</div>}
        </div>

        <div className="mesh__panel-footer">
          {!hasSpriteSmelt && (
            <div className="smelt__no-prospect-hint" style={{ marginBottom: "var(--space-2)" }}>
              Run Smelt in 2D Sprite mode first
            </div>
          )}
          <button
            className="smelt__gen-all-btn"
            onClick={runPipeline}
            disabled={running || !hasSpriteSmelt}
          >
            {running
              ? <><span className="spinner" style={{ borderTopColor: "#000" }} /> Processing...</>
              : <>Run 2D Pipeline</>}
          </button>
          {done && sheetUrl && (
            <button className="smelt__lock-btn" onClick={downloadSheet}>
              Download Sheet
            </button>
          )}
        </div>
      </div>

      {/* ── Right viewport ─────────────────────────────────── */}
      <div className="mesh__viewport">
        <div className="mesh__viewport-toolbar">
          <span className="mesh__viewport-title">
            {done ? "Sprite Sheet" : "Direction Previews"}
          </span>
        </div>

        <div className="mesh__canvas">
          {sheetUrl ? (
            <img
              src={sheetUrl}
              alt="Sprite sheet"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", margin: "auto" }}
            />
          ) : Object.keys(sprites).length > 0 ? (
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "var(--space-3)",
              padding: "var(--space-4)",
              paddingTop: "var(--space-6)",
              height: "100%",
              boxSizing: "border-box",
              alignItems: "end",
            }}>
              {directions.map(dir => (
                <div key={dir} style={{
                  background: "var(--bg-raised)",
                  border: "1px solid var(--steel-edge)",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  minHeight: "min(80vh, 640px)",
                }}>
                  <div style={{ padding: "var(--space-1) var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {dir}
                  </div>
                  {sprites[dir] ? (
                    <img
                      src={sprites[dir]}
                      alt={dir}
                      style={{
                        width: "100%",
                        flex: 1,
                        minHeight: 0,
                        objectFit: "contain",
                        objectPosition: "center bottom",
                      }}
                    />
                  ) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.3 }}>
                      <span className="spinner" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="mesh__canvas-empty">
              <span className="mesh__canvas-empty-icon">🎮</span>
              <span className="mesh__canvas-empty-text">
                {hasSpriteSmelt ? "Run the pipeline to generate sprites" : "Complete Smelting in 2D Sprite mode first"}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

