import { useState, useRef, useEffect } from "react";
import "../../styles/smelting.css";
import { ENABLE_3D } from "../../featureFlags";
import type {
  SmeltingOutput, SmeltMode, ViewAngle, ProspectingOutput,
  PosePreset, PoseLibraryResponse,
} from "../../types/pipeline";

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

/* ── 3D views (Zero123++ 3×2 grid) ─────────────────────────── */
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

  /* 3D / SPRITE mode toggle — defaults to SPRITE (2D sprite sheet) */
  const [smeltMode, setSmeltMode] = useState<SmeltMode>("SPRITE");

  /* SPRITE (one-shot tiled) is prompt-driven — NO prospect required. Prefill
     the prompt from a locked prospect if the user came from Prospecting,
     otherwise start blank and let them type a character description here. */
  const [prompt, setPrompt]       = useState<string>(sourcePrompt);
  const [assetType, setAssetType] = useState<string>(prospectingData?.assetType ?? "character");

  /* 3D multi-view set; SPRITE uses posePresets + selectedPoses instead */
  const activeViews = VIEWS;

  /* Per-view state (keyed by ViewAngle for 2D/3D modes) */
  const [views, setViews] = useState<Record<ViewAngle, ViewState>>(EMPTY_VIEWS);

  /* Sprite-sheet state — pose presets come from /api/poses */
  const [posePresets, setPosePresets]       = useState<PosePreset[]>([]);
  const [selectedPoses, setSelectedPoses]   = useState<string[]>([]);
  const [poseViews, setPoseViews]           = useState<Record<string, ViewState>>({});

  /* Fetch pose library once */
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND}/api/poses`)
      .then(r => r.ok ? r.json() as Promise<PoseLibraryResponse> : Promise.reject(r.status))
      .then(data => {
        if (cancelled) return;
        setPosePresets(data.presets);
        setSelectedPoses(data.default_sheet);
      })
      .catch(() => {/* backend might not be up yet — UI still renders */});
    return () => { cancelled = true; };
  }, []);

  /* Single job ID for the batch */
  const [smeltJobId, setSmeltJobId] = useState<string | null>(null);

  /* Live progress line from heartbeat PROGRESS events (so a long one-shot
     generation shows elapsed time instead of a frozen-looking spinner). */
  const [genProgress, setGenProgress] = useState<string | null>(null);

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

  function setPoseViewState(name: string, update: Partial<ViewState>) {
    setPoseViews(prev => ({
      ...prev,
      [name]: { ...(prev[name] ?? { status: "idle", imageSrc: null, rgbaUrl: null, error: null }), ...update },
    }));
  }

  function togglePose(name: string) {
    setSelectedPoses(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }

  /* ── Generate views / directions / sprite poses ────────── */
  async function generateAll() {
    const isSprite = smeltMode === "SPRITE";
    if (isSprite) {
      // Tiled sprite sheet: needs a prompt + at least one pose, no prospect.
      if (!prompt.trim() || selectedPoses.length === 0) return;
    } else {
      // 3D multi-view still needs a locked prospect reference.
      if (!prospectingData?.prospectJobId) return;
    }

    // Mark active slots as generating
    if (isSprite) {
      setPoseViews(() => {
        const next: Record<string, ViewState> = {};
        for (const name of selectedPoses) {
          next[name] = { status: "generating", imageSrc: null, rgbaUrl: null, error: null };
        }
        return next;
      });
    } else {
      setViews(prev => {
        const next = { ...prev };
        for (const v of activeViews) {
          next[v.angle] = { status: "generating", imageSrc: null, rgbaUrl: null, error: null };
        }
        return next;
      });
    }

    setGenProgress("Starting…");

    // Close any previous SSE
    sseRef.current?.close();

    try {
      const body: Record<string, unknown> = {
        prompt:          isSprite ? prompt : sourcePrompt,
        asset_type:      isSprite ? assetType : (prospectingData?.assetType ?? "prop"),
        art_style:       prospectingData?.artStyle ?? "stylized",
        mode:            smeltMode,
        gen_resolution:  512,
      };
      if (isSprite) {
        // Prompt-driven tiled sheet — no prospect reference.
        body.poses = selectedPoses;
      } else {
        body.prospect_job_id = prospectingData!.prospectJobId;
        body.image_index     = prospectingData?.lockedImageIndex ?? 0;
      }

      const res = await fetch(`${BACKEND}/api/smelt/all-views`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = (errData.detail as string) ?? `Server error ${res.status}`;
        if (isSprite) {
          selectedPoses.forEach(n => setPoseViewState(n, { status: "error", error: msg }));
        } else {
          VIEWS.forEach(v => setViewState(v.angle, { status: "error", error: msg }));
        }
        return;
      }

      const { job_id } = await res.json();
      setSmeltJobId(job_id);

      const sse = new EventSource(`${BACKEND}/api/jobs/${job_id}/stream`);
      sseRef.current = sse;

      sse.onmessage = (e) => {
        const event = JSON.parse(e.data) as Record<string, unknown>;
        const type  = event.type as string;

        if (type === "progress") {
          if (typeof event.message === "string") setGenProgress(event.message);
        } else if (type === "view_ready") {
          const key = event.view_angle as string;
          const update: Partial<ViewState> = {
            status:   "done",
            imageSrc: event.image_url as string,
            rgbaUrl:  (event.rgba_url as string | null) ?? null,
            error:    null,
          };
          if (isSprite) {
            setPoseViewState(key, update);
          } else {
            setViewState(key as ViewAngle, update);
          }
        } else if (type === "done") {
          setGenProgress(null);
          sse.close();
          sseRef.current = null;
        } else if (type === "error") {
          const msg = (event.message as string) ?? "Unknown error";
          if (isSprite) {
            setPoseViews(prev => {
              const next = { ...prev };
              for (const n of selectedPoses) {
                if (next[n]?.status === "generating") {
                  next[n] = { ...next[n], status: "error", error: msg };
                }
              }
              return next;
            });
          } else {
            setViews(prev => {
              const next = { ...prev };
              for (const v of VIEWS) {
                if (next[v.angle].status === "generating") {
                  next[v.angle] = { ...next[v.angle], status: "error", error: msg };
                }
              }
              return next;
            });
          }
          sse.close();
          sseRef.current = null;
        }
      };

      sse.onerror = () => {
        sse.close();
        sseRef.current = null;
        const msg = "Lost connection to backend.";
        if (isSprite) {
          setPoseViews(prev => {
            const next = { ...prev };
            for (const n of selectedPoses) {
              if (next[n]?.status === "generating") {
                next[n] = { ...next[n], status: "error", error: msg };
              }
            }
            return next;
          });
        } else {
          setViews(prev => {
            const next = { ...prev };
            for (const v of activeViews) {
              if (next[v.angle].status === "generating") {
                next[v.angle] = { ...next[v.angle], status: "error", error: msg };
              }
            }
            return next;
          });
        }
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      if (isSprite) {
        selectedPoses.forEach(n => setPoseViewState(n, { status: "error", error: msg }));
      } else {
        activeViews.forEach(v => setViewState(v.angle, { status: "error", error: msg }));
      }
    }
  }

  /* ── Approve / reject ──────────────────────────────────── */
  function approve(angle: ViewAngle) {
    setViewState(angle, { status: "approved" });
  }
  function reject(angle: ViewAngle) {
    setViewState(angle, { status: "rejected" });
  }
  function approvePose(name: string) { setPoseViewState(name, { status: "approved" }); }
  function rejectPose(name: string)  { setPoseViewState(name, { status: "rejected" }); }

  /* ── Lock logic ────────────────────────────────────────── */
  const isSprite      = smeltMode === "SPRITE";
  const spriteSlots   = selectedPoses;
  const spriteApproved = spriteSlots.filter(n => poseViews[n]?.status === "approved").length;
  const spriteGenerating = spriteSlots.some(n => poseViews[n]?.status === "generating");

  const approvedCount = isSprite
    ? spriteApproved
    : activeViews.filter(v => views[v.angle].status === "approved").length;
  const totalCount = isSprite ? spriteSlots.length : activeViews.length;
  const allApproved = totalCount > 0 && approvedCount === totalCount;
  const anyGenerating = isSprite
    ? spriteGenerating
    : activeViews.some(v => views[v.angle].status === "generating");

  const canGenerate = isSprite
    ? (prompt.trim().length > 0 && selectedPoses.length > 0)
    : !!prospectingData?.prospectJobId;

  function handleLock() {
    if (!allApproved) return;
    // Sprite mode doesn't feed the 3D Forge; emit empty view maps but carry
    // the pose names so the 2D Forge can pull each frame's folder by pose.
    const slots = isSprite
      ? [] as { angle: ViewAngle }[]
      : activeViews;
    const viewPaths = Object.fromEntries(
      slots.map(v => [v.angle, views[v.angle].imageSrc ?? ""])
    ) as Record<ViewAngle, string>;
    const masks = Object.fromEntries(
      slots.map(v => [v.angle, views[v.angle].rgbaUrl ?? null])
    ) as Record<ViewAngle, string | null>;
    const emptyDepth = Object.fromEntries(
      slots.map(v => [v.angle, null])
    ) as Record<ViewAngle, null>;
    onLock({
      views:        viewPaths,
      depthMaps:    emptyDepth,
      masks,
      smeltJobId,
      smeltMode,
      poses:        isSprite ? selectedPoses : undefined,
      prompt:       isSprite ? prompt : sourcePrompt,
      prospectingData: prospectingData ?? null,
    });
  }

  return (
    <div className="smelting">

      {/* ── LEFT PANEL ───────────────────────────────────────── */}
      <aside className="smelt__panel">
        <div className="smelt__panel-scroll">

          {/* ── Mode toggle ────────────────────────────────── */}
          {ENABLE_3D && (
            <div className="smelt__mode-toggle">
              <button
                className={`smelt__mode-btn${smeltMode === "SPRITE" ? " active" : ""}`}
                onClick={() => { setSmeltMode("SPRITE"); setPoseViews({}); }}
              >
                2D Sprite Sheet
              </button>
              <button
                className={`smelt__mode-btn${smeltMode === "3D" ? " active" : ""}`}
                onClick={() => { setSmeltMode("3D"); setViews(EMPTY_VIEWS); }}
              >
                3D Multi-View
              </button>
            </div>
          )}

          {/* ── Character prompt (SPRITE / tiled — prompt-driven) ── */}
          {isSprite && (
            <div className="smelt__prompt-box">
              <label className="smelt__prompt-label" htmlFor="smelt-prompt">
                Describe your character
              </label>
              <textarea
                id="smelt-prompt"
                className="smelt__prompt-input"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="e.g. orc warrior with axe, fantasy game character"
                rows={3}
                disabled={anyGenerating}
              />
              <div className="smelt__asset-row">
                <span className="smelt__asset-label">Type</span>
                <select
                  className="smelt__asset-select"
                  value={assetType}
                  onChange={e => setAssetType(e.target.value)}
                  disabled={anyGenerating}
                >
                  <option value="character">Character</option>
                  <option value="creature">Creature</option>
                  <option value="prop">Prop / Object</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Pose picker (SPRITE mode only) ─────────────── */}
          {smeltMode === "SPRITE" && (
            <div className="smelt__pose-picker">
              <div className="smelt__pose-picker-header">
                <span className="smelt__pose-picker-title">Poses</span>
                <span className="smelt__pose-picker-count">
                  {selectedPoses.length} / {posePresets.length}
                </span>
              </div>
              <div className="smelt__pose-chips">
                {posePresets.length === 0 ? (
                  <span className="smelt__pose-loading">Loading pose library…</span>
                ) : (
                  posePresets.map(p => {
                    const on = selectedPoses.includes(p.name);
                    return (
                      <button
                        key={p.name}
                        className={`smelt__pose-chip${on ? " active" : ""}`}
                        onClick={() => togglePose(p.name)}
                        title={p.prompt_hint}
                        disabled={anyGenerating}
                      >
                        <img
                          className="smelt__pose-chip-thumb"
                          src={`${BACKEND}/api/poses/${p.name}/preview.png?size=128`}
                          alt=""
                        />
                        <span className="smelt__pose-chip-label">{p.label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Source image (locked prospect — 3D multi-view mode only) */}
          {!isSprite && (
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
          )}

          {/* Progress indicator */}
          <div className="smelt__progress-row">
            <span className="smelt__progress-label">
              {smeltMode === "SPRITE" ? "Poses approved" : "Views approved"}
            </span>
            <span className="smelt__progress-count">{approvedCount} / {totalCount || 1}</span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${totalCount > 0 ? (approvedCount / totalCount) * 100 : 0}%` }}
            />
          </div>

        </div>

        {/* Panel footer */}
        <div className="smelt__panel-footer">
          {!canGenerate && (
            <div className="smelt__no-prospect-hint">
              {isSprite ? "Enter a prompt and pick at least one pose" : "Lock a Prospect first"}
            </div>
          )}
          {anyGenerating && genProgress && (
            <div className="smelt__gen-progress">{genProgress}</div>
          )}
          <button
            className="smelt__gen-all-btn"
            onClick={generateAll}
            disabled={anyGenerating || !canGenerate}
            title={!canGenerate ? "Lock a Prospect image first" : undefined}
          >
            {anyGenerating
              ? <><span className="spinner" style={{ borderTopColor: "#000" }} /> Generating...</>
              : smeltMode === "SPRITE"
                ? <>Generate Sprite Sheet</>
                : <>Generate All Views</>}
          </button>
          <button
            className="smelt__lock-btn"
            onClick={handleLock}
            disabled={!allApproved}
          >
            {smeltMode === "SPRITE" ? "Send Sprite Sheet" : "Lock for 3D Forge"}
          </button>
        </div>
      </aside>

      {/* ── RIGHT: VIEW GRID (3×2 in 3D, 2×2 in 2D, flex in SPRITE) ──── */}
      {smeltMode === "SPRITE" ? (
        <div className="smelt__grid smelt__grid--sprite">
          {selectedPoses.length === 0 ? (
            <div className="smelt__sprite-empty">
              Pick at least one pose from the library on the left to start.
            </div>
          ) : (
            selectedPoses.map(name => {
              const preset = posePresets.find(p => p.name === name);
              const vs = poseViews[name] ?? { status: "idle" as ViewStatus, imageSrc: null, rgbaUrl: null, error: null };
              const iconMap: Record<string, string> = { front: "⬆", back: "⬇", side: "➡" };
              return (
                <ViewPanel
                  key={name}
                  angle={name as ViewAngle}
                  label={preset?.label ?? name}
                  icon={iconMap[preset?.direction ?? "front"] ?? "●"}
                  hint={preset?.direction ?? ""}
                  state={vs}
                  onApprove={() => approvePose(name)}
                  onReject={() => rejectPose(name)}
                  onExpand={() => setLightbox(name as ViewAngle)}
                />
              );
            })
          )}
        </div>
      ) : (
        <div className="smelt__grid">
          {activeViews.map(({ angle, label, icon, hint }) => (
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
      )}

      {/* ── Lightbox overlay ─────────────────────────────────── */}
      {lightbox && (() => {
        const spriteVs = isSprite ? poseViews[lightbox as string] : null;
        const viewVs   = !isSprite ? views[lightbox] : null;
        const vs = spriteVs ?? viewVs;
        if (!vs?.imageSrc) return null;
        const preset = isSprite ? posePresets.find(p => p.name === lightbox) : null;
        const labelText = preset?.label ?? VIEWS.find(v => v.angle === lightbox)?.label ?? lightbox;
        const iconText  = VIEWS.find(v => v.angle === lightbox)?.icon ?? "●";
        const onApproveFromLightbox = () => {
          if (isSprite) approvePose(lightbox as string);
          else          approve(lightbox);
          setLightbox(null);
        };
        return (
          <div className="smelt__lightbox" onClick={() => setLightbox(null)}>
            <div className="smelt__lightbox-inner" onClick={e => e.stopPropagation()}>
              <div className="smelt__lightbox-header">
                <span className="smelt__lightbox-title">
                  {iconText} {labelText}
                </span>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <button className="view-btn view-btn--approve" onClick={onApproveFromLightbox}>
                    Approve
                  </button>
                  <button className="win-btn win-btn--close" onClick={() => setLightbox(null)}>X</button>
                </div>
              </div>
              <img src={vs.imageSrc} alt={`${lightbox}`} className="smelt__lightbox-img" />
            </div>
          </div>
        );
      })()}
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
