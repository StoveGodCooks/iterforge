/**
 * InterForge Dev Tools Tab
 *
 * Panels:
 *  Overview  — last run profile at a glance + system health summary
 *  Jobs      — browse all job folders, view files + timing profiles
 *  Tests     — run pytest, live streaming output
 *  Health    — full package/GPU/disk status
 *  Config    — current backend runtime config
 */
import { useCallback, useEffect, useRef, useState } from "react";

const API = "http://127.0.0.1:7842/dev";

type Panel = "overview" | "jobs" | "tests" | "health" | "config" | "e2e" | "sse" | "loft";

/* ── Types ────────────────────────────────────────────────────── */
interface ProfileSection {
  section: string;
  label: string;
  depth: number;
  duration_ms: number;
  duration_s: number;
  pct_total: number;
}
interface Profile {
  job_id: string;
  route: string;
  total_ms: number;
  total_s: number;
  sections: ProfileSection[];
  bottlenecks: ProfileSection[];
}
interface JobMeta {
  job_id: string;
  stages: string[];
  files: Record<string, string[]>;
  profile: Profile | null;
  project_json: Record<string, unknown> | null;
  modified_iso: string;
  error?: string;
}
interface HealthData {
  python: string;
  packages: Record<string, string>;
  gpu: Record<string, unknown>;
  disk: { total_gb: number; used_gb: number; free_gb: number };
  projects_root: string;
  backend_url: string;
}
interface E2EStage {
  stage: string;
  job_id?: string;
  route?: string;
  total_ms?: number;
  sections?: ProfileSection[];
  bottlenecks?: ProfileSection[];
  views?: Array<E2EStage & { angle: string }>;
  note?: string;
}
interface E2EProfile {
  forge_job_id: string;
  total_ms: number;
  total_s: number;
  total_min: number;
  stages: E2EStage[];
  bottlenecks: Array<{ section: string; label: string; duration_ms: number; duration_s: number; pct_total: number }>;
  note: string;
}

interface MeshStats {
  vertices: number;
  faces: number;
  is_watertight: boolean;
  is_winding_consistent: boolean;
  bounding_box: { min: number[] | null; max: number[] | null };
  volume: number | null;
  surface_area: number;
  mesh_file: string;
}

/* ── Shared fetch helper ──────────────────────────────────────── */
async function devGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

