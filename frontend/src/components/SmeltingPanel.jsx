import { useState, useEffect } from 'react';
import ViewSlot from './ViewSlot.jsx';

/**
 * SmeltingPanel — Phase 2 Multiview Identity Locking
 * 
 * Flow:
 * 1. Shows the locked reference concept from FORGE.
 * 2. Provides slots for FRONT, LEFT, RIGHT, BACK orthographic views.
 * 3. IdentityLock (quality.py) validates each view against reference.
 * 4. Procedural gating: FRONT+LEFT+RIGHT required to proceed.
 */
export default function SmeltingPanel({
  lockedAsset,
  smeltedViews,
  onUpdateViews,
  canProceed,
  onProceed,
  onChangeSource,
  tinkerMode = false,
}) {
  const [ipaWeight, setIpaWeight] = useState(0.75);
  const [useCanny,  setUseCanny]  = useState(true);
  const [batchMode, setBatchMode] = useState(false);

  // Auto-populate front slot with the locked ingot (it IS the reference view)
  useEffect(() => {
    if (!lockedAsset) return;
    onUpdateViews(prev => {
      if (prev.front) return prev; // don't overwrite an already-smelted front
      return {
        ...prev,
        front: {
          imagePath: lockedAsset.imagePath,
          filename:  lockedAsset.filename,
          quality:   { passed: true, score: 1.0, warn: false, isReference: true },
        },
      };
    });
  }, [lockedAsset?.id]);

  // Auto-set weight based on asset type
  useEffect(() => {
    if (!lockedAsset) return;
    const weights = {
      sword: 0.75, axe: 0.75, dagger: 0.75, staff: 0.75,
      hero: 0.80, character: 0.80,
      creature: 0.78, beast: 0.78,
      animal: 0.75,
      pixel: 0.62,
      lowpoly: 0.65,
      prop: 0.70, building: 0.65
    };
    setIpaWeight(weights[lockedAsset.assetType] || 0.70);
  }, [lockedAsset]);

  const totalApproved = Object.values(smeltedViews).filter(v => v && v.quality?.passed).length;

  const handleUpdateView = (viewType, data) => {
    onUpdateViews(prev => ({ ...prev, [viewType]: data }));
  };

  const handleGenerateAll = async () => {
    // Logic for sequential batch generation would go here
    // For now, users trigger them individually to ensure FRONT is good first
    setBatchMode(true);
  };

  return (
    <div className="flex flex-col h-full bg-surface-900 overflow-hidden">
      
      {/* ── Header: Locked Reference ────────────────────────────────────────── */}
      <div className="flex items-center gap-6 p-6 bg-surface-800/60 border-b border-orange-500/30 shadow-lg relative z-10">
        <div className="relative shrink-0 w-32 h-32 bg-surface-950 rounded-xl border-4 border-yellow-500/50 flex items-center justify-center overflow-hidden shadow-orange-900/20 shadow-2xl">
          {lockedAsset ? (
            <>
              <img 
                src={`/api/generate/image/${lockedAsset.filename}`} 
                className="w-full h-full object-cover"
                alt="Locked Ingot"
              />
              <div className="absolute top-2 left-2 bg-orange-500 text-surface-900 rounded-lg px-1.5 py-0.5 flex items-center justify-center text-[10px] font-bold shadow-md uppercase tracking-tighter">
                LOCKED
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 opacity-30">
              <span className="text-4xl text-yellow-500">🔥</span>
              <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">Empty</span>
            </div>
          )}
        </div>
        
        <div className="flex-1">
          {lockedAsset ? (
            <>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-2xl font-black text-slate-100 uppercase tracking-tight font-mono text-orange-500">
                  Ingot Smelting
                </h2>
                <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-[11px] font-black uppercase border-2 border-yellow-500/30">
                  {lockedAsset.assetType}
                </span>
                {tinkerMode && (
                  <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-[11px] font-black uppercase border-2 border-yellow-500/50 tracking-wider">
                    ⚙ Tinker Mode
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400 italic line-clamp-2 max-w-2xl leading-relaxed border-l-2 border-orange-500/40 pl-4 bg-orange-500/5 py-2 rounded-r-lg">
                "{lockedAsset.prompt}"
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-black text-slate-500 uppercase tracking-tight font-mono">
                Ingot not selected
              </h2>
              <p className="text-sm text-slate-600 italic">
                Return to the Forge tab and click "Lock Source" to begin the smelting process.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button 
            onClick={onChangeSource}
            className="px-6 py-2.5 bg-surface-700 hover:bg-orange-600/20 hover:border-orange-500 text-slate-200 text-xs font-bold rounded-xl border border-surface-600 transition-all uppercase tracking-wider"
          >
            {lockedAsset ? 'Reselect Ingot' : 'Return to Forge'}
          </button>
        </div>
      </div>

      {/* ── Main View Grid ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-8 bg-gradient-to-b from-surface-900 to-surface-950">
        <div className="max-w-6xl mx-auto">
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            {[
              { type: 'front', label: 'FRONT FACE', required: true },
              { type: 'left',  label: 'LEFT PROFILE', required: true },
              { type: 'right', label: 'RIGHT PROFILE', required: true },
              { type: 'back',  label: 'REAR FACE', required: false }
            ].map(slot => (
              <div key={slot.type} className="relative group">
                <div className={`relative rounded-2xl border-2 transition-all ${
                  (slot.required || smeltedViews[slot.type]) 
                    ? 'border-orange-500/60 bg-surface-800/40' 
                    : 'border-surface-700/50 bg-surface-900/20'
                }`}>
                  <ViewSlot
                    type={slot.type}
                    label={slot.label}
                    required={slot.required}
                    lockedAsset={lockedAsset}
                    ipaWeight={ipaWeight}
                    useCanny={useCanny}
                    viewData={smeltedViews[slot.type]}
                    onUpdate={data => handleUpdateView(slot.type, data)}
                    tinkerMode={tinkerMode}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── Controls & Gate ─────────────────────────────────────────────── */}
          <div className="bg-surface-800/80 backdrop-blur-md rounded-2xl p-8 border-2 border-yellow-500/20 shadow-2xl shadow-orange-950/20 flex items-center justify-between">
            <div className="flex items-center gap-10">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-yellow-500/70 font-black uppercase tracking-[0.2em]">
                    Heat Intensity (IPA)
                  </label>
                  <span className="text-xs font-mono text-orange-500 font-black bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                    {(ipaWeight * 100).toFixed(0)}%
                  </span>
                </div>
                <input 
                  type="range" min="0.5" max="0.95" step="0.01" 
                  value={ipaWeight} onChange={e => setIpaWeight(parseFloat(e.target.value))}
                  className="w-56 h-1.5 bg-surface-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
              </div>

              <div className="h-12 w-[2px] bg-gradient-to-b from-yellow-500/30 to-orange-500/30 rounded-full" />

              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setUseCanny(!useCanny)}
                  className={`w-12 h-6 rounded-full relative transition-all shadow-inner ${useCanny ? 'bg-orange-600' : 'bg-surface-600'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-md ${useCanny ? 'right-1' : 'left-1'}`} />
                </button>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-100 font-black uppercase tracking-tight">Lock Silhouette</span>
                  <span className="text-[10px] text-slate-500 font-medium">ControlNet Canny Guidance</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              {tinkerMode ? (
                <div className="text-right border-r-2 border-yellow-500/30 pr-6">
                  <div className="text-[10px] text-yellow-500/50 uppercase tracking-[0.15em] font-black mb-1">
                    Smelt Purity
                  </div>
                  <div className="text-base font-black uppercase tracking-tighter text-yellow-400">
                    ⚙ Bypassed
                  </div>
                </div>
              ) : totalApproved > 0 && (
                <div className="text-right border-r-2 border-surface-700 pr-6">
                  <div className="text-[10px] text-yellow-500/50 uppercase tracking-[0.15em] font-black mb-1">
                    Smelt Purity
                  </div>
                  <div className={`text-base font-black uppercase tracking-tighter ${totalApproved >= 3 ? 'text-green-400' : 'text-orange-400'}`}>
                    {totalApproved === 4 ? '✨ Pure' : totalApproved === 3 ? '⚡ High' : '🔥 Low'}
                  </div>
                </div>
              )}

              <button
                disabled={!canProceed}
                onClick={onProceed}
                className={`group flex items-center gap-3 px-10 py-4 rounded-xl font-black uppercase tracking-[0.1em] text-sm transition-all shadow-xl ${
                  canProceed 
                    ? 'bg-gradient-to-r from-orange-600 to-yellow-500 text-surface-950 hover:scale-105 active:scale-95 shadow-orange-500/20' 
                    : 'bg-surface-700 text-slate-500 cursor-not-allowed border border-surface-600/50'
                }`}
              >
                {canProceed ? 'Cast Final Mesh' : 'Awaiting Smelt'}
                <span className="text-lg transition-transform group-hover:translate-x-1">⬡</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
