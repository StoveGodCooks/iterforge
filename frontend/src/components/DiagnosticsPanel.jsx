import { useState, useRef, useCallback } from 'react';

const STATUS_META = {
  pass:    { icon: '✓', color: 'text-green-400',  bg: 'bg-green-900/20',  border: 'border-green-800/40' },
  fail:    { icon: '✗', color: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-800/40'   },
  warn:    { icon: '⚠', color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-800/40'},
  info:    { icon: 'i', color: 'text-slate-400',  bg: 'bg-surface-800/40',border: 'border-surface-700/40'},
  running: { icon: '…', color: 'text-brand-400',  bg: 'bg-brand-900/20',  border: 'border-brand-800/40' },
  log:     { icon: '›', color: 'text-slate-500',  bg: 'bg-surface-900/30',border: 'border-surface-700/20'},
  skip:    { icon: '–', color: 'text-slate-600',  bg: 'bg-surface-800/20',border: 'border-surface-700/20'},
  done:    { icon: '★', color: 'text-brand-300',  bg: 'bg-brand-900/20',  border: 'border-brand-700/40' },
};

const CATEGORY_LABELS = {
  system:  '⬡ System',
  filesystem: '📁 Filesystem',
  python:  '🐍 Python',
  blender: '🔷 Blender',
  comfyui: '🧠 Inter-Forge Engine',
  api:     '🔌 API Routes',
  done:    '',
  error:   '💥 Error',
};

export default function DiagnosticsPanel() {
  const [running,    setRunning]    = useState(false);
  const [results,    setResults]    = useState([]);
  const [filter,     setFilter]     = useState('all');  // all | fail | warn
  const [copyDone,   setCopyDone]   = useState(false);
  const [collapsed,  setCollapsed]  = useState({});
  const logEndRef    = useRef(null);
  const esRef        = useRef(null);

  const runDiagnostics = useCallback(() => {
    if (running) return;
    setRunning(true);
    setResults([]);
    setCollapsed({});

    if (esRef.current) { esRef.current.close(); }

    const es = new EventSource('/api/diagnostics/run');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const item = JSON.parse(e.data);
        setResults(prev => [...prev, item]);
        // Auto-scroll to bottom
        setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        if (item.status === 'done') {
          es.close();
          setRunning(false);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      setRunning(false);
      setResults(prev => [...prev, {
        category: 'error', status: 'fail',
        label: 'Connection to diagnostics endpoint lost',
        detail: 'The SSE connection was closed unexpectedly. The server may have crashed.',
        ts: Date.now(),
      }]);
    };
  }, [running]);

  function stopDiagnostics() {
    esRef.current?.close();
    setRunning(false);
  }

  function copyReport() {
    const lines = results.map(r => {
      const badge = r.status.toUpperCase().padEnd(7);
      const cat   = (r.category || '').padEnd(12);
      return `[${badge}] [${cat}] ${r.label}${r.detail ? `\n            ${r.detail.replace(/\n/g, '\n            ')}` : ''}`;
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }

  // Compute summary counts
  const counts = results.reduce((acc, r) => {
    if (r.status === 'pass')  acc.pass++;
    if (r.status === 'fail')  acc.fail++;
    if (r.status === 'warn')  acc.warn++;
    return acc;
  }, { pass: 0, fail: 0, warn: 0 });

  const filtered = filter === 'all'  ? results
    : filter === 'fail' ? results.filter(r => r.status === 'fail')
    : results.filter(r => r.status === 'fail' || r.status === 'warn');

  // Group by category
  const groups = [];
  let currentGroup = null;
  for (const item of filtered) {
    if (item.category !== currentGroup?.category) {
      currentGroup = { category: item.category, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(item);
  }

  return (
    <div className="flex flex-col h-full gap-3">

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={running ? stopDiagnostics : runDiagnostics}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            running
              ? 'bg-red-700 hover:bg-red-600 text-white'
              : 'bg-brand-600 hover:bg-brand-500 text-white'
          }`}>
          {running ? '⬛ Stop' : '▶ Run Diagnostics'}
        </button>

        {results.length > 0 && (
          <>
            <button
              onClick={copyReport}
              className="px-3 py-2 rounded-lg text-xs border border-surface-600/50 bg-surface-700/40 text-slate-400 hover:text-slate-200 transition-all">
              {copyDone ? '✓ Copied' : '⎘ Copy Report'}
            </button>

            <div className="flex gap-1 ml-auto">
              {[['all', 'All'], ['warn', 'Warn+Fail'], ['fail', 'Fail only']].map(([v, l]) => (
                <button key={v} onClick={() => setFilter(v)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    filter === v
                      ? 'bg-brand-600/30 border border-brand-500/50 text-brand-300'
                      : 'bg-surface-700/30 border border-surface-600/30 text-slate-500 hover:text-slate-300'
                  }`}>
                  {l}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Summary bar */}
      {results.length > 0 && (
        <div className="flex gap-3 px-3 py-2 rounded-lg bg-surface-800/60 border border-surface-700/40 text-xs">
          <span className="text-green-400 font-semibold">✓ {counts.pass} passed</span>
          <span className="text-red-400 font-semibold">✗ {counts.fail} failed</span>
          <span className="text-yellow-400 font-semibold">⚠ {counts.warn} warnings</span>
          {running && <span className="text-brand-400 font-semibold ml-auto animate-pulse">● Running…</span>}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
        {groups.length === 0 && !running && (
          <div className="text-center text-slate-600 text-sm py-12">
            Run diagnostics to check system health
          </div>
        )}

        {groups.map((group, gi) => {
          const catKey   = group.category;
          const catLabel = CATEGORY_LABELS[catKey] || catKey;
          const isCollapsed = collapsed[gi];
          const hasFail  = group.items.some(i => i.status === 'fail');
          const hasWarn  = group.items.some(i => i.status === 'warn');

          return (
            <div key={gi} className="rounded-lg border border-surface-700/40 overflow-hidden">
              {/* Category header */}
              {catLabel && (
                <button
                  onClick={() => setCollapsed(c => ({ ...c, [gi]: !c[gi] }))}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold border-b border-surface-700/30 transition-colors hover:bg-surface-700/20 ${
                    hasFail ? 'bg-red-900/10 text-red-300'
                    : hasWarn ? 'bg-yellow-900/10 text-yellow-300'
                    : 'bg-surface-800/60 text-slate-400'
                  }`}>
                  <span>{catLabel}</span>
                  <span className="text-slate-600">{isCollapsed ? '▶' : '▼'}</span>
                </button>
              )}

              {!isCollapsed && (
                <div className="divide-y divide-surface-700/20">
                  {group.items.map((item, idx) => {
                    const meta = STATUS_META[item.status] ?? STATUS_META.info;
                    const isLog = item.status === 'log';

                    return (
                      <div key={idx} className={`px-3 py-1.5 ${meta.bg}`}>
                        <div className="flex items-start gap-2">
                          <span className={`text-[10px] font-mono font-bold mt-0.5 w-3 shrink-0 ${meta.color}`}>
                            {meta.icon}
                          </span>
                          <span className={`text-[11px] leading-snug break-all ${isLog ? 'text-slate-500 font-mono' : 'text-slate-200'}`}>
                            {item.label}
                          </span>
                        </div>
                        {item.detail && !isLog && (
                          <pre className={`mt-1 ml-5 text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-all rounded p-2 border ${meta.border} ${meta.bg} ${meta.color} opacity-80 max-h-48 overflow-y-auto`}>
                            {item.detail}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div ref={logEndRef} />
      </div>
    </div>
  );
}
