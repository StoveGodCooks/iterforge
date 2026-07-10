/**
 * Pose page (internally "Smelting") — generate sprite-sheet frames of a locked
 * Prospect character in selectable poses. Identity mode when a Prospect is
 * locked (IP-Adapter carries the character), else prompt-only tiled generation.
 * Approved frames feed the Forge "2D Sprite" packer via onLock.
 */
import { useState, useRef, useEffect } from "react";
import "../../styles/smelting.css";
import { useAssetTray } from "../../contexts/AssetTrayContext";
import type {
  SmeltingOutput, ProspectingOutput, PosePreset, PoseLibraryResponse, ViewAngle,
} from "../../types/pipeline";

const BACKEND = "http://127.0.0.1:7842";

type ViewStatus = "idle" | "generating" | "done" | "approved" | "rejected" | "error";

interface ViewState {
  status: ViewStatus;
  imageSrc: string | null;
  rgbaUrl: string | null;
  error: string | null;
}

const IDLE: ViewState = { status: "idle", imageSrc: null, rgbaUrl: null, error: null };

interface Props {
  prospectingData: ProspectingOutput | null;
  onLock: (data: SmeltingOutput) => void;
}

/* Pose directions, grouped for the picker. */
const DIRECTION_ORDER = ["front", "side", "back"] as const;
const DIRECTION_LABEL: Record<string, string> = { front: "Front", side: "Side", back: "Back" };
const DIRECTION_ICON: Record<string, string> = { front: "⬆", side: "➡", back: "⬇" };

