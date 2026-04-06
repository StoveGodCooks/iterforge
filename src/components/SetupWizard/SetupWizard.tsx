import { useState, useEffect, useCallback } from "react";
import "../../styles/setup.css";

const BACKEND = "http://127.0.0.1:7842";

// ── Types ────────────────────────────────────────────────────
interface HardwareInfo {
  gpu_name: string;
  vram_gb:  number;
  tier:     "high" | "mid" | "low" | "cpu";
}

interface DepInfo {
  id:        string;
  name:      string;
  package:   string;
  installed: boolean;
}

interface ModelInfo {
  id:       string;
  name:     string;
  filename: string;
  size_mb:  number;
  present:  boolean;
  path:     string;
  url:      string;
}

interface SetupStatus {
  overall:     "ready" | "needs_setup";
  hardware:    HardwareInfo;
  python_deps: DepInfo[];
  models:      ModelInfo[];
  summary: {
    missing_deps_count:   number;
    missing_models_count: number;
  };
}

interface InstallEvent {
  type:        string;
  step_id?:    string;
  description?: string;
  output?:     string;
  pct?:        number;
  message?:    string;
}

interface Props {
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────
export default function SetupWizard({ onClose }: Props) {
  const [status,     setStatus]     = useState<SetupStatus | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installPct, setInstallPct] = useState(0);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [done,       setDone]       = useState(false);

