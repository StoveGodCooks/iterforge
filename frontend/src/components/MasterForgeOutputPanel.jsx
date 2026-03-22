import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import axios from 'axios';

// Lazy-load the heavy ModelViewer (Babylon.js)
const ModelViewer = lazy(() => import('./ModelViewer.jsx'));

/**
 * MasterForgeOutputPanel — Final Tab 3
 * Handles Fork A (Mesh) and Fork B (Sprite Sheet)
 */
export default function MasterForgeOutputPanel({ 
  sourceImage, 
  smeltedViews, 
  outputChoice, 
  onOutputChoiceChange,
  onGenerated 
}) {
  const [job, setJob] = useState(null);
  const [meshOptions, setMeshOptions] = useState({
    lod: true,
    dxf: true,
    midas: false,
    scale: 1.0
  });
  const [spriteOptions, setSpriteOptions] = useState({
    preset: 'idle',
    frames: 4,
    size: 512,
    extraAttempts: false
  });

  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const handleForgeMesh = async () => {
    setJob({ status: 'submitting', progressMessage: 'Starting mesh pipeline...' });
    onOutputChoiceChange('mesh');

    try {
      const res = await axios.post('/api/masterforge/generate', {
        ...meshOptions,
        leftImagePath:  smeltedViews.left?.imagePath,
        rightImagePath: smeltedViews.right?.imagePath,
        backImagePath:   smeltedViews.back?.imagePath,
        assetType:      sourceImage.assetType,
        imageFilename:  sourceImage.filename
      });

      if (res.data.jobId) {
        startPolling(res.data.jobId, 'masterforge');
      }
    } catch (err) {
      setJob({ status: 'failed', error: err.response?.data?.error || err.message });
    }
  };

  const handleForgeSpriteSheet = async (overrideExtra = null) => {
    const useExtra = overrideExtra !== null ? overrideExtra : spriteOptions.extraAttempts;
    if (overrideExtra !== null) {
      setSpriteOptions(prev => ({ ...prev, extraAttempts: overrideExtra }));
    }

    setJob({ status: 'submitting', progressMessage: 'Starting sprite sheet pipeline...' });
    onOutputChoiceChange('spriteSheet');

    try {
      // Map 6 frames to 3x2 if it exists, otherwise 3x3 (v1.1 sprite-sheet.js has 3x2 logic now)
      const gridLayout = spriteOptions.frames === 4 ? '2x2' : '3x2';

      const res = await axios.post('/api/sprite-sheet', {
        lockedRef:       smeltedViews.front.imagePath,
        assetType:       sourceImage.assetType,
        gridLayout:      gridLayout,
        width:           spriteOptions.size,
        subject:         sourceImage.prompt,
        extraAttempts:   useExtra
      });

      if (res.data.jobId) {
        startPolling(res.data.jobId, 'sprite-sheet');
      }
    } catch (err) {
      setJob({ status: 'failed', error: err.response?.data?.error || err.message });
    }
  };

  const startPolling = (jobId, type) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`/api/${type}/${type === 'masterforge' ? 'job/' : ''}${jobId}`);
        const data = res.data;
        
        setJob({
          ...data,
          progressMessage: data.progress || data.status,
          progressData: data.progressData || data.progress
        });

        if (data.status === 'completed') {
          clearInterval(pollRef.current);
          if (data.result) onGenerated(data.result);
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current);
        }
      } catch (err) {
        // ignore transient errors
      }
    }, 2000);
  };

  const isRunning = job?.status === 'running' || job?.status === 'submitting';
  const isCompleted = job?.status === 'completed';
  const isFailed = job?.status === 'failed';
  const result = job?.result;
  const diagnostic = job?.diagnostic;

  const canForgeMesh = sourceImage && smeltedViews.front && smeltedViews.left && smeltedViews.right;
  const canForgeSprites = sourceImage && smeltedViews.front;

  const mfId = result?.id || result?.jobId;
  const modelUrl = (mfId && result?.glbFile) ? `/api/masterforge/model/${mfId}/${result.glbFile}` : null;

  // Browser-safe basename
  const getBasename = (p) => p ? p.split(/[\\/]/).pop() : '';

  return (
    <div className="flex flex-col h-full bg-surface-900 overflow-hidden">
      
      {/* ── Header: Approved Views ──────────────────────────────────────────── */}
      <div className="p-4 bg-surface-800/40 border-b border-surface-700/50">
        <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 px-2">
          Approved Smelting Views
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2 px-2">
          {['front', 'left', 'right', 'back'].map(v => (
            smeltedViews[v] && (
              <div key={v} className="relative group shrink-0">
                <img 
                  src={`/api/generate/image/${smeltedViews[v].filename}`} 
                  className="w-16 h-16 rounded border border-surface-600/50 object-cover"
                  alt={v}
                />
                <span className="absolute bottom-0 left-0 right-0 text-center bg-black/60 text-[8px] text-slate-300 py-0.5 uppercase">
                  {v}
                </span>
              </div>
            )
          ))}
          {!sourceImage && (
            <div className="flex items-center gap-3 px-2 py-4">
              <div className="w-10 h-10 rounded bg-surface-800 border border-surface-700 border-dashed flex items-center justify-center text-slate-700 text-xs">?</div>
              <span className="text-[10px] text-slate-600 italic uppercase tracking-tighter">Waiting for approved views...</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex gap-6 p-6 overflow-hidden">
        
        {/* ── Fork A: Mesh ──────────────────────────────────────────────────── */}
        <div className={`flex-1 flex flex-col gap-4 p-6 rounded-2xl border-2 transition-all ${
          outputChoice === 'mesh' ? 'border-brand-500 bg-surface-800/40' : 'border-surface-700/50 bg-surface-800/10 opacity-60 hover:opacity-100'
        }`}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl text-brand-400">⬡</span>
            <div>
              <h3 className="text-lg font-bold text-slate-100 uppercase tracking-wider font-mono">MasterForge Mesh</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">3D Reconstruction Pipeline</p>
            </div>
          </div>

          <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-2 custom-scrollbar">
            {isCompleted && outputChoice === 'mesh' && modelUrl ? (
              <div className="aspect-square w-full rounded-xl overflow-hidden border border-surface-700">
                <Suspense fallback={
                  <div className="w-full h-full flex items-center justify-center bg-surface-950">
                    <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                }>
                  <ModelViewer glbUrl={modelUrl} className="w-full h-full" />
                </Suspense>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Toggle label="LOD Levels" value={meshOptions.lod} onChange={v => setMeshOptions({...meshOptions, lod: v})} />
                  <Toggle label="DXF Export" value={meshOptions.dxf} onChange={v => setMeshOptions({...meshOptions, dxf: v})} />
                  <Toggle label="MiDaS Depth" value={meshOptions.midas} onChange={v => setMeshOptions({...meshOptions, midas: v})} />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-bold uppercase">Mesh Scale</label>
                  <div className="flex gap-2">
                    {[0.5, 1.0, 2.0].map(s => (
                      <button 
                        key={s} 
                        onClick={() => setMeshOptions({...meshOptions, scale: s})}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                          meshOptions.scale === s ? 'bg-brand-500 text-surface-900 border-brand-400' : 'bg-surface-700 text-slate-400 border-surface-600'
                        }`}
                      >
                        {s.toFixed(1)}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            disabled={isRunning || !canForgeMesh}
            onClick={handleForgeMesh}
            className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-all shadow-xl active:scale-95 ${
              isRunning || !canForgeMesh 
                ? 'bg-surface-700 text-slate-600 cursor-not-allowed border border-surface-600/30' 
                : 'bg-brand-500 text-surface-900 hover:bg-brand-400 hover:scale-[1.02]'
            }`}
          >
            {!canForgeMesh && sourceImage ? 'Smelt 3 Views to Unlock' : isCompleted && outputChoice === 'mesh' ? 'Re-Forge Mesh' : 'Forge Mesh'}
          </button>
        </div>

        {/* ── Fork B: Sprite Sheet ──────────────────────────────────────────── */}
        <div className={`flex-1 flex flex-col gap-4 p-6 rounded-2xl border-2 transition-all ${
          outputChoice === 'spriteSheet' ? 'border-indigo-500 bg-surface-800/40' : 'border-surface-700/50 bg-surface-800/10 opacity-60 hover:opacity-100'
        }`}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl text-indigo-400">⊞</span>
            <div>
              <h3 className="text-lg font-bold text-slate-100 uppercase tracking-wider font-mono">MasterForge Sprites</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">2D Animation Pipeline</p>
            </div>
          </div>

          <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-2 custom-scrollbar">
            {isCompleted && outputChoice === 'spriteSheet' && result?.imagePath ? (
              <div className="aspect-square w-full rounded-xl overflow-hidden border border-surface-700 bg-surface-950 flex items-center justify-center p-4">
                <img src={`/api/generate/image/${getBasename(result.imagePath)}`} className="max-w-full max-h-full object-contain shadow-2xl" alt="Sheet Preview" />
              </div>
            ) : isFailed && outputChoice === 'spriteSheet' && diagnostic ? (
              <div className="bg-red-900/20 border border-red-500/40 rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-2 text-red-400 font-bold uppercase text-[10px] tracking-widest">
                  <span>⚠️ Quality Gate Failure</span>
                  <span className="ml-auto">Frame {diagnostic.frame + 1}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-400">Final Score</span>
                  <span className="text-lg font-mono font-bold text-red-400">{diagnostic.score} <span className="text-[10px] text-slate-600">/ {diagnostic.threshold}</span></span>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Diagnosis</p>
                  <ul className="text-[10px] text-slate-300 space-y-1 list-disc pl-4 italic">
                    {diagnostic.diagnosis.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Suggestion</p>
                  <ul className="text-[10px] text-brand-400 space-y-1 list-disc pl-4">
                    {diagnostic.suggestion.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
                <button 
                  onClick={() => handleForgeSpriteSheet(true)}
                  className="w-full py-2 bg-brand-500 text-surface-900 text-[10px] font-bold uppercase rounded-lg hover:bg-brand-400 transition-all"
                >
                  Retry with 5 attempts
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-bold uppercase">Animation Preset</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['IDLE', 'WALK', 'ATTACK', 'HURT', 'JUMP'].map(p => (
                      <button 
                        key={p} 
                        onClick={() => setSpriteOptions({...spriteOptions, preset: p.toLowerCase()})}
                        className={`py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                          spriteOptions.preset === p.toLowerCase() ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-surface-700 text-slate-400 border-surface-600'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase">Frames</label>
                    <div className="flex gap-2">
                      {[4, 6].map(f => (
                        <button 
                          key={f} 
                          onClick={() => setSpriteOptions({...spriteOptions, frames: f})}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                            spriteOptions.frames === f ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-surface-700 text-slate-400 border-surface-600'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase">Resolution</label>
                    <div className="flex gap-2">
                      {[256, 512].map(r => (
                        <button 
                          key={r} 
                          onClick={() => setSpriteOptions({...spriteOptions, size: r})}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                            spriteOptions.size === r ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-surface-700 text-slate-400 border-surface-600'
                          }`}
                        >
                          {r}px
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Toggle 
                    label="Extra Attempts (5 per frame)" 
                    value={spriteOptions.extraAttempts} 
                    onChange={v => setSpriteOptions({...spriteOptions, extraAttempts: v})} 
                  />
                </div>
              </div>
            )}
          </div>

          <button
            disabled={isRunning || !canForgeSprites}
            onClick={() => handleForgeSpriteSheet()}
            className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-all shadow-xl active:scale-95 ${
              isRunning || !canForgeSprites
                ? 'bg-surface-700 text-slate-600 cursor-not-allowed border border-surface-600/30'
                : 'bg-indigo-600 text-white hover:bg-indigo-500 hover:scale-[1.02]'
            }`}
          >
            {!canForgeSprites ? 'Lock Source Image to Unlock' : isCompleted && outputChoice === 'spriteSheet' ? 'Re-Generate Sheet' : 'Forge Sprite Sheet'}
          </button>
        </div>

      </div>

      {/* ── Progress Overlay ────────────────────────────────────────────────── */}
      {isRunning && (
        <div className="absolute inset-0 z-50 bg-surface-900/80 backdrop-blur-md flex flex-col items-center justify-center p-12">
          <div className="w-full max-w-lg space-y-8 text-center">
            <div className="relative">
              <div className={`w-24 h-24 border-4 ${outputChoice === 'mesh' ? 'border-brand-500/20 border-t-brand-500' : 'border-indigo-500/20 border-t-indigo-500'} rounded-full animate-spin mx-auto`} />
              <div className="absolute inset-0 flex items-center justify-center text-2xl animate-pulse">
                {outputChoice === 'mesh' ? '⬡' : '⊞'}
              </div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-slate-100 font-mono uppercase tracking-[0.3em]">
                {outputChoice === 'mesh' ? 'Forging Mesh' : 'Generating Sheet'}
              </h3>
              <p className={`font-mono text-xs animate-pulse uppercase tracking-widest ${outputChoice === 'mesh' ? 'text-brand-400' : 'text-indigo-400'}`}>
                {job.progressMessage || 'Executing Pipeline...'}
              </p>
            </div>

            {outputChoice === 'spriteSheet' && job.progressData?.completed !== undefined && (
              <div className="w-full bg-surface-800 rounded-full h-2 border border-surface-700 overflow-hidden">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-500" 
                  style={{ width: `${(job.progressData.completed / job.progressData.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-surface-700/40 border border-surface-600/30">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{label}</span>
      <button 
        onClick={() => onChange(!value)}
        className={`w-10 h-5 rounded-full relative transition-all ${value ? 'bg-brand-600' : 'bg-surface-600'}`}
      >
        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${value ? 'right-1' : 'left-1'}`} />
      </button>
    </div>
  );
}
