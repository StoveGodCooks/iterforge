import { useState, useEffect, useRef } from 'react';

/**
 * ViewSlot — Individual multiview generation slot
 */
export default function ViewSlot({
  type,
  label,
  required,
  lockedAsset,
  ipaWeight,
  useCanny,
  viewData,
  onUpdate,
  tinkerMode = false,
}) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'generating' | 'done' | 'warn' | 'fail'
  const [error,  setError]  = useState(null);
  const pollRef = useRef(null);

  // Sync status when viewData is pre-populated externally (e.g. front reference)
  useEffect(() => {
    if (!viewData) return;
    const { quality } = viewData;
    if (quality?.passed) setStatus('done');
    else if (quality?.warn) setStatus('warn');
    else setStatus('fail');
  }, [viewData?.filename]);

  // Clear polling on unmount
  useEffect(() => () => clearInterval(pollRef.current), []);

  const handleGenerate = async () => {
    setStatus('generating');
    setError(null);

    try {
      const res = await fetch('/api/smelting/generate-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refPath:          lockedAsset.imagePath || lockedAsset.filename,
          viewType:         type,
          assetType:        lockedAsset.assetType,
          assetPrompt:      lockedAsset.prompt || '',
          ipaWeightOverride: ipaWeight,
          useCanny:         useCanny,
          tinkerMode:       tinkerMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      if (data.success) startPolling(data.jobId);
    } catch (err) {
      setStatus('fail');
      setError(err.message);
    }
  };

  const startPolling = (jobId) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/smelting/job/${jobId}`);
        const job = await res.json();

        if (job.status === 'completed') {
          clearInterval(pollRef.current);
          const { quality } = job.result;
          // Tinker mode: always pass regardless of quality score
          let nextStatus = 'done';
          if (!tinkerMode && !quality?.passed) nextStatus = quality?.warn ? 'warn' : 'fail';
          setStatus(nextStatus);
          onUpdate(job.result);
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current);
          setStatus('fail');
          setError(job.error);
        }
      } catch (err) {
        clearInterval(pollRef.current);
        setStatus('fail');
        setError('Connection lost during polling');
      }
    }, 2000);
  };

  const score = viewData?.quality?.score;
  const scorePct = score ? (score * 100).toFixed(0) : 0;

  return (
    <div className={`flex flex-col gap-2 p-3 rounded-xl border-2 transition-all ${
      status === 'generating' ? 'border-brand-500/40 bg-surface-800/40 animate-pulse' :
      status === 'done' ? 'border-green-500/30 bg-surface-800/60' :
      status === 'warn' ? 'border-yellow-500/30 bg-surface-800/60' :
      status === 'fail' ? 'border-red-500/30 bg-surface-800/60' :
      'border-surface-700/50 bg-surface-800/20'
    }`}>
      
      <div className="flex items-center justify-between px-1">
        <span className={`text-[10px] font-bold tracking-widest ${required ? 'text-slate-300' : 'text-slate-500'}`}>
          {label} {required && <span className="text-brand-500">*</span>}
        </span>
        {score && (
          <span className={`text-[10px] font-mono font-bold ${
            status === 'done' ? 'text-green-400' : 
            status === 'warn' ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {scorePct}%
          </span>
        )}
      </div>

      <div className="relative aspect-square rounded-lg overflow-hidden bg-surface-900 flex items-center justify-center border border-surface-700/50">
        {viewData ? (
          <img 
            src={`/api/generate/image/${viewData.filename}`} 
            className={`w-full h-full object-contain ${status === 'fail' ? 'opacity-40 grayscale' : ''}`}
            alt={type}
          />
        ) : (
          status === 'generating' ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] text-brand-400 uppercase font-mono">Smelting...</span>
            </div>
          ) : (
            <span className="text-[10px] text-slate-700 uppercase font-mono tracking-tighter italic">Pending</span>
          )
        )}

        {/* Overlay for Warn/Fail */}
        {status === 'warn' && (
          <div className="absolute top-1 right-1 bg-yellow-500 text-surface-900 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow-lg">
            ⚠️
          </div>
        )}
        {status === 'fail' && (
          <div className="absolute top-1 right-1 bg-red-500 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] shadow-lg">
            ✕
          </div>
        )}
      </div>

      {error && (
        <p className="text-[9px] text-red-400 leading-tight px-1 italic line-clamp-2">
          {error}
        </p>
      )}

      <button
        disabled={status === 'generating' || !lockedAsset}
        onClick={handleGenerate}
        className={`w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
          !lockedAsset ? 'bg-surface-800 text-slate-700 cursor-not-allowed border border-surface-700/30' :
          status === 'idle' ? 'bg-surface-700 hover:bg-brand-600 text-slate-300' :
          status === 'generating' ? 'bg-surface-800 text-slate-600 cursor-not-allowed' :
          'bg-surface-700 hover:bg-surface-600 text-slate-400'
        }`}
      >
        {status === 'idle' ? 'Smelt' : status === 'generating' ? 'Smelting…' : 'Resmelt'}
      </button>
    </div>
  );
}