  // ── Fetch status ──────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND}/api/setup/status`);
      if (!res.ok) {
        // Try to read a body for more detail, fall back to HTTP status
        let detail = `HTTP ${res.status}`;
        try { const j = await res.json(); detail = j.detail ?? detail; } catch {}
        throw new Error(detail);
      }
      const data: SetupStatus = await res.json();
      setStatus(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Network-level failure vs server error
      const isOffline = msg.includes("fetch") || msg.includes("Failed") || msg.includes("NetworkError");
      setError(isOffline
        ? "Backend is not running on port 7842 — start it then click ↺"
        : `Setup check failed: ${msg} — click ↺ to retry`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Install missing items ─────────────────────────────────
  async function installMissing() {
    if (!status) return;
    const items: string[] = [
      ...status.python_deps.filter(d => !d.installed).map(d => d.id),
      ...status.models.filter(m => !m.present).map(m => m.id),
    ];
    if (!items.length) return;

    setInstalling(true);
    setInstallLog([]);
    setInstallPct(0);
    setActiveItem(null);
    setDone(false);

    try {
      const res = await fetch(`${BACKEND}/api/setup/install`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { job_id } = await res.json();

      const sse = new EventSource(`${BACKEND}/api/jobs/${job_id}/stream`);
      sse.onmessage = (e) => {
        const ev: InstallEvent = JSON.parse(e.data);
        if (ev.type === "step_active") {
          setActiveItem(ev.step_id ?? null);
          setInstallLog(prev => [...prev, `▶ ${ev.description ?? ev.step_id}`]);
        } else if (ev.type === "step_done") {
          setInstallLog(prev => [...prev, `  ✓ ${ev.step_id} — ${ev.output ?? "done"}`]);
        } else if (ev.type === "progress") {
          setInstallPct(ev.pct ?? 0);
          if (ev.message) setInstallLog(prev => {
            // Replace last progress line if it looks like the same item
            const last = prev[prev.length - 1] ?? "";
            if (last.startsWith("  ↓")) return [...prev.slice(0, -1), `  ↓ ${ev.message}`];
            return [...prev, `  ↓ ${ev.message}`];
          });
        } else if (ev.type === "log") {
          if (ev.message) setInstallLog(prev => [...prev, `  ${ev.message}`]);
        } else if (ev.type === "done") {
          setActiveItem(null);
          setInstallPct(100);
          setDone(true);
          setInstalling(false);
          sse.close();
          // Re-fetch status after install completes
          fetchStatus();
        } else if (ev.type === "error") {
          setInstallLog(prev => [...prev, `✗ Error: ${ev.message ?? "Unknown error"}`]);
          setInstalling(false);
          sse.close();
        }
      };
      sse.onerror = () => {
        setInstalling(false);
        sse.close();
      };
    } catch (e) {
      setInstalling(false);
      setInstallLog(prev => [...prev, `✗ Failed to start install: ${e}`]);
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  const missingDeps   = status?.python_deps.filter(d => !d.installed) ?? [];
  const missingModels = status?.models.filter(m => !m.present) ?? [];
  const totalMissing  = missingDeps.length + missingModels.length;

  const tierLabel: Record<string, string> = {
    high: "High-End (≥8 GB VRAM)",
    mid:  "Mid-Range (4–8 GB VRAM)",
    low:  "Low-End (<4 GB VRAM)",
    cpu:  "CPU Mode",
  };
  const tierClass: Record<string, string> = {
    high: "setup__badge setup__badge--green",
    mid:  "setup__badge setup__badge--yellow",
    low:  "setup__badge setup__badge--red",
    cpu:  "setup__badge setup__badge--muted",
  };

  return (
    <div className="setup__overlay" onClick={onClose}>
      <div className="setup__panel" onClick={e => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────────── */}
        <div className="setup__header">
          <div className="setup__header-left">
            <span className="setup__header-icon">⚙</span>
            <div>
              <div className="setup__header-title">Setup &amp; Environment</div>
              <div className="setup__header-sub">
                {loading
                  ? "Checking…"
                  : error
                    ? "Backend unreachable"
                    : status?.overall === "ready"
                      ? "✓ All systems ready"
                      : `${totalMissing} item${totalMissing !== 1 ? "s" : ""} need${totalMissing === 1 ? "s" : ""} attention`}
              </div>
            </div>
          </div>
          <div className="setup__header-right">
            <button className="setup__refresh-btn" onClick={fetchStatus} disabled={loading || installing}
              title="Re-check environment">
              {loading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : "↺"}
            </button>
            <button className="win-btn win-btn--close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* ── Error state ────────────────────────────────── */}
        {error && (
          <div className="setup__error-banner">⚠ {error}</div>
        )}

        {/* ── Body ───────────────────────────────────────── */}
        {!loading && status && (
          <div className="setup__body">

            {/* ── Hardware ───────────────────────────────── */}
            <section className="setup__section">
              <div className="setup__section-title">Hardware</div>
              <div className="setup__row">
                <span className="setup__row-label">GPU</span>
                <span className="setup__row-value">{status.hardware.gpu_name}</span>
                <span className={tierClass[status.hardware.tier] ?? "setup__badge setup__badge--muted"}>
                  {tierLabel[status.hardware.tier] ?? status.hardware.tier}
                </span>
              </div>
              <div className="setup__row">
                <span className="setup__row-label">VRAM / RAM</span>
                <span className="setup__row-value">{status.hardware.vram_gb} GB</span>
                {status.hardware.tier === "cpu" && (
                  <span className="setup__badge setup__badge--yellow">CPU-only — slow generation</span>
                )}
              </div>
            </section>

            {/* ── Python Dependencies ────────────────────── */}
            <section className="setup__section">
              <div className="setup__section-title">
                Python Dependencies
                {missingDeps.length > 0 && (
                  <span className="setup__badge setup__badge--red" style={{ marginLeft: 8 }}>
                    {missingDeps.length} missing
                  </span>
                )}
              </div>
              <div className="setup__checklist">
                {status.python_deps.map(dep => (
                  <div key={dep.id} className="setup__check-row">
                    <span className="setup__dot" data-ok={dep.installed} />
                    <span className="setup__check-name">{dep.name}</span>
                    <span className="setup__check-pkg">{dep.package}</span>
                    {activeItem === dep.id && (
                      <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, marginLeft: "auto" }} />
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* ── Models ─────────────────────────────────── */}
            <section className="setup__section">
              <div className="setup__section-title">
                AI Models
                {missingModels.length > 0 && (
                  <span className="setup__badge setup__badge--red" style={{ marginLeft: 8 }}>
                    {missingModels.length} missing
                  </span>
                )}
              </div>
              <div className="setup__checklist">
                {status.models.map(model => (
                  <div key={model.id} className="setup__check-row">
                    <span className="setup__dot" data-ok={model.present} />
                    <span className="setup__check-name">{model.name}</span>
                    <span className="setup__check-size">{model.size_mb.toLocaleString()} MB</span>
                    {activeItem === model.id ? (
                      <div className="setup__dl-progress">
                        <div className="setup__dl-bar" style={{ width: `${installPct}%` }} />
                        <span className="setup__dl-pct">{installPct}%</span>
                      </div>
                    ) : !model.present ? (
                      <a
                        className="setup__manual-link"
                        href={model.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open download URL in browser"
                      >
                        ↗ manual
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
              {missingModels.length > 0 && (
                <div className="setup__hint">
                  Models are downloaded to <code>%APPDATA%/InterForge/models/</code>.
                  You can also place them manually and click ↺ Refresh.
                </div>
              )}
            </section>

          </div>
        )}

        {/* ── Install log ────────────────────────────────── */}
        {installLog.length > 0 && (
          <div className="setup__log">
            {installLog.map((line, i) => (
              <div key={i} className="setup__log-line">{line}</div>
            ))}
            {done && (
              <div className="setup__log-line setup__log-line--done">
                ✓ Installation complete — refreshed status above.
              </div>
            )}
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────── */}
        {!loading && status && (
          <div className="setup__footer">
            {totalMissing > 0 ? (
              <button
                className="setup__install-btn"
                onClick={installMissing}
                disabled={installing}
              >
                {installing
                  ? <><span className="spinner" style={{ borderTopColor: "#000" }} /> Installing…</>
                  : <>⬇ Install All Missing ({totalMissing} item{totalMissing !== 1 ? "s" : ""})</>}
              </button>
            ) : (
              <div className="setup__all-good">
                ✓ Everything is installed and ready to forge.
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
