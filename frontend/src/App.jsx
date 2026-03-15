import { useState, useEffect, useRef } from 'react';
import GenerationPanel from './components/GenerationPanel.jsx';
import PreviewArea     from './components/PreviewArea.jsx';
import StatusBar       from './components/StatusBar.jsx';

export default function App() {
  const [currentImage, setCurrentImage] = useState(null);
  const [history,      setHistory]      = useState([]);
  const [status,       setStatus]       = useState({ server: '…', comfyui: '…', comfyStarting: false });
  const pollRef = useRef(null);

  function startPolling(intervalMs) {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const r = await fetch('/api/status');
        if (r.ok) {
          const s = await r.json();
          setStatus(s);
          // Slow back down once ComfyUI is up or no longer starting
          if (intervalMs < 5000 && s.comfyui === 'ok') {
            startPolling(2000);
          }
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

  // Load history on mount
  useEffect(() => {
    fetch('/api/history')
      .then(r => r.ok ? r.json() : { generations: [] })
      .then(d => setHistory(d.generations ?? []))
      .catch(() => {});
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

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-5 py-2.5 bg-surface-800 border-b border-surface-700/60 shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-brand-400 font-bold text-base tracking-wider">InterForge</span>
          <span className="text-slate-600 text-[11px] font-mono">v1.0</span>
        </div>
        <div className="ml-auto">
          <StatusBar status={status} onStartComfy={handleStartComfy} onSetup={handleSetup} />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — controls */}
        <aside className="w-80 shrink-0 bg-surface-800 border-r border-surface-700/60 flex flex-col">
          <GenerationPanel onGenerated={onGenerated} />
        </aside>

        {/* Main — preview + history */}
        <main className="flex-1 overflow-hidden">
          <PreviewArea currentImage={currentImage} history={history} onSelect={setCurrentImage} onDelete={(id) => setHistory(h => h.filter(e => e.id !== id))} />
        </main>
      </div>
    </div>
  );
}
