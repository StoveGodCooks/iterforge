import { useState, useRef, useEffect } from "react";
import "../../styles/smelting.css";
import type { SmeltingOutput, ViewAngle, ProspectingOutput } from "../../types/pipeline";

const BACKEND = "http://127.0.0.1:7842";

type ViewStatus = "idle" | "generating" | "done" | "approved" | "rejected" | "error";

interface ViewState {
  status: ViewStatus;
  imageSrc: string | null;
  rgbaUrl: string | null;
  error: string | null;
}

interface Props {
  prospectingData: ProspectingOutput | null;
  onLock: (data: SmeltingOutput) => void;
}

/* ── View definitions (matches Zero123++ 3×2 grid output) ── */
const VIEWS: { angle: ViewAngle; label: string; icon: string; hint: string }[] = [
  { angle: "front",       label: "Front",       icon: "⬆",  hint: "0°"   },
  { angle: "front_right", label: "Front Right",  icon: "↗",  hint: "60°"  },
  { angle: "right",       label: "Right",        icon: "➡",  hint: "120°" },
  { angle: "back",        label: "Back",         icon: "⬇",  hint: "180°" },
  { angle: "left",        label: "Left",         icon: "⬅",  hint: "240°" },
  { angle: "front_left",  label: "Front Left",   icon: "↖",  hint: "300°" },
];