export default function Smelting({ prospectingData, onLock }: Props) {
  const { addItem: addToTray } = useAssetTray();

  const hasProspect  = !!prospectingData?.prospectJobId;
  const sourceImage  = prospectingData?.rgbaPath ?? prospectingData?.imagePath ?? null;
  const sourcePrompt = prospectingData?.prompt ?? "";

  const [prompt, setPrompt]       = useState<string>(sourcePrompt);
  const [assetType, setAssetType] = useState<string>(prospectingData?.assetType ?? "character");
  const [ipScale, setIpScale]     = useState<number>(0.6);

  const [posePresets, setPosePresets]     = useState<PosePreset[]>([]);
  const [selectedPoses, setSelectedPoses] = useState<string[]>([]);
  const [poseViews, setPoseViews]         = useState<Record<string, ViewState>>({});

  const [smeltJobId, setSmeltJobId]   = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState<string | null>(null);
  const [lightbox, setLightbox]       = useState<string | null>(null);

  const sseRef = useRef<EventSource | null>(null);
  useEffect(() => () => { sseRef.current?.close(); }, []);

  /* Fetch the pose library once. */
  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND}/api/poses`)
      .then(r => r.ok ? r.json() as Promise<PoseLibraryResponse> : Promise.reject(r.status))
      .then(data => {
        if (cancelled) return;
        setPosePresets(data.presets);
        setSelectedPoses(data.default_sheet);
      })
      .catch(() => {/* backend may not be up yet — UI still renders */});
    return () => { cancelled = true; };
  }, []);

  function setPoseViewState(name: string, update: Partial<ViewState>) {
    setPoseViews(prev => ({ ...prev, [name]: { ...(prev[name] ?? IDLE), ...update } }));
  }
  function togglePose(name: string) {
    setSelectedPoses(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  }
  function approvePose(name: string) { setPoseViewState(name, { status: "approved" }); }
  function rejectPose(name: string)  { setPoseViewState(name, { status: "rejected" }); }

  /* ── Gating ──────────────────────────────────────────────── */
  const anyGenerating = selectedPoses.some(n => poseViews[n]?.status === "generating");
  const approvedCount = selectedPoses.filter(n => poseViews[n]?.status === "approved").length;
  const totalCount    = selectedPoses.length;
  const allApproved   = totalCount > 0 && approvedCount === totalCount;
  const canGenerate   = prompt.trim().length > 0 && selectedPoses.length > 0;

  /* ── Generate all selected poses ─────────────────────────── */
  async function generateAll() {
    if (!canGenerate || anyGenerating) return;

    setPoseViews(() => {
      const next: Record<string, ViewState> = {};
      for (const name of selectedPoses) next[name] = { ...IDLE, status: "generating" };
      return next;
    });
    setGenProgress("Starting…");
    sseRef.current?.close();

    try {
      const body: Record<string, unknown> = {
        prompt,
        asset_type: assetType,
        art_style:  prospectingData?.artStyle ?? "stylized",
        poses:      selectedPoses,
        gen_resolution: 512,
      };
      if (hasProspect) {
        // Identity mode — pose the locked character.
        body.prospect_job_id = prospectingData!.prospectJobId;
        body.image_index     = prospectingData?.lockedImageIndex ?? 0;
        body.ip_scale        = ipScale;
      }
      // Reuse the Prospect's LoRAs so frames match the concept's style.
      if (prospectingData?.loras && prospectingData.loras.length > 0) {
        body.loras = prospectingData.loras;
      }

      const res = await fetch(`${BACKEND}/api/smelt/all-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = (errData.detail as string) ?? `Server error ${res.status}`;
        selectedPoses.forEach(n => setPoseViewState(n, { status: "error", error: msg }));
        setGenProgress(null);
        return;
      }

      const { job_id } = await res.json();
      setSmeltJobId(job_id);

      const sse = new EventSource(`${BACKEND}/api/jobs/${job_id}/stream`);
      sseRef.current = sse;

      sse.onmessage = (e) => {
        const event = JSON.parse(e.data) as Record<string, unknown>;
        const type = event.type as string;

        if (type === "progress") {
          if (typeof event.message === "string") setGenProgress(event.message);
        } else if (type === "view_ready") {
          const name = event.view_angle as string;
          const imageUrl = event.image_url as string;
          setPoseViewState(name, {
            status: "done",
            imageSrc: imageUrl,
            rgbaUrl: (event.rgba_url as string | null) ?? null,
            error: null,
          });
          // Surface finished frames in the Asset Tray.
          const preset = posePresets.find(p => p.name === name);
          addToTray({
            src: imageUrl,
            thumbnailSrc: imageUrl,
            label: preset?.label ?? name,
            sourceStage: "smelt",
            sourceJobId: job_id,
            tags: ["pose"],
          });
        } else if (type === "done") {
          setGenProgress(null);
          sse.close();
          sseRef.current = null;
        } else if (type === "error") {
          const msg = (event.message as string) ?? "Unknown error";
          setPoseViews(prev => {
            const next = { ...prev };
            for (const n of selectedPoses) {
              if (next[n]?.status === "generating") next[n] = { ...next[n], status: "error", error: msg };
            }
            return next;
          });
          setGenProgress(null);
          sse.close();
          sseRef.current = null;
        }
      };

      sse.onerror = () => {
        sse.close();
        sseRef.current = null;
        setPoseViews(prev => {
          const next = { ...prev };
          for (const n of selectedPoses) {
            if (next[n]?.status === "generating") next[n] = { ...next[n], status: "error", error: "Lost connection to backend." };
          }
          return next;
        });
        setGenProgress(null);
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      selectedPoses.forEach(n => setPoseViewState(n, { status: "error", error: msg }));
      setGenProgress(null);
    }
  }

  /* ── Lock → feed the 2D Forge packer ─────────────────────── */
  function handleLock() {
    if (!allApproved) return;
    onLock({
      views:     {} as Record<ViewAngle, string>,
      depthMaps: {} as Record<ViewAngle, string | null>,
      masks:     {} as Record<ViewAngle, string | null>,
      smeltJobId,
      smeltMode: "SPRITE",
      poses:     selectedPoses,
      prompt,
      prospectingData: prospectingData ?? null,
    });
  }

  /* Poses grouped by direction for the picker. */
  const posesByDirection = DIRECTION_ORDER
    .map(dir => ({ dir, presets: posePresets.filter(p => p.direction === dir) }))
    .filter(g => g.presets.length > 0);

  return (
    <div className="smelting">
      {/* ── LEFT PANEL ─────────────────────────────────────── */}
      <aside className="smelt__panel">
        <div className="smelt__panel-scroll">

          {/* Identity (locked prospect) or prompt-only banner */}
          {hasProspect ? (
            <div className="smelt__source">
              <div className="smelt__source-header">
                <span className="smelt__source-title">Identity Locked</span>
                <span className="badge badge--yellow">CHARACTER</span>
              </div>
              {sourceImage && <img className="smelt__source-img" src={sourceImage} alt="Locked character" />}
              <div style={{ marginTop: "var(--space-3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)", color: "var(--steel-shine)", marginBottom: 4 }}>
                  <span>Identity strength</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--yellow-bright)" }}>{ipScale.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0.4} max={0.8} step={0.05} value={ipScale}
                  onChange={e => setIpScale(parseFloat(e.target.value))}
                  disabled={anyGenerating}
                  style={{ width: "100%", accentColor: "var(--yellow-core)" }}
                />
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                  Higher = stricter character match; lower = freer poses.
                </div>
              </div>
            </div>
          ) : (
            <div className="smelt__source" style={{ background: "var(--yellow-dim)", borderColor: "rgba(200,216,236,0.2)" }}>
              <div className="smelt__source-title" style={{ color: "var(--yellow-bright)", marginBottom: 4 }}>Prompt-only mode</div>
              <div style={{ fontSize: 11, color: "var(--steel-shine)", lineHeight: 1.5 }}>
                Lock a Prospect character for identity-consistent poses. Otherwise frames are generated from the prompt below.
              </div>
            </div>
          )}

          {/* Character prompt */}
          <div className="smelt__prompt-box">
            <label className="smelt__prompt-label" htmlFor="smelt-prompt">
              {hasProspect ? "Character description" : "Describe your character"}
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

          {/* Pose picker — grouped by direction */}
          <div className="smelt__pose-picker">
            <div className="smelt__pose-picker-header">
              <span className="smelt__pose-picker-title">Poses</span>
              <span className="smelt__pose-picker-count">{selectedPoses.length} / {posePresets.length}</span>
            </div>
            {posePresets.length === 0 ? (
              <span className="smelt__pose-loading">Loading pose library…</span>
            ) : (
              posesByDirection.map(({ dir, presets }) => (
                <div key={dir} style={{ marginBottom: "var(--space-2)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", margin: "6px 0 4px" }}>
                    {DIRECTION_ICON[dir]} {DIRECTION_LABEL[dir]}
                  </div>
                  <div className="smelt__pose-chips">
                    {presets.map(p => {
                      const on = selectedPoses.includes(p.name);
                      return (
                        <button
                          key={p.name}
                          className={`smelt__pose-chip${on ? " active" : ""}`}
                          onClick={() => togglePose(p.name)}
                          title={p.prompt_hint}
                          disabled={anyGenerating}
                        >
                          <img className="smelt__pose-chip-thumb" src={`${BACKEND}/api/poses/${p.name}/preview.png?size=128`} alt="" />
                          <span className="smelt__pose-chip-label">{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Progress */}
          <div className="smelt__progress-row">
            <span className="smelt__progress-label">Poses approved</span>
            <span className="smelt__progress-count">{approvedCount} / {totalCount || 1}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${totalCount > 0 ? (approvedCount / totalCount) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Footer */}
        <div className="smelt__panel-footer">
          {!canGenerate && (
            <div className="smelt__no-prospect-hint">Enter a prompt and pick at least one pose</div>
          )}
          {anyGenerating && genProgress && (
            <div className="smelt__gen-progress">{genProgress}</div>
          )}
          <button className="smelt__gen-all-btn" onClick={generateAll} disabled={anyGenerating || !canGenerate}>
            {anyGenerating
              ? <><span className="spinner" style={{ borderTopColor: "#000" }} /> Generating…</>
              : <>Generate Poses</>}
          </button>
          <button className="smelt__lock-btn" onClick={handleLock} disabled={!allApproved}>
            Send to Forge →
          </button>
        </div>
      </aside>

      {/* ── RIGHT: pose frame grid ─────────────────────────── */}
      <div className="smelt__grid smelt__grid--sprite">
        {selectedPoses.length === 0 ? (
          <div className="smelt__sprite-empty">Pick at least one pose from the library on the left to start.</div>
        ) : (
          selectedPoses.map(name => {
            const preset = posePresets.find(p => p.name === name);
            const vs = poseViews[name] ?? IDLE;
            return (
              <ViewPanel
                key={name}
                label={preset?.label ?? name}
                icon={DIRECTION_ICON[preset?.direction ?? "front"] ?? "●"}
                hint={preset?.direction ?? ""}
                state={vs}
                onApprove={() => approvePose(name)}
                onReject={() => rejectPose(name)}
                onExpand={() => setLightbox(name)}
              />
            );
          })
        )}
      </div>

      {/* ── Lightbox ───────────────────────────────────────── */}
      {lightbox && (() => {
        const vs = poseViews[lightbox];
        if (!vs?.imageSrc) return null;
        const preset = posePresets.find(p => p.name === lightbox);
        return (
          <div className="smelt__lightbox" onClick={() => setLightbox(null)}>
            <div className="smelt__lightbox-inner" onClick={e => e.stopPropagation()}>
              <div className="smelt__lightbox-header">
                <span className="smelt__lightbox-title">
                  {DIRECTION_ICON[preset?.direction ?? "front"]} {preset?.label ?? lightbox}
                </span>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <button className="view-btn view-btn--approve" onClick={() => { approvePose(lightbox); setLightbox(null); }}>Approve</button>
                  <button className="win-btn win-btn--close" onClick={() => setLightbox(null)}>X</button>
                </div>
              </div>
              <img src={vs.imageSrc} alt={lightbox} className="smelt__lightbox-img" />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Single pose-frame panel ────────────────────────────────── */
interface ViewPanelProps {
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
      <div className="view-header">
        <div className="view-header__left">
          <span className="view-angle-icon">{icon}</span>
          <span className="view-label">{label}</span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginLeft: 2 }}>{hint}</span>
        </div>
        <span className={`view-status view-status--${state.status}`}>
          {state.status === "idle"       && "—"}
          {state.status === "generating" && <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Generating</>}
          {state.status === "done"       && "Ready"}
          {state.status === "approved"   && "Approved"}
          {state.status === "rejected"   && "Rejected"}
          {state.status === "error"      && "Failed"}
        </span>
      </div>

      <div className="view-img-area" onClick={hasImage ? onExpand : undefined}>
        {state.imageSrc ? (
          <img src={state.imageSrc} alt={`${label} pose`} />
        ) : state.status === "error" ? (
          <div className="view-error-body">
            <span className="view-error-body__icon">!</span>
            <span className="view-error-body__msg">{state.error}</span>
          </div>
        ) : (
          <div className="view-empty">
            <span className="view-empty__icon">{icon}</span>
            <span className="view-empty__text">{label} not generated</span>
          </div>
        )}
        {state.status === "generating" && (
          <div className="view-generating-overlay">
            <span className="spinner spinner--lg" />
            <span>Generating {label}…</span>
          </div>
        )}
        {hasImage && state.status !== "generating" && <div className="view-expand-hint">Expand</div>}
      </div>

      <div className="view-footer">
        {!hasImage && state.status !== "generating" && state.status !== "error" ? (
          <span style={{ flex: 1, textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Use "Generate Poses" to start
          </span>
        ) : state.status === "error" ? (
          <span style={{ flex: 1, textAlign: "center", fontSize: "var(--text-xs)", color: "var(--status-error)" }}>{state.error}</span>
        ) : (
          <>
            <button className={`view-btn view-btn--approve ${state.status === "approved" ? "active" : ""}`} onClick={onApprove} disabled={!canAct || state.status === "approved"}>Approve</button>
            <button className="view-btn view-btn--reject" onClick={onReject} disabled={!canAct}>Reject</button>
          </>
        )}
      </div>
    </div>
  );
}
