import { useState, useEffect } from 'react';
import GenerationPanel from './components/GenerationPanel.jsx';
import PreviewArea     from './components/PreviewArea.jsx';
import StatusBar       from './components/StatusBar.jsx';

export default function App() {
  const [currentImage, setCurrentImage] = useState(null);  // { filename, seed, prompt, backend }
  const [history,      setHistory]      = useState([]);
  const [status,       setStatus]       = useState({ server: '…', comfyui: '…' });

  // Poll status every 5 s
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/status');
        if (r.ok) setStatus(await r.json());
      } catch { setStatus(s => ({ ...s, server: 'error' })); }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  // Load history on mount
  useEffect(() => {
    fetch('/api/history')
      .then(r => r.ok ? r.json() : { generations: [] })
      .then(d => setHistory(d.generations ?? []))
      .catch(() => {});
  }, []);

  function onGenerated(entry) {
    setCurrentImage(entry);
    setHistory(h => [entry, ...h].slice(0, 100));
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-5 py-3 bg-surface-800 border-b border-surface-600 shrink-0">
        <span className="text-brand-400 font-bold text-lg tracking-wide">IterForge</span>
        <span className="text-slate-500 text-xs">v1.0</span>
        <div className="ml-auto">
          <StatusBar status={status} />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — controls */}
        <aside className="w-80 shrink-0 bg-surface-800 border-r border-surface-600 overflow-y-auto">
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