const EMPTY_VIEWS: Record<ViewAngle, ViewState> = Object.fromEntries(
  VIEWS.map(v => [v.angle, { status: "idle" as const, imageSrc: null, rgbaUrl: null, error: null }])
) as Record<ViewAngle, ViewState>;

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export default function Smelting({ prospectingData, onLock }: Props) {
  /* Carry forward the locked prospect data */
  const sourceImage  = prospectingData?.rgbaPath ?? prospectingData?.imagePath ?? null;
  const sourcePrompt = prospectingData?.prompt ?? "";

  /* Per-view state */
  const [views, setViews] = useState<Record<ViewAngle, ViewState>>(EMPTY_VIEWS);

  /* Single job ID for the batch (all 6 views come from one Zero123++ pass) */
  const [smeltJobId, setSmeltJobId] = useState<string | null>(null);

  /* Which view is in the detail lightbox */
  const [lightbox, setLightbox] = useState<ViewAngle | null>(null);

  /* Track active EventSource for cleanup on unmount */
  const sseRef = useRef<EventSource | null>(null);
  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  /* ── Update a single view ──────────────────────────────── */
  function setViewState(angle: ViewAngle, update: Partial<ViewState>) {
    setViews(prev => ({ ...prev, [angle]: { ...prev[angle], ...update } }));
  }

  /* ── Generate all 6 views (single Zero123++ pass) ──────── */
  async function generateAll() {
    if (!prospectingData?.prospectJobId) return;

    // Mark all views as generating
    setViews(
      Object.fromEntries(
        VIEWS.map(v => [v.angle, { status: "generating" as const, imageSrc: null, rgbaUrl: null, error: null }])
      ) as Record<ViewAngle, ViewState>
    );

    // Close any previous SSE
    sseRef.current?.close();

    try {
      const res = await fetch(`${BACKEND}/api/smelt/all-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospect_job_id: prospectingData.prospectJobId,
          image_index:     prospectingData.lockedImageIndex ?? 0,
          prompt:          sourcePrompt,
          asset_type:      prospectingData.assetType  ?? "prop",
          art_style:       prospectingData.artStyle   ?? "stylized",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = (errData.detail as string) ?? `Server error ${res.status}`;
        VIEWS.forEach(v => setViewState(v.angle, { status: "error", error: msg }));
        return;
      }

      const { job_id } = await res.json();
      setSmeltJobId(job_id);

      const sse = new EventSource(`${BACKEND}/api/jobs/${job_id}/stream`);
      sseRef.current = sse;

      sse.onmessage = (e) => {
        const event = JSON.parse(e.data) as Record<string, unknown>;
        const type  = event.type as string;

        if (type === "view_ready") {
          const angle = event.view_angle as ViewAngle;
          setViewState(angle, {
            status:   "done",
            imageSrc: event.image_url as string,
            rgbaUrl:  (event.rgba_url as string | null) ?? null,
            error:    null,
          });
        } else if (type === "done") {
          sse.close();
          sseRef.current = null;
        } else if (type === "error") {
          // Mark any still-generating views as error
          setViews(prev => {
            const next = { ...prev };
            for (const v of VIEWS) {
              if (next[v.angle].status === "generating") {
                next[v.angle] = { ...next[v.angle], status: "error", error: (event.message as string) ?? "Unknown error" };
              }
            }
            return next;
          });
          sse.close();
          sseRef.current = null;
        }
      };

      sse.onerror = () => {
        sse.close();
        sseRef.current = null;
        setViews(prev => {
          const next = { ...prev };
          for (const v of VIEWS) {
            if (next[v.angle].status === "generating") {
              next[v.angle] = { ...next[v.angle], status: "error", error: "Lost connection to backend." };
            }
          }
          return next;
        });
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      VIEWS.forEach(v => setViewState(v.angle, { status: "error", error: msg }));
    }
  }

  /* ── Approve / reject ──────────────────────────────────── */
  function approve(angle: ViewAngle) {
    setViewState(angle, { status: "approved" });
  }
  function reject(angle: ViewAngle) {
    setViewState(angle, { status: "rejected" });
  }

  /* ── Lock logic ────────────────────────────────────────── */
  const approvedCount = VIEWS.filter(v => views[v.angle].status === "approved").length;
  const allApproved   = approvedCount === VIEWS.length;
  const anyGenerating = VIEWS.some(v => views[v.angle].status === "generating");

  /* 2D-only asset types that shouldn't enter the 3D pipeline */
  const ASSET_2D_ONLY = ["concept", "environment", "tileset", "vfx", "ui"];
  const is2DOnly = ASSET_2D_ONLY.includes(prospectingData?.assetType ?? "");

  /* canGenerate: backend needs a real prospect job ID to resolve source paths */
  const canGenerate = !!prospectingData?.prospectJobId && !is2DOnly;

  function handleLock() {
    if (!allApproved) return;
    const viewPaths = Object.fromEntries(
      VIEWS.map(v => [v.angle, views[v.angle].imageSrc ?? ""])
    ) as Record<ViewAngle, string>;
    const masks = Object.fromEntries(
      VIEWS.map(v => [v.angle, views[v.angle].rgbaUrl ?? null])
    ) as Record<ViewAngle, string | null>;
    const emptyDepth = Object.fromEntries(
      VIEWS.map(v => [v.angle, null])
    ) as Record<ViewAngle, null>;
    onLock({
      views:        viewPaths,
      depthMaps:    emptyDepth,
      masks,
      smeltJobId,
      prompt:       sourcePrompt,
      prospectingData: prospectingData ?? null,
    });
  }

  return (
    <div className="smelting">

      {/* ── LEFT PANEL ───────────────────────────────────────── */}
      <aside className="smelt__panel">
        <div className="smelt__panel-scroll">

          {/* Source image (locked prospect) */}
          <div className="smelt__source">
            <div className="smelt__source-header">
              <span className="smelt__source-title">Locked Prospect</span>
              <span className="badge badge--yellow">LOCKED</span>
            </div>
            {sourceImage ? (
              <img className="smelt__source-img" src={sourceImage} alt="Locked prospect" />
            ) : (
              <div className="smelt__source-placeholder">
                <span style={{ fontSize: 28, opacity: 0.3 }}>&#128444;</span>
                <span>No prospect locked yet</span>
              </div>
            )}
          </div>

          {/* 2D-only asset type warning */}
          {is2DOnly && (
            <div style={{
              background: "rgba(255,200,0,0.08)",
              border: "1px solid rgba(255,200,0,0.25)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-3)",
              marginBottom: "var(--space-3)",
              color: "var(--yellow-bright)",
              fontSize: "var(--text-xs)",
              lineHeight: 1.5,
            }}>
              ⚠ <strong>{(prospectingData?.assetType ?? "").replace("_", " ").toUpperCase()}</strong> is
              a 2D asset type. Multi-view generation and 3D mesh reconstruction require a 3D asset
              type (Weapon, Character, Prop, etc.). Go back to Prospecting and select a 3D type.
            </div>
          )}

          {/* Progress indicator */}
          <div className="smelt__progress-row">
            <span className="smelt__progress-label">Views approved</span>
            <span className="smelt__progress-count">{approvedCount} / {VIEWS.length}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${(approvedCount / VIEWS.length) * 100}%` }} />
          </div>

        </div>

        {/* Panel footer */}
        <div className="smelt__panel-footer">
          {!canGenerate && (
            <div className="smelt__no-prospect-hint">
              Lock a Prospect first
            </div>
          )}
          <button
            className="smelt__gen-all-btn"
            onClick={generateAll}
            disabled={anyGenerating || !canGenerate}
            title={!canGenerate ? "Lock a Prospect image before generating views" : undefined}
          >
            {anyGenerating
              ? <><span className="spinner" style={{ borderTopColor: "#000" }} /> Generating 6 Views...</>
              : <>Generate All Views</>}
          </button>
          <button
            className="smelt__lock-btn"
            onClick={handleLock}
            disabled={!allApproved}
          >
            Lock In Smelt
          </button>
        </div>
      </aside>

      {/* ── RIGHT: 3×2 VIEW GRID ─────────────────────────────── */}
      <div className="smelt__grid">
        {VIEWS.map(({ angle, label, icon, hint }) => (
          <ViewPanel
            key={angle}
            angle={angle}
            label={label}
            icon={icon}
            hint={hint}
            state={views[angle]}
            onApprove={() => approve(angle)}
            onReject={() => reject(angle)}
            onExpand={() => setLightbox(angle)}
          />
        ))}
      </div>

      {/* ── Lightbox overlay ─────────────────────────────────── */}
      {lightbox && views[lightbox].imageSrc && (
        <div className="smelt__lightbox" onClick={() => setLightbox(null)}>
          <div className="smelt__lightbox-inner" onClick={e => e.stopPropagation()}>
            <div className="smelt__lightbox-header">
              <span className="smelt__lightbox-title">
                {VIEWS.find(v => v.angle === lightbox)?.icon}{" "}
                {VIEWS.find(v => v.angle === lightbox)?.label} View
              </span>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button className="view-btn view-btn--approve"
                  onClick={() => { approve(lightbox); setLightbox(null); }}>
                  Approve
                </button>
                <button className="win-btn win-btn--close" onClick={() => setLightbox(null)}>X</button>
              </div>
            </div>
            <img src={views[lightbox].imageSrc!} alt={`${lightbox} view`}
              className="smelt__lightbox-img" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Single view panel ──────────────────────────────────────── */
interface ViewPanelProps {
  angle: ViewAngle;
  label: string;
  icon: string;
  hint: string;
  state: ViewState;
  onApprove: () => void;
  onReject: () => void;
  onExpand: () => void;
}

function ViewPanel({ label, icon, hint, state, onApprove, onReject, onExpand }: ViewPanelProps) {
  const cls = [
    "view-panel",
    state.status === "approved"   ? "view-panel--approved"   : "",
    state.status === "rejected"   ? "view-panel--rejected"   : "",
    state.status === "generating" ? "view-panel--generating" : "",
    state.status === "error"      ? "view-panel--error"      : "",
  ].filter(Boolean).join(" ");

  const hasImage = !!state.imageSrc;
  const canAct   = hasImage && state.status !== "generating";

  return (
    <div className={cls}>
      {/* Header */}
      <div className="view-header">
        <div className="view-header__left">
          <span className="view-angle-icon">{icon}</span>
          <span className="view-label">{label}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginLeft: 2 }}>
            {hint}
          </span>
        </div>
        <span className={`view-status view-status--${state.status}`}>
          {state.status === "idle"       && "\u2014"}
          {state.status === "generating" && <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Generating</>}
          {state.status === "done"       && "Ready"}
          {state.status === "approved"   && "Approved"}
          {state.status === "rejected"   && "Rejected"}
          {state.status === "error"      && "Failed"}
        </span>
      </div>

      {/* Image area */}
      <div className="view-img-area" onClick={hasImage ? onExpand : undefined}>
        {state.imageSrc ? (
          <img src={state.imageSrc} alt={`${label} view`} />
        ) : state.status === "error" ? (
          <div className="view-error-body">
            <span className="view-error-body__icon">!</span>
            <span className="view-error-body__msg">{state.error}</span>
          </div>
        ) : (
          <div className="view-empty">
            <span className="view-empty__icon">{icon}</span>
            <span className="view-empty__text">{label} view not generated</span>
          </div>
        )}
        {state.status === "generating" && (
          <div className="view-generating-overlay">
            <span className="spinner spinner--lg" />
            <span>Generating {label} view...</span>
          </div>
        )}
        {hasImage && state.status !== "generating" && (
          <div className="view-expand-hint">Expand</div>
        )}
      </div>

      {/* Footer actions — no per-view generate (regen = regenerate all 6) */}
      <div className="view-footer">
        {!hasImage && state.status !== "generating" && state.status !== "error" ? (
          <span style={{ flex: 1, textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Use "Generate All Views" to start
          </span>
        ) : state.status === "error" ? (
          <span style={{ flex: 1, textAlign: "center", fontSize: "var(--text-xs)", color: "var(--status-error)" }}>
            {state.error}
          </span>
        ) : (
          <>
            <button
              className={`view-btn view-btn--approve ${state.status === "approved" ? "active" : ""}`}
              onClick={onApprove}
              disabled={!canAct || state.status === "approved"}>
              Approve
            </button>
            <button className="view-btn view-btn--reject"
              onClick={onReject} disabled={!canAct}>
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
