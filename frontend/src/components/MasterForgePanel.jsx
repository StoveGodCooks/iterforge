import { useState, useEffect, useRef } from 'react';
import ModelViewer from './ModelViewer.jsx';

const ASSET_TYPES = [
  { id: 'sword',     label: 'Sword',     icon: '⚔' },
  { id: 'axe',       label: 'Axe',       icon: '🪓' },
  { id: 'dagger',    label: 'Dagger',    icon: '🗡' },
  { id: 'staff',     label: 'Staff',     icon: '🪄' },
  { id: 'shield',    label: 'Shield',    icon: '🛡' },
  { id: 'armor',     label: 'Armor',     icon: '⚙' },
  { id: 'ring',      label: 'Ring',      icon: '◯' },
  { id: 'furniture', label: 'Furniture', icon: '🪑' },
  { id: 'tree',      label: 'Tree',      icon: '🌲' },
];

const OUTPUT_TABS = ['Model', 'Zones', 'Log'];

const PRO_TOOLS = [
  { id: 'seamless',    label: 'Seamless/Tiling', icon: '⊞', desc: 'Tileable output for textures' },
  { id: 'transparent', label: 'Clean Cutout',    icon: '◻', desc: 'Isolated subject, no background' },
  { id: 'highdetail',  label: 'High Detail',     icon: '✦', desc: 'Maximum detail boost' },
  { id: 'gameready',   label: 'Game Ready',      icon: '⬡', desc: 'Optimized for game engine import' },
];

