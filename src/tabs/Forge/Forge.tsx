import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-shell";
import "../../styles/forge.css";
import type { ProspectingOutput, SmeltingOutput, ExportFormat } from "../../types/pipeline";

const MeshViewer = lazy(() => import("../../components/MeshViewer/MeshViewer"));

const BACKEND = "http://127.0.0.1:7842";

/* ── Local types ─────────────────────────────────────────── */
type Pipeline  = "mesh" | "sprite" | null;
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
  tinkerMode:      boolean;
}

/* ── Mesh pipeline steps — IDs must match forge_worker.py ───
   Order: reconstruct → decimate → repair → lod → export → save
   UV unwrap + texture bake are pinned for v2.
   ─────────────────────────────────────────────────────────── */
const INITIAL_STEPS: MeshStep[] = [
  {
    id: "build",
    name: "Build Geometry",
    desc: "Construct base mesh from multi-view depth data",
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
export default function Forge({ smeltingData, prospectingData, tinkerMode }: Props) {
  const [pipeline, setPipeline] = useState<Pipeline>(null);

  return (
    <div className="forge">
      {pipeline === null && (
        <PipelinePicker onChoose={setPipeline} />
      )}
      {pipeline === "mesh" && (
        <MeshPipeline
          smeltingData={smeltingData}
          prospectingData={prospectingData}
          tinkerMode={tinkerMode}
          onBack={() => setPipeline(null)}
        />
      )}
      {pipeline === "sprite" && (
        <SpritePipeline
          smeltingData={smeltingData}
          prospectingData={prospectingData}
          tinkerMode={tinkerMode}
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

        {/* ── Mesh card ──────────────────────────────────── */}
        <div className="pipeline-card pipeline-card--mesh" onClick={() => onChoose("mesh")}>
          <span className="pipeline-card__icon">🗿</span>
          <span className="pipeline-card__name">3D Mesh</span>
          <p className="pipeline-card__desc">
            Convert your smelted multi-view images into a game-ready 3D model
            with UVs, textures, and LODs.
          </p>
          <div className="pipeline-card__steps">
            {["Build Geometry", "Decimation", "Refine",
              "LOD Generation", "Export GLB / FBX", "UV + Texture (v2)"].map(s => (
              <span key={s} className="pipeline-card__step">
                <span className="pipeline-card__step-dot" />
                {s}
              </span>
            ))}
          </div>
          <button className="pipeline-card__cta">Enter Mesh Pipeline →</button>
        </div>

        {/* ── Sprite card ────────────────────────────────── */}
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

      </div>
    </div>
  );
}

/* ============================================================
   MESH PIPELINE
   ============================================================ */
interface MeshPipelineProps {
  smeltingData: SmeltingOutput | null;
  prospectingData: ProspectingOutput | null;
  tinkerMode:   boolean;
  onBack: () => void;
}

function MeshPipeline({ smeltingData, prospectingData, tinkerMode, onBack }: MeshPipelineProps) {
  const [steps,       setSteps]       = useState<MeshStep[]>(INITIAL_STEPS);
  const [running,     setRunning]     = useState(false);
  const [done,        setDone]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("GLB");
  const [meshUrl,     setMeshUrl]     = useState<string | null>(null);
  const [exportDir,   setExportDir]   = useState<string | null>(null);
  const [genStatus,   setGenStatus]   = useState("");
  const [jobId,       setJobId]       = useState<string | null>(null);
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

  /* canRun: need smelt jobs, or a locked prospect while Tinker Mode is on */
  const smeltJobId = smeltingData?.smeltJobId ?? null;
  const hasSmeltJobs = !!smeltJobId;
  const canBypassWithProspect = tinkerMode && !!prospectJobId;
  const hasJobs = (hasSmeltJobs || canBypassWithProspect) && !is2DOnly;

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
          smelt_job_id:        smeltJobId,
          prospect_job_id:     prospectJobId,
          image_index:         lockedImageIndex,
          tinker_mode:         tinkerMode,
          reconstruction_path: smeltingData?.prospectingData?.reconstructionPath ?? "auto",
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
      const sse = new EventSource(`${BACKEND}/api/jobs/${job_id}/stream`);
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
          if (event.mesh_url) setMeshUrl(event.mesh_url as string);
          setExportDir((event.out_dir as string | null) ?? null);
          setGenStatus("Pipeline complete");
          setDone(true);
          setRunning(false);
          sse.close();
          sseRef.current = null;
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
          <span className="mesh__panel-title">🗿 Mesh Pipeline</span>
          <button className="forge__back-btn" onClick={onBack}>← Back</button>
        </div>

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

          {/* 2D asset type warning */}
          {is2DOnly && !running && (
            <div className="forge__error-box" style={{ background: "rgba(255,200,0,0.08)", borderColor: "rgba(255,200,0,0.2)", color: "var(--yellow-bright)" }}>
              ⚠ <strong>{(prospectingData?.assetType ?? "").replace("_", " ").toUpperCase()}</strong> is a 2D asset type.
              The mesh pipeline requires a 3D type (Weapon, Character, Prop, etc.).
            </div>
          )}

          {/* No smelt jobs warning — hidden in Tinker Mode */}
          {!hasJobs && !is2DOnly && !running && (
            <div className="forge__error-box" style={{ background: "rgba(255,200,0,0.08)", borderColor: "rgba(255,200,0,0.2)", color: "var(--yellow-bright)" }}>
              ⚠ {tinkerMode
                ? "Lock a Prospecting image first, or complete Smelting, to run the mesh pipeline"
                : "Complete Smelting first to run the mesh pipeline"}
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
              ✦ Run Mesh Pipeline
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
          {!running && !done && !error && (
            <div className="mesh__canvas-empty">
              <span className="mesh__canvas-empty-icon">🗿</span>
              <span className="mesh__canvas-empty-text">
                Run the pipeline to generate your 3D mesh
              </span>
              {/* Show locked prospect preview if available */}
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
        </div>

        {/* Export footer */}
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
          </div>
        </div>
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
   SPRITE PIPELINE
   ============================================================ */
interface SpritePipelineProps {
  smeltingData: SmeltingOutput | null;
  prospectingData: ProspectingOutput | null;
  tinkerMode: boolean;
  onBack: () => void;
}

function SpritePipeline({ smeltingData, prospectingData, tinkerMode, onBack }: SpritePipelineProps) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sourceImage = smeltingData?.views?.front ?? (tinkerMode ? prospectingData?.imagePath ?? null : null);
  const canExport = !!sourceImage;

  async function handleExportSprite() {
    if (!sourceImage) return;

    setSaving(true);
    setError(null);

    try {
      const targetPath = await save({
        title: "Export Sprite",
        defaultPath: "sprite.png",
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!targetPath) return;

      const response = await fetch(sourceImage);
      if (!response.ok) {
        throw new Error(`Sprite export failed (${response.status})`);
      }

      await writeFile(targetPath, new Uint8Array(await response.arrayBuffer()));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export sprite.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", gap: "var(--space-5)",
      animation: "fade-in var(--transition-normal) forwards"
    }}>
      <button className="forge__back-btn" style={{ alignSelf: "flex-start", margin: "var(--space-4)" }}
        onClick={onBack}>← Back</button>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-4)" }}>
        <span style={{ fontSize: 64 }}>🎞</span>
        <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--text-primary)" }}>
          Sprite Export
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          Export a PNG sprite directly from the current source image. In Tinker Mode,
          a locked Prospecting image can skip Smelting and export from Forge immediately.
        </p>
        {sourceImage && (
          <img
            src={sourceImage}
            alt="Sprite source preview"
            style={{ width: 220, height: 220, objectFit: "contain", borderRadius: "var(--radius-sm)", border: "1px solid var(--bg-border)", background: "var(--bg-overlay)" }}
          />
        )}
        {error && (
          <div className="forge__error-box">
            ⚠ {error}
          </div>
        )}
        {!canExport && (
          <div className="forge__error-box" style={{ background: "rgba(255,200,0,0.08)", borderColor: "rgba(255,200,0,0.2)", color: "var(--yellow-bright)", maxWidth: 420 }}>
            ⚠ {tinkerMode
              ? "Lock a Prospecting image first, or complete Smelting, to export a sprite"
              : "Complete Smelting first to export a sprite"}
          </div>
        )}
        <button
          className="btn btn--primary"
          style={{ minWidth: 220, height: 42 }}
          onClick={handleExportSprite}
          disabled={!canExport || saving}
        >
          {saving ? "Exporting..." : "Export PNG Sprite"}
        </button>
      </div>
    </div>
  );
}

