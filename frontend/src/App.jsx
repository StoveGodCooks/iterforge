import { useState, useEffect, useRef } from 'react';
import GenerationPanel   from './components/GenerationPanel.jsx';
import SpriteSheetPanel  from './components/SpriteSheetPanel.jsx';
import SettingsPanel     from './components/SettingsPanel.jsx';
import PreviewArea       from './components/PreviewArea.jsx';
import StatusBar         from './components/StatusBar.jsx';
import TutorialOverlay   from './components/TutorialOverlay.jsx';
import MasterForgePanel  from './components/MasterForgePanel.jsx';

export default function App() {
  const [mainTab,         setMainTab]         = useState('forge');          // 'forge' | 'masterforge'
  const [currentImage,    setCurrentImage]    = useState(null);
  const [history,         setHistory]         = useState([]);
  const [historyLoading,  setHistoryLoading]  = useState(true);
  const [status,          setStatus]          = useState({ server: '…', comfyui: '…', comfyStarting: false });
  const [sidebarTab,      setSidebarTab]      = useState('single');
  const [models,          setModels]          = useState([]);
  const [defaultModel,    setDefaultModel]    = useState('');
  const [reuseSettings,   setReuseSettings]   = useState(null);
  const [appCursor,       setAppCursor]       = useState('default');
  const [showTutorial,    setShowTutorial]    = useState(false);
  const pollRef     = useRef(null);
  const intervalRef = useRef(null);

  // First-run tutorial
  useEffect(() => {
    if (!localStorage.getItem('iterforge_tutorial_v1')) {
      setTimeout(() => setShowTutorial(true), 800);
    }
  }, []);

  function startPolling(intervalMs) {
    if (pollRef.current) clearInterval(pollRef.current);
    intervalRef.current = intervalMs;
    const poll = async () => {
      try {
        const r = await fetch('/api/status');
        if (r.ok) {
          const s = await r.json();
          setStatus(s);
          if (intervalRef.current < 5000 && s.comfyui === 'ok') startPolling(5000);
          else if (intervalRef.current >= 5000 && s.comfyui !== 'ok') startPolling(2000);
        }
      } catch { setStatus(s => ({ ...s, server: 'error' })); }
    };
    poll();
    pollRef.current = setInterval(poll, intervalMs);
  }

  useEffect(() => {
    startPolling(2000);
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.ok ? r.json() : { generations: [] })
      .then(d => { setHistory(d.generations ?? []); setHistoryLoading(false); })
      .catch(() => setHistoryLoading(false));
    fetch('/api/models')
      .then(r => r.json())
      .then(d => { setModels(d.available ?? []); if (d.default) setDefaultModel(d.default); })
      .catch(() => {});
  }, []);

  // Poll history every 3 s (MCP-triggered generations)
  useEffect(() => {
    const id = setInterval(() => {
      fetch('/api/history')
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          const incoming = d.generations ?? [];
          setHistory(prev => {
            const prevIds = new Set(prev.map(e => e.id));
            const fresh = incoming.filter(e => !prevIds.has(e.id));
            if (!fresh.length) return prev;
            setCurrentImage(cur => cur ?? fresh[0]);
            return [...fresh, ...prev].slice(0, 100);
          });
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, []);

  async function handleStartComfy() {
    try {
      await fetch('/api/comfyui/start', { method: 'POST' });
      setStatus(s => ({ ...s, comfyStarting: true }));
      startPolling(2000);
    } catch {}
  }

  async function handleSetup() {
    try {
      await fetch('/api/setup/install', { method: 'POST' });
      setStatus(s => ({ ...s, setup: { state: 'running', message: 'Starting setup…' } }));
      startPolling(2000);
    } catch {}
  }

  function onGenerated(entry) {
    setCurrentImage(entry);
    setHistory(h => [entry, ...h].slice(0, 100));
  }

  function handleReuseSettings(entry) {
    setSidebarTab('single');
    setReuseSettings(entry);
  }

  // "Forge This →" — switch to MasterForge tab with current image
  function handleForgeThis() {
    setMainTab('masterforge');
  }

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      data-cursor={appCursor !== 'default' ? appCursor : undefined}
    >
      {/* ── Top bar ───────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-6 px-6 py-0 bg-surface-800/80 border-b border-surface-600/40 shrink-0 backdrop-blur-sm"
              style={{ height: '48px' }}>

        {/* Wordmark */}
        <div className="flex items-baseline gap-2 shrink-0">
          <span
            className="text-brand-400 text-base tracking-widest uppercase"
            style={{ fontFamily: "'Syne', system-ui, sans-serif", fontWeight: 800, letterSpacing: '0.22em' }}
          >
            Inter-Forge
          </span>
          <span className="text-surface-400 text-[10px]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            v1.0
          </span>
        </div>

        {/* Main tabs */}
        <nav className="flex items-stretch h-full ml-2">
          <button
            onClick={() => setMainTab('forge')}
            className={`forge-tab ${mainTab === 'forge' ? 'active' : ''}`}
          >
            ✦ Forge
          </button>
          <button
            onClick={() => setMainTab('masterforge')}
            className={`forge-tab ${mainTab === 'masterforge' ? 'active' : ''}`}
          >
            ⬡ MasterForge
          </button>
        </nav>

        {/* Status bar — right side */}
        <div className="ml-auto">
          <StatusBar status={status} onStartComfy={handleStartComfy} onSetup={handleSetup} />
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">

        {/* ── FORGE TAB ─────────────────────────────────────────────────────── */}
        {mainTab === 'forge' && (
          <div className="flex h-full">
            {/* Left sidebar */}
            <aside className="w-80 shrink-0 border-r flex flex-col overflow-hidden"
                   style={{ background: 'rgba(18,18,18,0.9)', borderColor: 'rgba(255,204,0,0.12)' }}>

              {/* Sub-tab pills */}
              <div className="flex gap-1 p-2 shrink-0"
                   style={{ borderBottom: '1px solid rgba(255,204,0,0.12)' }}>
                <button
                  id="tab-single"
                  onClick={() => setSidebarTab('single')}
                  className={`pill-tab ${sidebarTab === 'single' ? 'active' : ''}`}
                >
                  Single
                </button>
                <button
                  id="tab-sheet"
                  onClick={() => setSidebarTab('sheet')}
                  className={`pill-tab ${sidebarTab === 'sheet' ? 'active' : ''}`}
                >
                  Sheet
                </button>
                <button
                  id="tab-settings"
                  onClick={() => setSidebarTab('settings')}
                  className={`pill-tab ${sidebarTab === 'settings' ? 'active' : ''}`}
                >
                  Settings
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                {sidebarTab === 'single'
                  ? <GenerationPanel
                      onGenerated={onGenerated}
                      reuseSettings={reuseSettings}
                      onReuseConsumed={() => setReuseSettings(null)}
                      onGeneratingChange={gen => setAppCursor(gen ? 'generating' : 'default')}
                    />
                  : sidebarTab === 'sheet'
                    ? <SpriteSheetPanel onGenerated={onGenerated} models={models} defaultModel={defaultModel} />
                    : <SettingsPanel
                        models={models}
                        defaultModel={defaultModel}
                        onRestartTutorial={() => setShowTutorial(true)}
                      />
                }
              </div>
            </aside>

            {/* Main preview area */}
            <main className="flex-1 overflow-hidden">
              <PreviewArea
                currentImage={currentImage}
                history={history}
                historyLoading={historyLoading}
                onSelect={setCurrentImage}
                onDelete={(id) => setHistory(h => h.filter(e => e.id !== id))}
                onReuseSettings={handleReuseSettings}
                onGenerated={onGenerated}
                onOpenSettings={() => setSidebarTab('settings')}
                onCursorChange={setAppCursor}
                onForgeThis={handleForgeThis}
              />
            </main>
          </div>
        )}

        {/* ── MASTERFORGE TAB ───────────────────────────────────────────────── */}
        {mainTab === 'masterforge' && (
          <MasterForgePanel
            sourceImage={currentImage}
            onGenerated={onGenerated}
          />
        )}
      </div>

      {showTutorial && (
        <TutorialOverlay
          onDone={() => {
            localStorage.setItem('iterforge_tutorial_v1', '1');
            setShowTutorial(false);
          }}
        />
      )}
    </div>
  );
}
