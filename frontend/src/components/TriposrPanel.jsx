import { useState, useRef } from 'react';

/**
 * TriposrPanel — one-click 2D → 3D reconstruction via TripoSR.
 * Sits below the image in PreviewArea, same pattern as MeshPanel.
 */
export default function TriposrPanel({ currentImage, onJobComplete, onClose }) {
  const [status,   setStatus]   = useState('idle');   // idle | running | done | error
  const [progress, setProgress] = useState(null);     // { n, total, msg }
  const [errMsg,   setErrMsg]   = useState('');
  const pollRef = useRef(null);

  function stopPoll() {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
  }

  async function pollJob(jobId) {
    try {
      const r    = await fetch(`/api/triposr/${jobId}`);
      const data = await r.json();

      if (data.status === 'running') {
        if (data.progress) setProgress(data.progress);
        pollRef.current = setTimeout(() => pollJob(jobId), 1500);
        return;
      }

      if (data.status === 'completed' && data.result?.glbUrl) {
        stopPoll();
        setStatus('done');
        // Build a history-compatible entry — type:'triposr' tells PreviewArea to use triposr URLs
        const glbFilename = data.result.glbUrl.split('/').pop().split('?')[0];
        onJobComplete?.({
          id:          jobId,
          type:        'triposr',
          filename:    glbFilename,
          prompt:      currentImage.prompt ?? '3D reconstruction',
          timestamp:   Date.now(),
          sourceImage: currentImage.filename,
        });
        return;
      }

      // failed
      stopPoll();
      setStatus('error');
      setErrMsg(data.error ?? 'TripoSR job failed');
    } catch (e) {
      stopPoll();
      setStatus('error');
      setErrMsg(e.message);
    }
  }

  async function handleGenerate() {
    if (status === 'running') return;
    setStatus('running');
    setProgress({ n: 0, total: 10, msg: 'Starting…' });
    setErrMsg('');

    try {
      const r = await fetch('/api/triposr/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          imageFilename: currentImage.filename,
          resolution:    256,
        }),
      });
      const data = await r.json();
      if (!data.jobId) throw new Error(data.error ?? 'No jobId returned');
      pollJob(data.jobId);
    } catch (e) {
      setStatus('error');
      setErrMsg(e.message);
    }
  }

  const pct = progress ? Math.round((progress.n / progress.total) * 100) : 0;

  return (
    <div className="bg-surface-800/70 rounded-xl border border-surface-700/50 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200">⬡ Generate 3D (TripoSR)</span>
          <span className="text-[10px] text-slate-500 bg-surface-700 px-1.5 py-0.5 rounded">Neural · ~30s</span>
        </div>
        <button onClick={() => { stopPoll(); onClose?.(); }}
          className="text-slate-600 hover:text-slate-300 text-sm transition-colors">✕</button>
      </div>

      {status === 'idle' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-500 leading-relaxed">
            Reconstructs a full 3D mesh from this image using TripoSR. Works best on objects with a clear background.
          </p>
          <button
            onClick={handleGenerate}
            className="w-full py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm text-white font-medium transition-colors">
            Generate 3D Mesh
          </button>
        </div>
      )}

      {status === 'running' && (
        <div className="flex flex-col gap-2">
          <div className="w-full bg-surface-700 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between items-center">
            <p className="text-xs text-slate-400 truncate">{progress?.msg ?? 'Processing…'}</p>
            <span className="text-[10px] text-slate-600 shrink-0 ml-2">{progress?.n ?? 0}/{progress?.total ?? 10}</span>
          </div>
        </div>
      )}

      {status === 'done' && (
        <p className="text-xs text-green-400">3D mesh ready — loading in viewer…</p>
      )}

      {status === 'error' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-red-400">{errMsg}</p>
          <button
            onClick={handleGenerate}
            className="w-full py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-xs text-slate-300 transition-colors border border-surface-600/50">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
