import { useState, useEffect, useCallback } from 'react';
import DiagnosticsPanel from './DiagnosticsPanel.jsx';

const VERSION = 'v1.1';

// Claude Desktop MCP config snippet
function buildMcpConfig() {
  return JSON.stringify({
    mcpServers: {
      iterforge: {
        url: 'http://localhost:3000/mcp/sse',
      },
    },
  }, null, 2);
}

// Engine metadata for display
const ENGINE_META = {
  godot:  { label: 'Godot',   url: 'https://godotengine.org/download/' },
  unity:  { label: 'Unity',   url: 'https://unity.com/download' },
  unreal: { label: 'Unreal Engine', url: 'https://www.unrealengine.com/download' },
  pygame: { label: 'pygame',  url: 'https://www.pygame.org/download.shtml' },
};
const ALL_ENGINES = Object.keys(ENGINE_META);

export default function SettingsPanel({ models = [], defaultModel = '', onRestartTutorial }) {
  const [blenderPath,     setBlenderPath]     = useState('');
  const [savedModel,      setSavedModel]      = useState(defaultModel);
  const [storageDir,      setStorageDir]      = useState('');
  const [saved,           setSaved]           = useState(false);
  const [statusInfo,      setStatusInfo]      = useState(null);
  const [activeTab,       setActiveTab]       = useState('settings');  // 'settings' | 'diagnostics' | 'integrations'
  const [detectedEngines, setDetectedEngines] = useState(null);   // null = loading, [] = none
  const [enginesLoading,  setEnginesLoading]  = useState(false);
  const [mcpCopied,       setMcpCopied]       = useState(false);
  const [gpuMode,         setGpuMode]         = useState('local');   // 'local' | 'cloud'
  const [cloudUrl,        setCloudUrl]        = useState('');
  const [gpuSaved,        setGpuSaved]        = useState(false);
  const [gpuSaving,       setGpuSaving]       = useState(false);

  // Load persisted settings on mount
  useEffect(() => {
    const stored = (() => { try { return JSON.parse(localStorage.getItem('iterforge_settings') ?? '{}'); } catch { return {}; } })();
    if (stored.blenderPath) setBlenderPath(stored.blenderPath);
    if (stored.defaultModel) setSavedModel(stored.defaultModel);
    if (stored.storageDir) setStorageDir(stored.storageDir);
  }, []);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatusInfo).catch(() => {});
    fetch('/api/settings/comfy-mode').then(r => r.json()).then(d => {
      setGpuMode(d.mode ?? 'local');
      setCloudUrl(d.cloudUrl ?? '');
    }).catch(() => {});
  }, []);

  async function handleGpuSave() {
    setGpuSaving(true);
    try {
      await fetch('/api/settings/comfy-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: gpuMode, cloudUrl }),
      });
      setGpuSaved(true);
      setTimeout(() => setGpuSaved(false), 2000);
    } catch {}
    setGpuSaving(false);
  }

  // Load engine detection when Integrations tab is first opened
  useEffect(() => {
    if (activeTab === 'integrations' && detectedEngines === null && !enginesLoading) {
      setEnginesLoading(true);
      fetch('/api/export/engines')
        .then(r => r.json())
        .then(data => { setDetectedEngines(data.detected ?? []); setEnginesLoading(false); })
        .catch(() => { setDetectedEngines([]); setEnginesLoading(false); });
    }
  }, [activeTab, detectedEngines, enginesLoading]);

  function handleCopyMcpConfig() {
    navigator.clipboard.writeText(buildMcpConfig()).then(() => {
      setMcpCopied(true);
      setTimeout(() => setMcpCopied(false), 2000);
    }).catch(() => {});
  }

  function handleSave() {
    try {
      const settings = { blenderPath, defaultModel: savedModel, storageDir };
      localStorage.setItem('iterforge_settings', JSON.stringify(settings));
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-surface-700/50 shrink-0">
        {[['settings', '⚙ Settings'], ['diagnostics', '🔬 Diagnostics'], ['integrations', '🔌 Integrations']].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === id
                ? 'text-slate-200 border-b-2 border-brand-500 -mb-px'
                : 'text-slate-500 hover:text-slate-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Diagnostics tab */}
      {activeTab === 'diagnostics' && (
        <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
          <DiagnosticsPanel />
        </div>
      )}

      {/* Integrations tab */}
      {activeTab === 'integrations' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-5">

          {/* MCP Connection */}
          <Section title="MCP Connection" icon="🔗">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-xs font-bold ${statusInfo?.server === 'ok' ? 'text-green-400' : 'text-slate-500'}`}>
                {statusInfo?.server === 'ok' ? '● Active' : '○ Server offline'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mb-2">
              Paste this into Claude Desktop to connect Inter-Forge as an MCP tool server:
            </p>
            <pre className="text-[10px] text-slate-300 bg-surface-900/70 border border-surface-600/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {buildMcpConfig()}
            </pre>
            <button
              onClick={handleCopyMcpConfig}
              className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                mcpCopied
                  ? 'bg-green-700 border-green-600 text-white'
                  : 'bg-surface-700 border-surface-600/50 text-slate-300 hover:bg-surface-600'
              }`}>
              {mcpCopied ? '✓ Copied' : 'Copy Config'}
            </button>
            <div className="mt-3 p-2.5 rounded-lg bg-surface-900/50 border border-surface-600/30">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                <span className="text-slate-400 font-semibold">Setup:</span> Open Claude Desktop
                → Settings → Developer → Edit Config → paste the JSON above → restart Claude Desktop.
              </p>
            </div>
          </Section>

          {/* Game Engine Detection */}
          <Section title="Game Engines" icon="🎮">
            {enginesLoading && (
              <p className="text-[10px] text-slate-500">Scanning for installed engines…</p>
            )}
            {!enginesLoading && (
              <div className="flex flex-col gap-2">
                {ALL_ENGINES.map(engine => {
                  const found = detectedEngines?.includes(engine);
                  const meta  = ENGINE_META[engine];
                  return (
                    <div key={engine} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${found ? 'text-green-400' : 'text-slate-600'}`}>
                          {found ? '✓' : '○'}
                        </span>
                        <span className={`text-[11px] font-medium ${found ? 'text-slate-200' : 'text-slate-500'}`}>
                          {meta.label}
                        </span>
                      </div>
                      {found ? (
                        <span className="text-[10px] text-green-500 bg-green-900/20 border border-green-800/30 px-1.5 py-0.5 rounded">
                          Detected
                        </span>
                      ) : (
                        <a
                          href={meta.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-slate-500 hover:text-brand-400 underline underline-offset-2 transition-colors">
                          Not found — download
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {!enginesLoading && detectedEngines !== null && (
              <button
                onClick={() => { setDetectedEngines(null); setEnginesLoading(false); }}
                className="mt-2 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
                Re-scan
              </button>
            )}
          </Section>

        </div>
      )}

      {/* Settings tab */}
      {activeTab === 'settings' && (<>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-sm font-semibold">Settings</span>
          <span className="text-[10px] text-slate-600 font-mono ml-auto">{VERSION}</span>
        </div>

        {/* GPU Backend */}
        <Section title="GPU Backend" icon="⚡">
          <div className="flex gap-2 mb-3">
            {['local', 'cloud'].map(m => (
              <button key={m} onClick={() => setGpuMode(m)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  gpuMode === m
                    ? 'bg-brand-600 border-brand-500 text-white'
                    : 'bg-surface-800 border-surface-600/40 text-slate-400 hover:text-slate-200'
                }`}>
                {m === 'local' ? '🖥 Local' : '☁ Cloud GPU'}
              </button>
            ))}
          </div>
          {gpuMode === 'cloud' && (
            <div className="mb-2">
              <p className="text-[10px] text-slate-500 mb-1">Cloud ComfyUI URL (e.g. serveo / cloudflare tunnel):</p>
              <input
                type="text"
                value={cloudUrl}
                onChange={e => setCloudUrl(e.target.value)}
                placeholder="https://xxxx.serveousercontent.com"
                className="w-full bg-surface-900/60 border border-surface-600/40 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500/60"
              />
            </div>
          )}
          <button onClick={handleGpuSave} disabled={gpuSaving}
            className={`w-full py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              gpuSaved
                ? 'bg-green-700 border-green-600 text-white'
                : 'bg-surface-700 border-surface-600/50 text-slate-300 hover:bg-surface-600'
            }`}>
            {gpuSaved ? '✓ Saved' : gpuSaving ? 'Saving…' : 'Apply'}
          </button>
          <p className="text-[10px] text-slate-600 mt-1">
            {gpuMode === 'local' ? 'Using local ComfyUI on 127.0.0.1:8188' : 'Generations run on cloud GPU — meshing still local'}
          </p>
        </Section>

        {/* Default Model */}
        {models.length > 0 && (
          <Section title="Default Model" icon="🎨">
            <select
              value={savedModel}
              onChange={e => setSavedModel(e.target.value)}
              className="w-full bg-surface-900/60 border border-surface-600/40 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-brand-500/60">
              <option value="">— system default —</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="text-[10px] text-slate-600 mt-1">Used as the default for all new generations.</p>
          </Section>
        )}

        {/* Blender Path */}
        <Section title="Blender Path" icon="⬡">
          <input
            type="text"
            value={blenderPath}
            onChange={e => setBlenderPath(e.target.value)}
            placeholder="C:\Program Files\Blender Foundation\Blender 4.x\blender.exe"
            className="w-full bg-surface-900/60 border border-surface-600/40 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500/60"
          />
          <p className="text-[10px] text-slate-600 mt-1">
            Leave blank to auto-detect. Required for 3D texture workflow (Phase 25).
          </p>
          {blenderPath && (
            <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 border border-green-700/30 text-green-500">
              Path set — will be validated on first 3D job
            </span>
          )}
        </Section>

        {/* Storage Location */}
        <Section title="Output Storage" icon="📁">
          <input
            type="text"
            value={storageDir}
            onChange={e => setStorageDir(e.target.value)}
            placeholder="(default: ~/.iterforge/assets/generated)"
            className="w-full bg-surface-900/60 border border-surface-600/40 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500/60"
          />
          <p className="text-[10px] text-slate-600 mt-1">Custom path for generated assets. Restart required after changing.</p>
        </Section>

        {/* Status info */}
        {statusInfo && (
          <Section title="System Status" icon="⚙">
            <div className="flex flex-col gap-1.5">
              <StatusRow label="Server" value={statusInfo.server === 'ok' ? 'Running' : statusInfo.server} ok={statusInfo.server === 'ok'} />
              <StatusRow label="ComfyUI" value={statusInfo.comfyui === 'ok' ? 'Connected' : statusInfo.comfyui === 'offline' ? 'Offline' : statusInfo.comfyui} ok={statusInfo.comfyui === 'ok'} />
              <StatusRow
                label="Blender"
                value={statusInfo.blenderInstalled
                  ? `v${statusInfo.blenderVersion ?? '4.2'} — managed`
                  : 'Not installed — run Setup'}
                ok={statusInfo.blenderInstalled}
              />
              <StatusRow
                label="Inkscape"
                value={statusInfo.inkscapeInstalled
                  ? `v${statusInfo.inkscapeVersion ?? '1.4'} — managed`
                  : 'Not installed — run Setup'}
                ok={statusInfo.inkscapeInstalled}
              />
              {statusInfo.setup && (
                <StatusRow label="Setup" value={statusInfo.setup.message ?? statusInfo.setup.state} ok={statusInfo.setup.state === 'done'} />
              )}
            </div>
          </Section>
        )}

        {/* Version info */}
        <Section title="About" icon="ℹ">
          <div className="flex flex-col gap-1 text-[10px]">
            <Row label="Version" value={VERSION} />
            <Row label="Engine" value="ComfyUI + Juggernaut XL v9" />
            <Row label="Renderer" value="Sharp (sprite sheet compositing)" />
            <Row label="Frontend" value="React + Tailwind CSS" />
          </div>
        </Section>

        {/* Help */}
        <Section title="Help" icon="❓">
          <button
            onClick={onRestartTutorial}
            className="w-full py-2 px-3 rounded-lg text-xs font-medium border transition-all
              bg-indigo-600/10 border-indigo-500/30 text-indigo-300
              hover:bg-indigo-600/20 hover:border-indigo-500/50">
            ✦ Restart Tutorial Walkthrough
          </button>
          <p className="text-[10px] text-slate-600 mt-1">
            Replay the step-by-step guide to Inter-Forge features.
          </p>
        </Section>

      </div>

      {/* Save button */}
      <div className="shrink-0 px-4 py-3 border-t border-surface-700/60 bg-surface-800">
        <button
          onClick={handleSave}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
            saved
              ? 'bg-green-700 text-white'
              : 'bg-surface-700 hover:bg-surface-600 text-slate-200 border border-surface-600/50'
          }`}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>
      </>)}  {/* end settings tab */}
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px]">{icon}</span>
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function StatusRow({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`text-[10px] font-medium ${ok ? 'text-green-400' : 'text-yellow-500'}`}>{value}</span>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-400">{value}</span>
    </div>
  );
}