/* ── Root component ──────────────────────────────────────────── */
export default function DevTools() {
  const [panel, setPanel] = useState<Panel>("overview");

  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <nav style={styles.sidebar}>
        <div style={styles.sidebarTitle}>DEV TOOLS</div>
        {(["overview", "e2e", "jobs", "tests", "health", "config", "sse", "loft"] as Panel[]).map(p => (
          <button
            key={p}
            style={{ ...styles.navBtn, ...(panel === p ? styles.navBtnActive : {}) }}
            onClick={() => setPanel(p)}
          >
            {navIcon(p)} {p.toUpperCase()}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <a
          href="http://127.0.0.1:7842/docs"
          target="_blank"
          rel="noreferrer"
          style={styles.docsLink}
        >
          Swagger UI ↗
        </a>
      </nav>

      {/* Content */}
      <div style={styles.content}>
        {panel === "overview" && <OverviewPanel />}
        {panel === "e2e"      && <E2EPanel />}
        {panel === "jobs"     && <JobsPanel />}
        {panel === "tests"    && <TestsPanel />}
        {panel === "health"   && <HealthPanel />}
        {panel === "config"   && <ConfigPanel />}
        {panel === "sse"      && <SSEMonitorPanel />}
        {panel === "loft"     && <LoftDebugPanel />}
      </div>
    </div>
  );
}

function navIcon(p: Panel) {
  return { overview: "◈", e2e: "⏱", jobs: "⊟", tests: "▶", health: "♥", config: "⚙", sse: "◉", loft: "△" }[p];
}

/* ── Overview panel ──────────────────────────────────────────── */
function OverviewPanel() {
  const [jobs, setJobs]     = useState<JobMeta[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      devGet<{ jobs: JobMeta[] }>("/jobs?limit=5"),
      devGet<HealthData>("/health"),
    ]).then(([j, h]) => {
      setJobs(j.jobs);
      setHealth(h);
    }).catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (err)     return <ErrorBox msg={err} />;

  const lastForge = jobs.find(j => j.stages.includes("forge"));
  const profile   = lastForge?.profile ?? null;

  return (
    <div style={styles.panelBody}>
      <SectionHeading>Last Pipeline Run</SectionHeading>
      {profile ? <ProfileView profile={profile} /> : <Muted>No forge runs found.</Muted>}

      <SectionHeading style={{ marginTop: 24 }}>System Snapshot</SectionHeading>
      {health && (
        <div style={styles.grid2}>
          <KV label="Disk Free" value={`${health.disk.free_gb} GB`} />
          <KV label="open3d" value={health.packages["open3d"]} ok={health.packages["open3d"] !== "NOT INSTALLED"} />
          <KV label="trimesh" value={health.packages["trimesh"]} ok={health.packages["trimesh"] !== "NOT INSTALLED"} />
          <KV label="torch" value={health.packages["torch"]} ok={health.packages["torch"] !== "NOT INSTALLED"} />
          <KV label="cadquery" value={health.packages["cadquery"]} ok={health.packages["cadquery"] !== "NOT INSTALLED"} />
          {"cuda_available" in (health.gpu || {}) && (
            <KV label="GPU" value={String((health.gpu as Record<string, unknown>)["device_name"] ?? "CPU only")} />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Jobs panel ──────────────────────────────────────────────── */
function JobsPanel() {
  const [jobs, setJobs]       = useState<JobMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail]   = useState<JobMeta | null>(null);
  const [meshStats, setMeshStats] = useState<MeshStats | null>(null);
  const [meshErr, setMeshErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);

  useEffect(() => {
    devGet<{ jobs: JobMeta[] }>("/jobs?limit=100")
      .then(r => setJobs(r.jobs))
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function selectJob(id: string) {
    setSelected(id);
    setDetail(null);
    setMeshStats(null);
    setMeshErr(null);
    devGet<JobMeta>(`/job/${id}`).then(setDetail).catch(console.error);
    devGet<MeshStats>(`/mesh-stats/${id}`)
      .then(setMeshStats)
      .catch(e => setMeshErr(String(e)));
  }

  if (loading) return <Spinner />;
  if (err)     return <ErrorBox msg={err} />;

  return (
    <div style={{ display: "flex", gap: 0, height: "100%", overflow: "hidden" }}>
      {/* Job list */}
      <div style={styles.jobList}>
        <div style={styles.listHeader}>Jobs ({jobs.length})</div>
        {jobs.map(j => (
          <button
            key={j.job_id}
            style={{ ...styles.jobRow, ...(selected === j.job_id ? styles.jobRowActive : {}) }}
            onClick={() => selectJob(j.job_id)}
          >
            <span style={styles.jobId}>{j.job_id.slice(0, 8)}…</span>
            <div style={styles.jobMeta}>
              <span>{j.stages.join(" → ")}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                {j.modified_iso.replace("T", " ").replace("Z", "")}
              </span>
            </div>
            {j.profile && (
              <span style={styles.badge}>{j.profile.total_s}s {j.profile.route}</span>
            )}
          </button>
        ))}
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-4)" }}>
        {!selected && <Muted>Select a job to inspect.</Muted>}
        {selected && !detail && <Spinner />}
        {detail && (
          <>
            <SectionHeading>{detail.job_id}</SectionHeading>
            <div style={styles.tag}>{detail.modified_iso.replace("T", " ").replace("Z", " UTC")}</div>

            {/* Profile */}
            {detail.profile && (
              <>
                <SectionHeading style={{ marginTop: 16 }}>Pipeline Timing</SectionHeading>
                <ProfileView profile={detail.profile} />
              </>
            )}

            {/* Mesh stats */}
            {meshStats && (
              <>
                <SectionHeading style={{ marginTop: 16 }}>Mesh Stats ({meshStats.mesh_file})</SectionHeading>
                <div style={styles.grid2}>
                  <KV label="Vertices"   value={meshStats.vertices.toLocaleString()} />
                  <KV label="Faces"      value={meshStats.faces.toLocaleString()} />
                  <KV label="Watertight" value={meshStats.is_watertight ? "Yes" : "No"} ok={meshStats.is_watertight} />
                  <KV label="Winding OK" value={meshStats.is_winding_consistent ? "Yes" : "No"} ok={meshStats.is_winding_consistent} />
                  {meshStats.volume !== null && <KV label="Volume" value={meshStats.volume.toFixed(4)} />}
                  <KV label="Surface Area" value={meshStats.surface_area.toFixed(4)} />
                </div>
              </>
            )}
            {meshErr && <div style={styles.warnBox}>Mesh stats: {meshErr}</div>}

            {/* Files */}
            {Object.entries(detail.files).map(([stage, files]) => (
              <div key={stage}>
                <SectionHeading style={{ marginTop: 16 }}>{stage} files</SectionHeading>
                <div style={styles.fileGrid}>
                  {files.map(f => (
                    <div key={f} style={styles.fileChip}>
                      {f}
                      {detail.file_sizes?.[stage]?.[f] !== undefined && (
                        <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>
                          {fmtBytes((detail as unknown as Record<string, Record<string, Record<string, number>>>)["file_sizes"][stage][f])}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Tests panel ──────────────────────────────────────────────── */
function TestsPanel() {
  const [lines, setLines]   = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [testPath, setTestPath] = useState("tests/");
  const [testArgs, setTestArgs] = useState("-v --tb=short");
  const outputRef = useRef<HTMLDivElement>(null);

  const runTests = useCallback(async () => {
    setLines([]);
    setRunning(true);
    setExitCode(null);
    const params = new URLSearchParams({ path: testPath, args: testArgs });
    const resp = await fetch(`${API}/tests/run?${params}`, { method: "POST" });
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        try {
          const msg = JSON.parse(part.slice(6));
          if (msg.type === "line")  setLines(prev => [...prev, msg.text]);
          if (msg.type === "done")  { setExitCode(msg.returncode); setRunning(false); }
          if (msg.type === "error") { setLines(prev => [...prev, `ERROR: ${msg.message}`]); setRunning(false); }
        } catch { /* ignore */ }
      }
    }
    setRunning(false);
  }, [testPath, testArgs]);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [lines]);

  const passed = exitCode === 0;

  return (
    <div style={styles.panelBody}>
      <SectionHeading>Test Runner</SectionHeading>
      <div style={styles.row}>
        <label style={styles.label}>Path</label>
        <input
          style={styles.input}
          value={testPath}
          onChange={e => setTestPath(e.target.value)}
          placeholder="tests/"
        />
        <label style={styles.label}>Args</label>
        <input
          style={{ ...styles.input, flex: 1 }}
          value={testArgs}
          onChange={e => setTestArgs(e.target.value)}
          placeholder="-v --tb=short"
        />
        <button
          style={{ ...styles.btn, ...(running ? styles.btnDisabled : {}) }}
          onClick={runTests}
          disabled={running}
        >
          {running ? "Running…" : "▶ Run Tests"}
        </button>
      </div>

      {exitCode !== null && (
        <div style={{ ...styles.statusBar, background: passed ? "rgba(46,204,113,0.12)" : "rgba(231,76,60,0.12)",
          borderColor: passed ? "var(--status-success)" : "var(--status-error)",
          color: passed ? "var(--status-success)" : "var(--status-error)" }}>
          {passed ? "✓ All tests passed" : `✗ Tests failed (exit ${exitCode})`}
        </div>
      )}

      <div ref={outputRef} style={styles.terminal}>
        {lines.length === 0 && !running && <span style={{ color: "var(--text-muted)" }}>No output yet. Hit Run Tests.</span>}
        {lines.map((l, i) => (
          <div key={i} style={{ color: lineColor(l) }}>{l || "\u00a0"}</div>
        ))}
        {running && <div style={{ color: "var(--text-muted)" }}>…</div>}
      </div>
    </div>
  );
}

function lineColor(line: string): string {
  if (line.startsWith("PASSED") || line.includes(" passed")) return "var(--status-success)";
  if (line.startsWith("FAILED") || line.startsWith("ERROR") || line.includes(" failed")) return "var(--status-error)";
  if (line.startsWith("WARNING")) return "var(--status-warn)";
  if (line.startsWith("=====")) return "var(--yellow-core)";
  return "var(--text-primary)";
}

/* ── Health panel ────────────────────────────────────────────── */
function HealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]     = useState<string | null>(null);

  function reload() {
    setLoading(true); setErr(null);
    devGet<HealthData>("/health")
      .then(setHealth).catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  if (loading) return <Spinner />;
  if (err)     return <ErrorBox msg={err} onRetry={reload} />;
  if (!health) return null;

  const missing = Object.entries(health.packages).filter(([, v]) => v === "NOT INSTALLED").map(([k]) => k);
  const installed = Object.entries(health.packages).filter(([, v]) => v !== "NOT INSTALLED");

  return (
    <div style={styles.panelBody}>
      <div style={styles.rowSpread}>
        <SectionHeading>System Health</SectionHeading>
        <button style={styles.btnSm} onClick={reload}>↻ Refresh</button>
      </div>

      {/* GPU */}
      <SectionHeading style={{ marginTop: 16 }}>GPU</SectionHeading>
      <div style={styles.grid2}>
        {"cuda_available" in health.gpu ? (
          <>
            <KV label="CUDA" value={String(health.gpu["cuda_available"]) === "true" ? "Available" : "Not available"} ok={health.gpu["cuda_available"] === true} />
            {health.gpu["device_name"] && <KV label="Device" value={String(health.gpu["device_name"])} />}
            {health.gpu["vram_gb"]    && <KV label="VRAM"   value={`${health.gpu["vram_gb"]} GB`} />}
          </>
        ) : <Muted>torch not installed — GPU info unavailable</Muted>}
      </div>

      {/* Disk */}
      <SectionHeading style={{ marginTop: 16 }}>Disk ({health.projects_root})</SectionHeading>
      <DiskBar used={health.disk.used_gb} total={health.disk.total_gb} free={health.disk.free_gb} />

      {/* Missing packages */}
      {missing.length > 0 && (
        <>
          <SectionHeading style={{ marginTop: 16, color: "var(--status-warn)" }}>Missing Packages ({missing.length})</SectionHeading>
          <div style={styles.fileGrid}>
            {missing.map(p => <div key={p} style={{ ...styles.fileChip, borderColor: "var(--status-warn)", color: "var(--status-warn)" }}>{p}</div>)}
          </div>
        </>
      )}

      {/* Installed packages */}
      <SectionHeading style={{ marginTop: 16 }}>Installed Packages</SectionHeading>
      <div style={styles.grid2}>
        {installed.map(([pkg, ver]) => <KV key={pkg} label={pkg} value={ver} ok />)}
      </div>

      {/* Python */}
      <SectionHeading style={{ marginTop: 16 }}>Python</SectionHeading>
      <Code>{health.python}</Code>
    </div>
  );
}

/* ── Config panel ────────────────────────────────────────────── */
function ConfigPanel() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    devGet<Record<string, unknown>>("/config")
      .then(setConfig).catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (err)     return <ErrorBox msg={err} />;
  if (!config) return null;

  return (
    <div style={styles.panelBody}>
      <SectionHeading>Runtime Config</SectionHeading>
      <div style={styles.grid2}>
        {Object.entries(config).filter(([k]) => k !== "env_overrides").map(([k, v]) => (
          <KV key={k} label={k} value={String(v)} />
        ))}
      </div>
      {config.env_overrides && Object.keys(config.env_overrides as object).length > 0 && (
        <>
          <SectionHeading style={{ marginTop: 16 }}>Environment Overrides</SectionHeading>
          <div style={styles.grid2}>
            {Object.entries(config.env_overrides as Record<string, string>).map(([k, v]) => (
              <KV key={k} label={k} value={v} />
            ))}
          </div>
        </>
      )}
      {config.env_overrides && Object.keys(config.env_overrides as object).length === 0 && (
        <Muted style={{ marginTop: 8 }}>No INTERFORGE_* environment variables set.</Muted>
      )}
    </div>
  );
}

/* ── E2E Profile panel ───────────────────────────────────────── */
function E2EPanel() {
  const [jobs, setJobs]     = useState<JobMeta[]>([]);
  const [forgeJobId, setForgeJobId] = useState("");
  const [profile, setProfile]   = useState<E2EProfile | null>(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  useEffect(() => {
    devGet<{ jobs: JobMeta[] }>("/jobs?limit=30")
      .then(r => {
        const forgeJobs = r.jobs.filter(j => j.stages.includes("forge"));
        setJobs(forgeJobs);
        if (forgeJobs.length > 0) setForgeJobId(forgeJobs[0].job_id);
      })
      .catch(() => {});
  }, []);

  function load() {
    if (!forgeJobId) return;
    setLoading(true); setErr(null); setProfile(null);
    devGet<E2EProfile>(`/e2e-profile/${forgeJobId}`)
      .then(setProfile)
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }

  return (
    <div style={styles.panelBody}>
      <SectionHeading>End-to-End Pipeline Timer</SectionHeading>
      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 12 }}>
        Covers Prospecting → Smelting → Forge. Shows exactly where your time goes.
      </div>

      <div style={styles.row}>
        <label style={styles.label}>Forge Job</label>
        <select
          style={{ ...styles.input, width: 300 }}
          value={forgeJobId}
          onChange={e => setForgeJobId(e.target.value)}
        >
          {jobs.map(j => (
            <option key={j.job_id} value={j.job_id}>
              {j.job_id.slice(0, 12)}… — {j.modified_iso.replace("T", " ").replace("Z", "")}
              {j.profile ? ` [${j.profile.total_s}s ${j.profile.route}]` : ""}
            </option>
          ))}
        </select>
        <button style={styles.btn} onClick={load} disabled={loading || !forgeJobId}>
          {loading ? "Loading…" : "Load E2E Profile"}
        </button>
      </div>

      {err && <ErrorBox msg={err} />}

      {profile && (
        <>
          {/* Total time hero */}
          <div style={styles.heroBox}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Total Pipeline Time</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: "var(--yellow-core)", fontFamily: "var(--font-mono)" }}>
              {profile.total_min >= 1 ? `${profile.total_min.toFixed(1)} min` : `${profile.total_s.toFixed(1)} s`}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>{profile.note}</div>
          </div>

          {/* Stage breakdown */}
          <SectionHeading style={{ marginTop: 16 }}>Stage Breakdown</SectionHeading>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Stage</th>
                <th style={styles.th}>Time</th>
                <th style={styles.th}>% Total</th>
                <th style={styles.th}>Bar</th>
              </tr>
            </thead>
            <tbody>
              {profile.stages.map((stage, i) => {
                const ms  = stage.total_ms ?? 0;
                const pct = profile.total_ms > 0 ? (ms / profile.total_ms) * 100 : 0;
                return (
                  <tr key={i}>
                    <td style={styles.td}>
                      <code style={styles.code}>{stage.stage}</code>
                      {stage.route && <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 6 }}>{stage.route}</span>}
                    </td>
                    <td style={{ ...styles.td, fontVariantNumeric: "tabular-nums" }}>{fmtMs(ms)}</td>
                    <td style={{ ...styles.td, color: pct > 60 ? "var(--status-warn)" : "var(--text-primary)" }}>
                      {pct.toFixed(1)}%{pct > 60 ? " ⚠" : ""}
                    </td>
                    <td style={styles.td}><BarCell pct={pct} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Top 10 bottlenecks */}
          <SectionHeading style={{ marginTop: 20 }}>Top Bottlenecks (cross-pipeline)</SectionHeading>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Rank</th>
                <th style={styles.th}>Section</th>
                <th style={styles.th}>Label</th>
                <th style={styles.th}>Time</th>
                <th style={styles.th}>% Total</th>
              </tr>
            </thead>
            <tbody>
              {profile.bottlenecks.map((b, i) => (
                <tr key={i}>
                  <td style={{ ...styles.td, color: i === 0 ? "var(--status-warn)" : "var(--text-muted)", fontWeight: i === 0 ? 700 : 400 }}>#{i + 1}</td>
                  <td style={styles.td}><code style={styles.code}>{b.section}</code></td>
                  <td style={{ ...styles.td, color: "var(--text-secondary)", fontSize: 11 }}>{b.label}</td>
                  <td style={{ ...styles.td, fontVariantNumeric: "tabular-nums", fontWeight: i < 3 ? 600 : 400, color: i === 0 ? "var(--status-warn)" : "var(--text-primary)" }}>{fmtMs(b.duration_ms)}</td>
                  <td style={styles.td}>{b.pct_total}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Per-stage drill-down */}
          {profile.stages.map((stage, si) => {
            const sections = stage.sections ?? [];
            const views    = stage.views    ?? [];
            if (sections.length === 0 && views.length === 0) return null;
            return (
              <div key={si}>
                <SectionHeading style={{ marginTop: 20 }}>
                  {stage.stage.toUpperCase()} — step breakdown
                </SectionHeading>
                {sections.length > 0 && (
                  <ProfileView profile={{ job_id: stage.job_id ?? "", route: stage.route ?? "", total_ms: stage.total_ms ?? 0, total_s: (stage.total_ms ?? 0) / 1000, sections, bottlenecks: [] }} />
                )}
                {views.map((v, vi) => (
                  <div key={vi} style={{ marginTop: 12, paddingLeft: 12, borderLeft: "2px solid var(--bg-border)" }}>
                    <div style={{ fontSize: 11, color: "var(--yellow-core)", marginBottom: 6, fontWeight: 600 }}>
                      {v.angle} view — {fmtMs(v.total_ms ?? 0)}
                    </div>
                    {v.sections && v.sections.length > 0 && (
                      <ProfileView profile={{ job_id: v.job_id ?? "", route: v.route ?? "", total_ms: v.total_ms ?? 0, total_s: (v.total_ms ?? 0) / 1000, sections: v.sections, bottlenecks: [] }} />
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ── SSE Monitor panel ───────────────────────────────────────── */
interface ActiveJob { job_id: string; stage: string; status: string; error_code: string | null }

function SSEMonitorPanel() {
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const [jobId, setJobId]           = useState("");
  const [events, setEvents]         = useState<Array<{ type: string; raw: string; ts: number }>>([]);
  const [streaming, setStreaming]   = useState(false);
  const [loadErr, setLoadErr]       = useState<string | null>(null);
  const readerRef   = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const termRef     = useRef<HTMLDivElement>(null);

  function loadActiveJobs() {
    setLoadErr(null);
    devGet<{ jobs: ActiveJob[] }>("/active-jobs")
      .then(r => {
        setActiveJobs(r.jobs);
        if (r.jobs.length > 0 && !jobId) setJobId(r.jobs[0].job_id);
      })
      .catch(e => setLoadErr(String(e)));
  }
  useEffect(loadActiveJobs, []);

  async function startStream() {
    if (!jobId || streaming) return;
    setEvents([]);
    setStreaming(true);
    try {
      const resp = await fetch(`http://127.0.0.1:7842/api/jobs/${jobId}/stream`);
      const reader = resp.body!.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const raw = part.slice(6).trim();
          let evtType = "unknown";
          try { evtType = (JSON.parse(raw) as { type?: string }).type ?? "unknown"; } catch { /* */ }
          setEvents(prev => [...prev, { type: evtType, raw, ts: Date.now() }]);
        }
      }
    } catch (e) {
      setEvents(prev => [...prev, { type: "error", raw: String(e), ts: Date.now() }]);
    } finally {
      setStreaming(false);
      readerRef.current = null;
    }
  }

  function stopStream() {
    readerRef.current?.cancel();
    setStreaming(false);
  }

  useEffect(() => {
    termRef.current?.scrollTo(0, termRef.current.scrollHeight);
  }, [events]);

  function sseColor(type: string) {
    if (type === "done")       return "var(--status-success)";
    if (type === "error")      return "var(--status-error)";
    if (type === "progress")   return "var(--yellow-core)";
    if (type === "log")        return "var(--text-secondary)";
    if (type === "image_ready" || type === "svg_ready" || type === "view_ready") return "#7ec8e3";
    if (type === "step_active" || type === "step_done") return "#b39ddb";
    return "var(--text-primary)";
  }

  return (
    <div style={styles.panelBody}>
      <SectionHeading>Live SSE Monitor</SectionHeading>
      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 12 }}>
        Subscribe to raw SSE events from any active job in real time.
      </div>

      <div style={styles.row}>
        <label style={styles.label}>Job</label>
        <select
          style={{ ...styles.input, width: 320 }}
          value={jobId}
          onChange={e => setJobId(e.target.value)}
        >
          {activeJobs.length === 0 && <option value="">No active jobs</option>}
          {activeJobs.map(j => (
            <option key={j.job_id} value={j.job_id}>
              {j.job_id.slice(0, 12)}… [{j.stage}] {j.status}
            </option>
          ))}
        </select>
        <button style={styles.btnSm} onClick={loadActiveJobs}>↻</button>
        {!streaming
          ? <button style={{ ...styles.btn, ...((!jobId) ? styles.btnDisabled : {}) }} onClick={startStream} disabled={!jobId}>▶ Subscribe</button>
          : <button style={{ ...styles.btn, background: "rgba(231,76,60,0.2)", borderColor: "var(--status-error)", color: "var(--status-error)" }} onClick={stopStream}>■ Stop</button>
        }
      </div>

      {loadErr && <div style={styles.warnBox}>{loadErr}</div>}

      <div style={{ ...styles.row, gap: 12, marginTop: 4, marginBottom: 4, flexWrap: "wrap" }}>
        {["done","error","progress","log","image_ready","step_active","step_done"].map(t => (
          <span key={t} style={{ fontSize: 10, color: sseColor(t), fontFamily: "var(--font-mono)" }}>■ {t}</span>
        ))}
      </div>

      <div ref={termRef} style={{ ...styles.terminal, height: 460 }}>
        {events.length === 0 && !streaming && <span style={{ color: "var(--text-muted)" }}>Select a job and click Subscribe.</span>}
        {streaming && events.length === 0 && <span style={{ color: "var(--text-muted)" }}>Waiting for events…</span>}
        {events.map((e, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 10, marginRight: 8 }}>
              {new Date(e.ts).toISOString().slice(11, 23)}
            </span>
            <span style={{ color: sseColor(e.type), fontWeight: 600, marginRight: 8, fontSize: 10 }}>[{e.type}]</span>
            <span style={{ color: "var(--text-secondary)" }}>{e.raw.length > 200 ? e.raw.slice(0, 200) + "…" : e.raw}</span>
          </div>
        ))}
        {streaming && <div style={{ color: "var(--text-muted)", marginTop: 4 }}>● streaming…</div>}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{events.length} events received</div>
    </div>
  );
}

/* ── Loft Debugger panel ─────────────────────────────────────── */
interface LoftDebugData {
  timestamp: string;
  exception: string;
  traceback: string;
  fallback: string;
  multiview_stats: {
    views_analyzed: string[];
    z_depth_shape: number[];
    z_depth_min: number;
    z_depth_max: number;
    z_depth_nonzero_pct: number;
    asymmetry: Record<string, number>;
  };
}
interface LoftDebugResponse {
  forge_job_id: string;
  loft_succeeded: boolean;
  fallback_ply_exists: boolean;
  debug: LoftDebugData | null;
}

function LoftDebugPanel() {
  const [jobs, setJobs]         = useState<JobMeta[]>([]);
  const [forgeJobId, setForgeJobId] = useState("");
  const [result, setResult]     = useState<LoftDebugResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    devGet<{ jobs: JobMeta[] }>("/jobs?limit=30")
      .then(r => {
        const forgeJobs = r.jobs.filter(j => j.stages.includes("forge"));
        setJobs(forgeJobs);
        if (forgeJobs.length > 0) setForgeJobId(forgeJobs[0].job_id);
      }).catch(() => {});
  }, []);

  function load() {
    if (!forgeJobId) return;
    setLoading(true); setErr(null); setResult(null); setShowTrace(false);
    devGet<LoftDebugResponse>(`/loft-debug/${forgeJobId}`)
      .then(setResult)
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }

  const d = result?.debug;

  return (
    <div style={styles.panelBody}>
      <SectionHeading>Loft Debugger</SectionHeading>
      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 12 }}>
        Shows why the CadQuery loft is failing for hard_surface forge runs.
        The loft fallback costs ~5s every run — fix the root cause here.
      </div>

      <div style={styles.row}>
        <label style={styles.label}>Forge Job</label>
        <select
          style={{ ...styles.input, width: 320 }}
          value={forgeJobId}
          onChange={e => setForgeJobId(e.target.value)}
        >
          {jobs.map(j => (
            <option key={j.job_id} value={j.job_id}>
              {j.job_id.slice(0, 12)}… — {j.modified_iso.replace("T", " ").replace("Z", "")}
            </option>
          ))}
        </select>
        <button style={styles.btn} onClick={load} disabled={loading || !forgeJobId}>
          {loading ? "Loading…" : "Inspect"}
        </button>
      </div>

      {err && <ErrorBox msg={err} />}

      {result && (
        <>
          {result.loft_succeeded && !result.fallback_ply_exists ? (
            <div style={{ ...styles.statusBar, borderColor: "var(--status-success)", color: "var(--status-success)", background: "rgba(46,204,113,0.08)", marginTop: 12 }}>
              ✓ Loft succeeded for this job — no fallback was triggered.
            </div>
          ) : (
            <>
              <div style={{ ...styles.statusBar, borderColor: "var(--status-error)", color: "var(--status-error)", background: "rgba(231,76,60,0.08)", marginTop: 12 }}>
                ✗ Loft FAILED — fell back to organic visual hull reconstruction.
                {result.fallback_ply_exists && " (mesh_raw_fallback.ply exists)"}
              </div>

              {d && (
                <>
                  <SectionHeading style={{ marginTop: 16 }}>Failure Details</SectionHeading>
                  <div style={{ ...styles.errorBox, marginBottom: 8 }}>
                    <strong>Exception:</strong> {d.exception}
                  </div>
                  <div style={styles.grid2}>
                    <KV label="Timestamp" value={d.timestamp} />
                    <KV label="Fallback Path" value={d.fallback} />
                  </div>

                  <SectionHeading style={{ marginTop: 16 }}>Multiview Stats at Failure</SectionHeading>
                  <div style={styles.grid2}>
                    <KV label="Views Analyzed" value={d.multiview_stats.views_analyzed.join(", ")} ok={d.multiview_stats.views_analyzed.length >= 3} />
                    <KV label="Z-Depth Shape" value={d.multiview_stats.z_depth_shape.join(" × ")} />
                    <KV label="Z-Depth Min" value={d.multiview_stats.z_depth_min.toFixed(4)} />
                    <KV label="Z-Depth Max" value={d.multiview_stats.z_depth_max.toFixed(4)} ok={d.multiview_stats.z_depth_max > 0.01} />
                    <KV label="Non-Zero Z%" value={`${d.multiview_stats.z_depth_nonzero_pct.toFixed(1)}%`} ok={d.multiview_stats.z_depth_nonzero_pct > 5} />
                    {Object.entries(d.multiview_stats.asymmetry).map(([k, v]) => (
                      <KV key={k} label={`Asymmetry (${k})`} value={v.toFixed(3)} ok={v < 0.5} />
                    ))}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <button style={styles.btnSm} onClick={() => setShowTrace(t => !t)}>
                      {showTrace ? "▼ Hide Traceback" : "▶ Show Full Traceback"}
                    </button>
                  </div>
                  {showTrace && (
                    <pre style={{ ...styles.terminal, height: "auto", maxHeight: 300, marginTop: 8, fontSize: 10, color: "var(--status-error)" }}>
                      {d.traceback}
                    </pre>
                  )}

                  <div style={styles.warnBox}>
                    <strong>Next steps:</strong> If Z-Depth Max is near 0, the depth estimation produced a flat map — check that you have side views (right/left). If Z-Depth is fine but loft still fails, the contour ring extraction is failing (too few contours for ThruSections). Increase n_rings or check the depth map quality in the multiview logs.
                  </div>
                </>
              )}

              {!d && result.fallback_ply_exists && (
                <div style={styles.warnBox}>
                  Fallback PLY exists (loft failed) but loft_debug.json was not written — this job ran before the debug instrumentation was added. Re-run forge to get full details.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Profile visualiser ──────────────────────────────────────── */
function ProfileView({ profile }: { profile: Profile }) {
  const top = profile.sections.filter(s => s.depth === 0);
  const subs = profile.sections.filter(s => s.depth > 0);

  return (
    <div>
      <div style={{ ...styles.tag, marginBottom: 8 }}>
        Job {profile.job_id.slice(0, 8)}… · Route: {profile.route} · Total: {fmtMs(profile.total_ms)}
      </div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Step</th>
            <th style={styles.th}>Time</th>
            <th style={styles.th}>% Total</th>
            <th style={styles.th}>Bar</th>
          </tr>
        </thead>
        <tbody>
          {top.map(s => (
            <tr key={s.section}>
              <td style={styles.td}><code style={styles.code}>{s.section}</code></td>
              <td style={{ ...styles.td, fontVariantNumeric: "tabular-nums" }}>{fmtMs(s.duration_ms)}</td>
              <td style={{ ...styles.td, color: s.pct_total > 40 ? "var(--status-warn)" : "var(--text-primary)" }}>
                {s.pct_total.toFixed(1)}%{s.pct_total > 40 ? " ⚠" : ""}
              </td>
              <td style={styles.td}><BarCell pct={s.pct_total} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {subs.length > 0 && (
        <>
          <div style={{ ...styles.tag, marginTop: 12, marginBottom: 6 }}>Sub-operations</div>
          <table style={styles.table}>
            <tbody>
              {subs.map(s => (
                <tr key={s.section}>
                  <td style={{ ...styles.td, paddingLeft: `${s.depth * 16}px`, color: "var(--text-secondary)" }}>
                    <code style={styles.code}>{s.section}</code>
                  </td>
                  <td style={{ ...styles.td, fontVariantNumeric: "tabular-nums" }}>{fmtMs(s.duration_ms)}</td>
                  <td style={styles.td}>{s.pct_total.toFixed(1)}%</td>
                  <td style={styles.td}><BarCell pct={s.pct_total} dim /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function BarCell({ pct, dim = false }: { pct: number; dim?: boolean }) {
  return (
    <div style={{ width: 120, height: 6, background: "var(--bg-border)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{
        width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 3,
        background: dim ? "var(--steel-shine)" : pct > 40 ? "var(--status-warn)" : "var(--yellow-core)",
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function DiskBar({ used, total, free }: { used: number; total: number; free: number }) {
  const pct = (used / total) * 100;
  const warn = pct > 80;
  return (
    <div>
      <div style={{ width: "100%", height: 8, background: "var(--bg-border)", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: warn ? "var(--status-warn)" : "var(--yellow-core)", borderRadius: 4 }} />
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
        <span>Used: {used} GB</span>
        <span>Free: {free} GB</span>
        <span>Total: {total} GB</span>
      </div>
    </div>
  );
}

/* ── Micro components ────────────────────────────────────────── */
function SectionHeading({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...styles.sectionHeading, ...style }}>{children}</div>;
}
function Muted({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ color: "var(--text-muted)", fontSize: 13, ...style }}>{children}</div>;
}
function Spinner() {
  return <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading…</div>;
}
function ErrorBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div style={styles.errorBox}>
      <strong>Error:</strong> {msg}
      {onRetry && <button style={{ ...styles.btnSm, marginLeft: 8 }} onClick={onRetry}>Retry</button>}
    </div>
  );
}
function KV({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const color = ok === undefined ? "var(--text-primary)" : ok ? "var(--status-success)" : "var(--status-error)";
  return (
    <div style={styles.kv}>
      <span style={{ color: "var(--text-secondary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ color, fontSize: 12, fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}
function Code({ children }: { children: React.ReactNode }) {
  return <pre style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{children}</pre>;
}

/* ── Formatters ──────────────────────────────────────────────── */
function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  if (ms >= 1_000)  return `${(ms / 1_000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}
function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b >= 1_000)     return `${(b / 1_000).toFixed(0)} KB`;
  return `${b} B`;
}

/* ── Styles ──────────────────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100%",
    overflow: "hidden",
    background: "var(--bg-void)",
    fontFamily: "var(--font-sans)",
    fontSize: 13,
    color: "var(--text-primary)",
  },
  sidebar: {
    width: 140,
    background: "var(--bg-base)",
    borderRight: "1px solid var(--bg-border)",
    display: "flex",
    flexDirection: "column",
    padding: "12px 0",
    flexShrink: 0,
  },
  sidebarTitle: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "var(--text-muted)",
    padding: "0 12px 12px",
  },
  navBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "8px 12px",
    background: "transparent",
    border: "none",
    borderLeft: "2px solid transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textAlign: "left" as const,
    transition: "color 120ms, border-color 120ms, background 120ms",
  },
  navBtnActive: {
    color: "var(--yellow-core)",
    borderLeftColor: "var(--yellow-core)",
    background: "var(--bg-raised)",
  },
  docsLink: {
    fontSize: 10,
    color: "var(--text-muted)",
    textDecoration: "none",
    padding: "8px 12px",
    display: "block",
  },
  content: {
    flex: 1,
    overflow: "auto",
  },
  panelBody: {
    padding: "var(--space-5)",
    maxWidth: 900,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "var(--yellow-core)",
    marginBottom: 8,
    paddingBottom: 4,
    borderBottom: "1px solid var(--bg-border)",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 8,
    marginBottom: 4,
  },
  kv: {
    background: "var(--bg-raised)",
    border: "1px solid var(--bg-border)",
    borderRadius: 4,
    padding: "6px 10px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 12,
  },
  th: {
    textAlign: "left" as const,
    padding: "4px 8px",
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 600,
    borderBottom: "1px solid var(--bg-border)",
  },
  td: {
    padding: "5px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    verticalAlign: "middle" as const,
  },
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--text-primary)",
  },
  tag: {
    fontSize: 11,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap" as const,
  },
  rowSpread: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap" as const,
  },
  input: {
    background: "var(--bg-raised)",
    border: "1px solid var(--bg-border)",
    borderRadius: 4,
    padding: "4px 8px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    width: 140,
    outline: "none",
  },
  btn: {
    padding: "5px 14px",
    background: "var(--yellow-dim)",
    border: "1px solid var(--yellow-core)",
    borderRadius: 4,
    color: "var(--yellow-bright)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "default",
  },
  btnSm: {
    padding: "3px 10px",
    background: "var(--bg-raised)",
    border: "1px solid var(--bg-border)",
    borderRadius: 4,
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 11,
  },
  terminal: {
    marginTop: 8,
    background: "var(--bg-void)",
    border: "1px solid var(--bg-border)",
    borderRadius: 4,
    padding: "10px 12px",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    lineHeight: 1.6,
    height: 400,
    overflowY: "auto" as const,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
  },
  statusBar: {
    padding: "8px 12px",
    borderRadius: 4,
    border: "1px solid",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 8,
  },
  errorBox: {
    padding: "10px 14px",
    background: "rgba(231,76,60,0.1)",
    border: "1px solid var(--status-error)",
    borderRadius: 4,
    color: "var(--status-error)",
    fontSize: 12,
  },
  warnBox: {
    padding: "8px 12px",
    background: "rgba(243,156,18,0.08)",
    border: "1px solid var(--status-warn)",
    borderRadius: 4,
    color: "var(--status-warn)",
    fontSize: 12,
    marginTop: 8,
  },
  jobList: {
    width: 220,
    borderRight: "1px solid var(--bg-border)",
    overflowY: "auto" as const,
    flexShrink: 0,
  },
  listHeader: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "var(--text-muted)",
    padding: "10px 12px 6px",
    borderBottom: "1px solid var(--bg-border)",
  },
  jobRow: {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.03)",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left" as const,
    fontSize: 11,
  },
  jobRowActive: {
    background: "var(--bg-raised)",
    borderLeft: "2px solid var(--yellow-core)",
  },
  jobId: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-secondary)",
  },
  jobMeta: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 2,
    fontSize: 10,
  },
  badge: {
    display: "inline-block",
    marginTop: 3,
    padding: "1px 5px",
    background: "var(--yellow-dim)",
    border: "1px solid var(--yellow-core)",
    borderRadius: 2,
    fontSize: 9,
    color: "var(--yellow-core)",
    fontFamily: "var(--font-mono)",
  },
  fileGrid: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 4,
    marginBottom: 4,
  },
  heroBox: {
    background: "var(--bg-raised)",
    border: "1px solid var(--yellow-core)",
    borderRadius: 8,
    padding: "16px 20px",
    marginBottom: 4,
  },
  fileChip: {
    padding: "2px 8px",
    background: "var(--bg-raised)",
    border: "1px solid var(--bg-border)",
    borderRadius: 3,
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--text-secondary)",
  },
};