// ── Collapsible section header ────────────────────────────────────────────────
// main = yellow, sub = orange
function Section({ label, open, onToggle, sub = false, badge }) {
  const color = sub ? '#ff4d00' : '#ffcc00';
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 w-full text-[11px] font-semibold uppercase tracking-wider transition-colors"
      style={{ color, fontFamily: "'IBM Plex Mono', monospace" }}
    >
      <span className={`text-[9px] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{ background: 'rgba(255,77,0,0.2)', border: '1px solid rgba(255,77,0,0.4)', color: '#ff4d00' }}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ── Download button ───────────────────────────────────────────────────────────
function DownloadBtn({ href, label, ext }) {
  const style = ext === 'glb'
    ? { border: '1px solid rgba(255,204,0,0.6)', color: '#ffcc00' }
    : ext === 'stl'
    ? { border: '1px solid rgba(255,77,0,0.6)', color: '#ff4d00' }
    : { border: '1px solid rgba(96,165,250,0.6)', color: '#93c5fd' };
  return (
    <a href={href} download
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-80"
      style={{ fontFamily: "'IBM Plex Mono', monospace", ...style }}>
      ↓ {label}
    </a>
  );
}

// ── Zone card ─────────────────────────────────────────────────────────────────
function ZoneCard({ name, data }) {
  const colorMap = {
    blade:  '#ffcc00', guard: '#ff4d00', handle: '#60a5fa', pommel: '#c084fc', tip: 'rgba(255,204,0,0.5)',
  };
  const color = colorMap[name] ?? 'rgba(255,255,255,0.5)';
  return (
    <div className="p-3 rounded-lg space-y-1"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,204,0,0.1)' }}>
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] font-bold uppercase tracking-widest"
          style={{ fontFamily: "'IBM Plex Mono', monospace", color }}>{name}</span>
      </div>
      {data && (
        <div className="text-[10px] space-y-0.5" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#6b7280' }}>
          {data.slice_count != null && <div>slices: {data.slice_count}</div>}
          {data.avg_width   != null && <div>avg w: {data.avg_width.toFixed(3)}</div>}
          {data.avg_depth   != null && <div>avg d: {data.avg_depth.toFixed(3)}</div>}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MasterForgePanel({ sourceImage, onGenerated }) {
  const [assetType,    setAssetType]    = useState('sword');
  const [useMidas,     setUseMidas]     = useState(false);
  const [noLod,        setNoLod]        = useState(false);
  const [noDxf,        setNoDxf]        = useState(false);
  const [job,          setJob]          = useState(null);
  const [outputTab,    setOutputTab]    = useState('Model');
  const [pipelineOk,   setPipelineOk]   = useState(null);
  const [dragOver,     setDragOver]     = useState(false);
  const [localImage,   setLocalImage]   = useState(null);
  const [activeTools,  setActiveTools]  = useState(new Set());

  // Collapsible state — all open by default except pro tools
  const [showAssets,   setShowAssets]   = useState(true);
  const [showOptions,  setShowOptions]  = useState(true);
  const [showProTools, setShowProTools] = useState(false);
  const [showOutput,   setShowOutput]   = useState(true);

  const pollTimer   = useRef(null);
  const fileInputRef = useRef(null);

  function toggleTool(id) {
    setActiveTools(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  useEffect(() => {
    fetch('/api/masterforge/status')
      .then(r => r.json())
      .then(d => setPipelineOk(d.available))
      .catch(() => setPipelineOk(false));
  }, []);

  useEffect(() => () => clearInterval(pollTimer.current), []);

  const displayImage = localImage ?? (sourceImage?.url
    ? sourceImage
    : sourceImage?.filename
      ? { url: `/api/generate/image/${sourceImage.filename}`, filename: sourceImage.filename }
      : null);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    setLocalImage({ url: URL.createObjectURL(file), filename: file.name, file });
  }

  function handleFileInput(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLocalImage({ url: URL.createObjectURL(file), filename: file.name, file });
  }

  function startPolling(jobId) {
    clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/masterforge/job/${jobId}`);
        const d = await r.json();
        setJob(prev => ({ ...prev, ...d }));
        if (d.status === 'completed' || d.status === 'failed') {
          clearInterval(pollTimer.current);
          if (d.status === 'completed' && d.result) onGenerated?.(d.result);
        }
      } catch {}
    }, 1200);
  }

  async function handleGenerate() {
    if (!displayImage) return;
    clearInterval(pollTimer.current);
    setJob({ status: 'submitting', progress: 'Sending to pipeline…' });
    setOutputTab('Model');
    try {
      let imageFilename = displayImage.filename;
      if (localImage?.file) {
        const form = new FormData();
        form.append('image', localImage.file);
        const up = await fetch('/api/masterforge/upload-image', { method: 'POST', body: form });
        if (up.ok) { const ud = await up.json(); imageFilename = ud.filename ?? imageFilename; }
      }
      const r = await fetch('/api/masterforge/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageFilename, assetType, useMidas, noLod, noDxf }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Request failed');
      setJob({ jobId: d.jobId, status: 'running', progress: 'Pipeline started…' });
      startPolling(d.jobId);
    } catch (err) {
      setJob({ status: 'failed', error: err.message });
    }
  }

  const isRunning   = job?.status === 'running' || job?.status === 'submitting';
  const isCompleted = job?.status === 'completed';
  const isFailed    = job?.status === 'failed';
  const result      = job?.result;
  const isLockStuck = isFailed && job?.error?.includes('already running');

  async function resetLock() {
    await fetch('/api/masterforge/reset-lock', { method: 'POST' });
    setJob(null);
  }
  const mfId        = result?.id ?? result?.jobId;
  const modelUrl    = mfId && result?.glbFile ? `/api/masterforge/model/${mfId}/${result.glbFile}` : null;
  const stlUrl      = mfId && result?.stlFile ? `/api/masterforge/model/${mfId}/${result.stlFile}` : null;
  const dxfUrl      = mfId && result?.dxfFile ? `/api/masterforge/model/${mfId}/${result.dxfFile}` : null;
  const zones       = result?.zonesSummary ?? null;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-80 shrink-0 flex flex-col overflow-hidden border-r"
        style={{ background: 'rgba(18,18,18,0.9)', borderColor: 'rgba(255,204,0,0.12)' }}>

        {/* Scrollable sections */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">

          {/* ── Pipeline status header ── */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-widest"
              style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#ffcc00' }}>
              MasterForge
            </span>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                pipelineOk === null ? 'bg-slate-500 animate-pulse' :
                pipelineOk ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span className="text-[10px]"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#4b5563' }}>
                {pipelineOk === null ? 'checking…' : pipelineOk ? 'ready' : 'env missing'}
              </span>
            </div>
          </div>

          {/* ── Source image ── */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2"
              style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#ffcc00' }}>
              Source Image
            </label>

            {displayImage ? (
              <div className="relative group rounded-lg overflow-hidden"
                style={{ border: '2px solid rgba(255,204,0,0.4)' }}>
                <img src={displayImage.url} alt="source"
                  className="w-full object-contain"
                  style={{ maxHeight: '160px', background: 'rgba(255,255,255,0.02)' }} />
                <button onClick={() => setLocalImage(null)}
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity
                             w-5 h-5 rounded flex items-center justify-center text-[10px]"
                  style={{ background: 'rgba(0,0,0,0.8)', color: '#ff4d00', border: '1px solid rgba(255,77,0,0.5)' }}>
                  ✕
                </button>
                <div className="px-2 py-1 text-[10px] truncate"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#4b5563' }}>
                  {displayImage.filename ?? 'image'}
                </div>
              </div>
            ) : (
              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-lg cursor-pointer transition-all"
                style={{
                  height: '110px',
                  border: `1px dashed ${dragOver ? 'rgba(255,204,0,0.7)' : 'rgba(255,204,0,0.25)'}`,
                  background: dragOver ? 'rgba(255,204,0,0.04)' : 'transparent',
                }}>
                <span className="text-xl" style={{ opacity: 0.3, color: '#ffcc00' }}>⬡</span>
                <span className="text-[10px]"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#6b7280' }}>
                  Drop image or click to upload
                </span>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
          </div>

          {/* ── Asset Type — collapsible, yellow ── */}
          <div>
            <Section label="Asset Type" open={showAssets} onToggle={() => setShowAssets(v => !v)} />
            {showAssets && (
              <div className="mt-3 grid grid-cols-3 gap-1">
                {ASSET_TYPES.map(t => (
                  <button key={t.id} onClick={() => setAssetType(t.id)}
                    className="px-1.5 py-1.5 rounded-lg text-[10px] font-medium border transition-all"
                    style={{
                      border: assetType === t.id ? '1px solid rgba(255,77,0,0.7)' : '1px solid rgba(255,255,255,0.08)',
                      background: assetType === t.id ? 'rgba(255,77,0,0.15)' : 'transparent',
                      color: assetType === t.id ? '#ff4d00' : '#9ca3af',
                    }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Options — collapsible, yellow ── */}
          <div>
            <Section label="Options" open={showOptions} onToggle={() => setShowOptions(v => !v)} />
            {showOptions && (
              <div className="mt-3 flex flex-col gap-3">
                {[
                  [useMidas, setUseMidas, 'Neural depth (MiDaS)'],
                  [noLod,    setNoLod,    'Skip LOD generation'],
                  [noDxf,    setNoDxf,    'Skip DXF export'],
                ].map(([val, setter, lbl]) => (
                  <label key={lbl} className="flex items-center gap-2 cursor-pointer select-none">
                    <div onClick={() => setter(v => !v)}
                      className="w-8 h-4 rounded-full relative transition-colors shrink-0"
                      style={{ background: val ? '#ff4d00' : 'rgba(255,255,255,0.1)' }}>
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-transform ${val ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-[11px]"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#6b7280' }}>
                      {lbl}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── Pro Tools — collapsible, orange (subset) ── */}
          <div>
            <Section label="Pro Tools" open={showProTools} onToggle={() => setShowProTools(v => !v)}
              sub badge={activeTools.size} />
            {showProTools && (
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {PRO_TOOLS.map(tool => (
                  <button key={tool.id} onClick={() => toggleTool(tool.id)}
                    title={tool.desc}
                    className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-medium border transition-all text-left"
                    style={{
                      border: activeTools.has(tool.id) ? '1px solid rgba(255,77,0,0.6)' : '1px solid rgba(255,255,255,0.08)',
                      background: activeTools.has(tool.id) ? 'rgba(255,77,0,0.12)' : 'rgba(255,255,255,0.02)',
                      color: activeTools.has(tool.id) ? '#ff4d00' : '#9ca3af',
                    }}>
                    <span className="text-[11px] shrink-0">{tool.icon}</span>
                    <span className="leading-tight">{tool.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Output panel — collapsible, yellow ── */}
          <div>
            <Section label="Output" open={showOutput} onToggle={() => setShowOutput(v => !v)} />
            {showOutput && job && (
              <div className="mt-3 rounded-lg p-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,204,0,0.1)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isCompleted ? 'bg-green-500' : isFailed ? 'bg-red-500' : 'bg-yellow-400 animate-pulse'
                  }`} />
                  <span className="text-[10px] uppercase tracking-wider"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: isCompleted ? '#22c55e' : isFailed ? '#ef4444' : '#ffcc00',
                    }}>
                    {isCompleted ? 'Complete' : isFailed ? 'Failed' : 'Running'}
                  </span>
                </div>
                {isRunning && job.progress && (
                  <p className="text-[10px] leading-relaxed"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#6b7280' }}>
                    {job.progress}
                  </p>
                )}
                {isFailed && job.error && (
                  <div>
                    <p className="text-[10px] text-red-400 leading-relaxed break-words"
                      style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {job.error}
                    </p>
                    {isLockStuck && (
                      <button onClick={resetLock}
                        className="mt-2 px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-80"
                        style={{ background: 'rgba(255,77,0,0.15)', border: '1px solid rgba(255,77,0,0.5)', color: '#ff4d00', fontFamily: "'IBM Plex Mono', monospace" }}>
                        ↺ Clear Lock &amp; Retry
                      </button>
                    )}
                  </div>
                )}
                {isCompleted && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {modelUrl && <DownloadBtn href={modelUrl} label="GLB" ext="glb" />}
                    {stlUrl   && <DownloadBtn href={stlUrl}   label="STL" ext="stl" />}
                    {dxfUrl   && <DownloadBtn href={dxfUrl}   label="DXF" ext="dxf" />}
                  </div>
                )}
              </div>
            )}
            {showOutput && !job && (
              <p className="mt-2 text-[10px]"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#374151' }}>
                No job yet.
              </p>
            )}
          </div>

        </div>{/* end scrollable */}

        {/* ── Forge Mesh button — pinned bottom ── */}
        <div className="shrink-0 px-4 py-3 border-t" style={{ borderColor: 'rgba(255,204,0,0.12)' }}>
          {isRunning ? (
            <div className="w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm"
              style={{ background: 'rgba(255,255,255,0.05)', color: '#6b7280' }}>
              <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
              </svg>
              <span className="text-xs">{job?.progress ?? 'Forging…'}</span>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!displayImage || pipelineOk === false}
              className="w-full py-3 rounded-xl font-semibold text-sm tracking-wide transition-all"
              style={{
                background: (!displayImage || pipelineOk === false)
                  ? 'rgba(255,255,255,0.05)'
                  : 'linear-gradient(to right, #ffcc00, #ff9900)',
                color: (!displayImage || pipelineOk === false) ? '#4b5563' : '#000000',
                cursor: (!displayImage || pipelineOk === false) ? 'not-allowed' : 'pointer',
                fontFamily: "'Syne', system-ui, sans-serif",
              }}>
              ⬡ Forge Mesh
            </button>
          )}
        </div>
      </aside>

      {/* ── Main output area ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Tab bar */}
        <div className="flex items-stretch shrink-0"
          style={{ height: '42px', borderBottom: '1px solid rgba(255,204,0,0.12)', background: 'rgba(18,18,18,0.6)' }}>
          {OUTPUT_TABS.map(t => (
            <button key={t} onClick={() => setOutputTab(t)}
              className="px-5 text-[11px] font-semibold uppercase tracking-wider transition-all border-b-2"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                color: outputTab === t ? '#ffcc00' : '#4b5563',
                borderBottomColor: outputTab === t ? '#ffcc00' : 'transparent',
                background: 'transparent',
              }}>
              {t}
            </button>
          ))}

          {isCompleted && (
            <div className="ml-auto flex items-center gap-2 pr-5">
              {modelUrl && <DownloadBtn href={modelUrl} label="GLB" ext="glb" />}
              {stlUrl   && <DownloadBtn href={stlUrl}   label="STL" ext="stl" />}
              {dxfUrl   && <DownloadBtn href={dxfUrl}   label="DXF" ext="dxf" />}
            </div>
          )}
        </div>

        {/* Output content */}
        <div className="flex-1 overflow-auto relative">

          {/* Model tab */}
          {outputTab === 'Model' && (
            <div className="w-full h-full flex items-center justify-center">
              {!job && (
                <div className="text-center space-y-3 select-none pointer-events-none">
                  <div className="text-6xl" style={{ opacity: 0.08, color: '#ffcc00' }}>⬡</div>
                  <p className="text-[13px] font-semibold"
                    style={{ fontFamily: "'Syne', system-ui", color: '#ffcc00', letterSpacing: '0.1em' }}>
                    MASTERFORGE PIPELINE
                  </p>
                  <p className="text-[11px] max-w-xs"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#374151' }}>
                    Load a source image, choose asset type, and hit Forge Mesh.
                  </p>
                  <p className="text-[10px]"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#374151' }}>
                    PNG → Mesh → UV → Texture → Export
                  </p>
                </div>
              )}

              {isRunning && (
                <div className="text-center space-y-4 select-none">
                  <div className="text-5xl animate-pulse" style={{ color: '#ffcc00', opacity: 0.4 }}>⬡</div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#ffcc00' }}>
                    Processing
                  </p>
                  <p className="text-[11px] max-w-xs"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#6b7280' }}>
                    {job.progress ?? 'Pipeline running…'}
                  </p>
                </div>
              )}

              {isFailed && (
                <div className="text-center space-y-3 select-none">
                  <div className="text-4xl" style={{ color: '#ef4444', opacity: 0.5 }}>⊗</div>
                  <p className="text-[11px] text-red-400"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    Pipeline failed — see Log tab for details.
                  </p>
                </div>
              )}

              {isCompleted && modelUrl && (
                <div className="w-full h-full flex flex-col">
                  <div className="flex-1 min-h-0 p-6">
                    <ModelViewer glbUrl={modelUrl} className="h-full rounded-xl" />
                  </div>
                  {result && (
                    <div className="flex items-center gap-4 px-5 py-2 shrink-0 text-[10px]"
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: '#4b5563',
                        borderTop: '1px solid rgba(255,204,0,0.1)',
                        background: 'rgba(18,18,18,0.6)',
                      }}>
                      <span style={{ color: '#ffcc00' }}>{result.assetType?.toUpperCase()}</span>
                      {result.glbFile && <span>{result.glbFile}</span>}
                      {result.lodFiles?.length > 0 && <span>{result.lodFiles.length} LODs</span>}
                    </div>
                  )}
                </div>
              )}

              {isCompleted && !modelUrl && (
                <p className="text-[11px]"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#4b5563' }}>
                  No GLB file found in output.
                </p>
              )}
            </div>
          )}

          {/* Zones tab */}
          {outputTab === 'Zones' && (
            <div className="p-6">
              {!isCompleted ? (
                <p className="text-[11px]"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#374151' }}>
                  Run the pipeline to see zone data.
                </p>
              ) : zones ? (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-4"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#ffcc00' }}>
                    Zone Graph
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(zones).map(([n, d]) => <ZoneCard key={n} name={n} data={d} />)}
                  </div>
                </div>
              ) : (
                <p className="text-[11px]"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#374151' }}>
                  No zone data in output.
                </p>
              )}
            </div>
          )}

          {/* Log tab */}
          {outputTab === 'Log' && (
            <div className="p-5">
              {!job ? (
                <p className="text-[11px]"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#374151' }}>
                  No job yet.
                </p>
              ) : (
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-all"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", color: isFailed ? '#fca5a5' : '#6b7280' }}>
                  {[
                    job.progress && `[progress] ${job.progress}`,
                    job.error    && `[error]    ${job.error}`,
                    job.stderr   && `[stderr]\n${job.stderr}`,
                    isCompleted  && '[status]   completed',
                  ].filter(Boolean).join('\n')}
                </pre>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
