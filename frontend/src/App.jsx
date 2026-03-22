import { useState, useEffect, useRef } from 'react';
import GenerationPanel   from './components/GenerationPanel.jsx';
import SpriteSheetPanel  from './components/SpriteSheetPanel.jsx';
import SettingsPanel     from './components/SettingsPanel.jsx';
import PreviewArea       from './components/PreviewArea.jsx';
import StatusBar         from './components/StatusBar.jsx';
import TutorialOverlay   from './components/TutorialOverlay.jsx';
import MasterForgePanel  from './components/MasterForgePanel.jsx';
import SmeltingPanel     from './components/SmeltingPanel.jsx';

export default function App() {
  const [mainTab,         setMainTab]         = useState('forge');          // 'forge' | 'smelting' | 'masterforge'
  const [currentImage,    setCurrentImage]    = useState(null);
  
  // Phase 2 Multiview State
  const [lockedAsset,     setLockedAsset]     = useState(null);
  const [smeltedViews,    setSmeltedViews]    = useState({ front: null, left: null, right: null, back: null });
  const [outputChoice,    setOutputChoice]    = useState(null); // 'mesh' | 'spriteSheet'

  const canProceedToMasterForge = tinkerMode
    ? !!lockedAsset
    : !!(smeltedViews.front && smeltedViews.left && smeltedViews.right);

  const [history,         setHistory]         = useState([]);
  const [historyLoading,  setHistoryLoading]  = useState(true);
  const [status,          setStatus]          = useState({ server: '…', comfyui: '…', comfyStarting: false });
  const [sidebarTab,      setSidebarTab]      = useState('single');
  const [models,          setModels]          = useState([]);
  const [defaultModel,    setDefaultModel]    = useState('');
  const [reuseSettings,   setReuseSettings]   = useState(null);
  const [appCursor,       setAppCursor]       = useState('default');
  const [showTutorial,    setShowTutorial]    = useState(false);
  const [anvilOpen,       setAnvilOpen]       = useState(false);
  const [tinkerMode,      setTinkerMode]      = useState(false);
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
            // Only auto-select if nothing is currently shown
            setCurrentImage(cur => cur ?? fresh[0]);
            const merged = [...fresh, ...prev];
            // deduplicate by id (handles onGenerated race)
            const seen = new Set();
            return merged.filter(e => seen.has(e.id) ? false : seen.add(e.id)).slice(0, 100);
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
    setHistory(h => {
      if (h.some(e => e.id === entry.id)) return h; // already added by poll
      return [entry, ...h].slice(0, 100);
    });
  }

  function handleReuseSettings(entry) {
    setSidebarTab('single');
    setReuseSettings(entry);
  }

  // "Forge This →" — switch to Smelting tab with current image
  function handleForgeThis(entry = null) {
    const asset = entry || currentImage;
    if (asset) {
      setLockedAsset(asset);
      setMainTab('smelting');
    }
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
            onClick={() => setMainTab('smelting')}
            className={`forge-tab ${mainTab === 'smelting' ? 'active' : ''}`}
          >
            ♨ Smelting
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
                      onOpenAnvil={() => setAnvilOpen(true)}
                      tinkerMode={tinkerMode}
                      onToggleTinker={() => setTinkerMode(t => !t)}
                    />
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
                lockedAsset={lockedAsset}
                onSelect={setCurrentImage}
                onDelete={(id) => {
                  setHistory(h => {
                    const next = h.filter(e => e.id !== id);
                    // If the deleted item was being viewed, select the next one or clear
                    setCurrentImage(cur => {
                      if (cur?.id !== id) return cur;
                      return next[0] ?? null;
                    });
                    return next;
                  });
                }}
                onReuseSettings={handleReuseSettings}
                onGenerated={onGenerated}
                onOpenSettings={() => setSidebarTab('settings')}
                onCursorChange={setAppCursor}
                onForgeThis={handleForgeThis}
                onLockAsset={setLockedAsset}
                anvilOpen={anvilOpen}
                onCloseAnvil={() => setAnvilOpen(false)}
                onOpenAnvil={() => setAnvilOpen(true)}
              />
            </main>
          </div>
        )}

        {/* ── SMELTING TAB ──────────────────────────────────────────────────── */}
        {mainTab === 'smelting' && (
          <SmeltingPanel
            lockedAsset={lockedAsset}
            smeltedViews={smeltedViews}
            onUpdateViews={setSmeltedViews}
            canProceed={canProceedToMasterForge}
            onProceed={() => canProceedToMasterForge && setMainTab('masterforge')}
            onChangeSource={() => setMainTab('forge')}
            tinkerMode={tinkerMode}
          />
        )}

        {/* ── MASTERFORGE TAB ───────────────────────────────────────────────── */}
        {mainTab === 'masterforge' && (
          <MasterForgePanel
            sourceImage={lockedAsset}
            smeltedViews={smeltedViews}
            outputChoice={outputChoice}
            onOutputChoiceChange={setOutputChoice}
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
