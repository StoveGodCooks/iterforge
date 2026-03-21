import { useState, useEffect, useRef } from 'react';
import ModelViewer    from './ModelViewer.jsx';
import InkscapePanel  from './InkscapePanel.jsx';
import PaintCanvas    from './PaintCanvas.jsx';

export default function PreviewArea({ currentImage, history, onSelect, onDelete, onReuseSettings, onGenerated, historyLoading, onOpenSettings, onCursorChange, onForgeThis }) {
  const [zoom,           setZoom]           = useState(false);
  const [expandPrompt,   setExpandPrompt]   = useState(false);
  const [copiedSeed,     setCopiedSeed]     = useState(null);  // null | 'ok' | 'err'
  const [copiedPrompt,   setCopiedPrompt]   = useState(null);  // null | 'ok' | 'err'
  const [expandFrames,   setExpandFrames]   = useState(false);
  const [clearingAll,    setClearingAll]    = useState(false);
  const [clearConfirm,   setClearConfirm]   = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [imgLoaded,      setImgLoaded]      = useState(false);
  const [expandInkscape,   setExpandInkscape]   = useState(false);
  const [expandPaint,      setExpandPaint]      = useState(false);
  const [previewFilter,    setPreviewFilter]    = useState('');
  const [openingBlender,   setOpeningBlender]   = useState(false);
  const [rotating,         setRotating]         = useState(false);
  const prevImgId = useRef(null);

  // Update cursor based on which panel is open
  useEffect(() => {
    if (expandPaint || expandInkscape) onCursorChange?.('painting');
    else onCursorChange?.('default');
  }, [expandPaint, expandInkscape]);

  // Reset image loading state and close panels when image changes
  useEffect(() => {
    if (currentImage?.id !== prevImgId.current) {
      setImgLoaded(false);
      setExpandInkscape(false);
      setExpandPaint(false);
      setPreviewFilter('');
      prevImgId.current = currentImage?.id ?? null;
    }
  }, [currentImage?.id]);

  // Escape key closes zoom modal
  useEffect(() => {
    if (!zoom) return;
    function onKey(e) { if (e.key === 'Escape') setZoom(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  // Read blender path from settings for the x-blender-path header
  function getBlenderPath() {
    try {
      return JSON.parse(localStorage.getItem('iterforge_settings') ?? '{}').blenderPath || null;
    } catch { return null; }
  }

  async function handleRotate(direction) {
    if (!currentImage?.filename || rotating) return;
    setRotating(true);
    try {
      const r = await fetch('/api/generate/rotate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: currentImage.filename, direction }),
      });
      const data = await r.json();
      if (data.success) {
        // Force image reload via cache-bust — onGenerated triggers history re-fetch
        onGenerated?.({ ...currentImage, timestamp: data.timestamp });
      }
    } finally {
      setRotating(false);
    }
  }

  async function handleOpenInBlender(entry) {
    if (!entry?.blendPath) return;
    setOpeningBlender(true);
    try {
      const headers = { 'Content-Type': 'application/json' };
      const bp = getBlenderPath();
      if (bp) headers['x-blender-path'] = bp;
      await fetch('/api/blender/open-gui', {
        method:  'POST',
        headers,
        body:    JSON.stringify({ blendFile: entry.blendPath }),
      });
    } finally {
      setOpeningBlender(false);
    }
  }

  function imgUrl(entry) {
    const t = entry?.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
    if (entry?.type === 'triposr') {
      // Use the source 2D image as thumbnail — GLBs can't render in <img>
      return entry.sourceImage
        ? `/api/generate/image/${entry.sourceImage}?t=${t}`
        : `/api/generate/image/${entry.filename}?t=${t}`;
    }
    if (entry?.type === '3d') {
      return entry.previewFilename
        ? `/api/blender/preview/${entry.previewFilename}?t=${t}`
        : `/api/blender/model/${entry.filename}?t=${t}`;
    }
    return `/api/generate/image/${entry.filename}?t=${t}`;
  }

  function glbUrl(entry) {
    const t = entry?.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
    if (entry?.type === 'triposr') return `/api/triposr/model/${entry.filename}?t=${t}`;
    return `/api/blender/model/${entry.filename}?t=${t}`;
  }

  async function handleDownload(entry) {
    if (!entry?.filename) return;
    const a   = document.createElement('a');
    a.href     = imgUrl(entry);
    a.download = entry.filename;
    a.click();
  }

  async function handleDelete(entry) {
    if (!entry?.id) return;
    if (deleteConfirmId !== entry.id) {
      setDeleteConfirmId(entry.id);
      return;
    }
    setDeleteConfirmId(null);
    // triposr entries are in-memory only — no server history record to delete
    if (entry.type !== 'triposr') {
      await fetch(`/api/history/${entry.id}`, { method: 'DELETE' });
    }
    onDelete(entry.id);
  }

  async function handleClearAll() {
    if (!clearConfirm) { setClearConfirm(true); return; }
    setClearConfirm(false);
    setClearingAll(true);
    try {
      await fetch('/api/history/all', { method: 'DELETE' });
      history.forEach(e => onDelete(e.id));
    } finally {
      setClearingAll(false);
    }
  }

  function copySeed(seed) {
    navigator.clipboard.writeText(String(seed))
      .then(() => { setCopiedSeed('ok'); setTimeout(() => setCopiedSeed(null), 1500); })
      .catch(() => { setCopiedSeed('err'); setTimeout(() => setCopiedSeed(null), 1500); });
  }

  function copyPrompt(prompt) {
    navigator.clipboard.writeText(prompt)
      .then(() => { setCopiedPrompt('ok'); setTimeout(() => setCopiedPrompt(null), 1500); })
      .catch(() => { setCopiedPrompt('err'); setTimeout(() => setCopiedPrompt(null), 1500); });
  }

  return (
    <div className="flex h-full">
      {/* Main preview — overflow-y-auto enables scroll wheel to reach metadata below image */}
      <div data-tutorial="preview-area" className={`flex-1 flex flex-col items-center min-w-0 p-6 overflow-y-auto ${currentImage ? 'justify-start' : 'justify-center'}`}>
        {currentImage ? (
          <>
            {/* Image or 3D viewer */}
            <div className={`relative ${zoom ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6' : 'max-w-2xl w-full'}`}>
              {(currentImage.type === '3d' || currentImage.type === 'triposr') ? (
                /* 3D GLB viewer — Babylon.js web component */
                <ModelViewer
                  glbUrl={glbUrl(currentImage)}
                  className="rounded-xl shadow-2xl"
                />
              ) : (
                <>
                  {/* Loading skeleton */}
                  {!imgLoaded && (
                    <div className={`${zoom ? 'w-full max-w-2xl aspect-square' : 'w-full aspect-square'} rounded-xl bg-surface-700/50 animate-pulse flex items-center justify-center`}>
                      <span className="text-slate-600 text-sm">Loading…</span>
                    </div>
                  )}
                  <img
                    src={imgUrl(currentImage)}
                    alt={currentImage.prompt}
                    onLoad={() => setImgLoaded(true)}
                    onError={() => setImgLoaded(true)}
                    onClick={() => setZoom(v => !v)}
                    style={previewFilter ? { filter: previewFilter } : undefined}
                    className={`rounded-xl shadow-2xl cursor-zoom-in object-contain ${zoom ? 'max-h-full max-w-full' : 'w-full'} ${imgLoaded ? '' : 'hidden'}`}
                  />
                </>
              )}
              {zoom && (
                <button onClick={() => setZoom(false)}
                  className="absolute top-4 right-4 bg-surface-800/90 backdrop-blur-sm text-slate-300 rounded-full w-9 h-9 flex items-center justify-center text-lg hover:bg-surface-700 hover:text-white transition-all">
                  ✕
                </button>
              )}
            </div>

            {/* Metadata + actions */}
            {!zoom && (
              <div className="mt-4 w-full max-w-2xl flex flex-col gap-2">
                {/* Prompt row */}
                <div className="bg-surface-800/60 rounded-xl px-4 py-3 border border-surface-700/50">
                  <div className="flex items-start gap-2">
                    <p
                      onClick={() => setExpandPrompt(v => !v)}
                      className={`flex-1 text-sm text-slate-200 cursor-pointer hover:text-white transition-colors leading-snug ${expandPrompt ? '' : 'truncate'}`}
                      title="Click to expand">
                      {currentImage.prompt}
                    </p>
                    <button
                      onClick={() => copyPrompt(currentImage.prompt)}
                      className={`shrink-0 text-[10px] px-2 py-0.5 rounded hover:bg-surface-600 transition-all border ${
                        copiedPrompt === 'err'
                          ? 'bg-red-900/40 border-red-700/50 text-red-400'
                          : 'bg-surface-700 border-surface-600/50 text-slate-400 hover:text-slate-200'
                      }`}>
                      {copiedPrompt === 'ok' ? '✓' : copiedPrompt === 'err' ? '✗' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Pills + buttons row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Clickable seed pill */}
                  <button
                    onClick={() => copySeed(currentImage.seed)}
                    title="Click to copy seed"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-700/60 hover:bg-surface-600/60 border border-surface-600/40 transition-all group">
                    <span className="text-[10px] text-slate-500 group-hover:text-slate-400">Seed</span>
                    <span className="text-[10px] text-slate-300 font-mono">{currentImage.seed}</span>
                    <span className={`text-[9px] transition-colors ml-0.5 ${copiedSeed === 'err' ? 'text-red-400' : 'text-slate-600 group-hover:text-brand-400'}`}>
                      {copiedSeed === 'ok' ? '✓' : copiedSeed === 'err' ? '✗' : '⎘'}
                    </span>
                  </button>

                  {currentImage.backend && (
                    <Pill label="Backend" value={currentImage.backend} />
                  )}
                  {currentImage.params?.steps && (
                    <Pill label="Steps" value={currentImage.params.steps} />
                  )}
                  {currentImage.params?.width && (
                    <Pill label="Size" value={`${currentImage.params.width}×${currentImage.params.height}`} />
                  )}

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Action buttons */}
                  {/* Rotate — shown for 2D images, useful before meshing */}
                  {currentImage.type !== '3d' && currentImage.type !== 'triposr' && (
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => handleRotate('ccw')}
                        disabled={rotating}
                        title="Rotate 90° counter-clockwise"
                        className="px-2 py-1.5 rounded-l-lg text-xs font-medium transition-all border bg-surface-700 hover:bg-surface-600 border-surface-600/50 text-slate-400 hover:text-slate-200 disabled:opacity-40">
                        ↺
                      </button>
                      <button
                        onClick={() => handleRotate('cw')}
                        disabled={rotating}
                        title="Rotate 90° clockwise — straighten sword before meshing"
                        className="px-2 py-1.5 rounded-r-lg text-xs font-medium transition-all border bg-surface-700 hover:bg-surface-600 border-surface-600/50 text-slate-400 hover:text-slate-200 disabled:opacity-40">
                        ↻
                      </button>
                    </div>
                  )}
                  {/* Draw/Paint canvas toggle — shown for 2D images */}
                  {currentImage.type !== '3d' && currentImage.type !== 'triposr' && (
                    <button
                      data-tutorial="paint-btn"
                      onClick={() => { setExpandPaint(v => !v); setExpandInkscape(false); setExpandMesh(false); }}
                      title="Draw, paint or crop directly on the image"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        expandPaint
                          ? 'bg-purple-600/20 border-purple-500/60 text-purple-300'
                          : 'bg-surface-700 hover:bg-surface-600 border-surface-600/50 text-slate-400 hover:text-slate-200'
                      }`}>
                      🖌 Draw
                    </button>
                  )}
                  {/* Edit in Inkscape toggle — shown for 2D images */}
                  {currentImage.type !== '3d' && currentImage.type !== 'triposr' && (
                    <button
                      data-tutorial="edit-image-btn"
                      onClick={() => { setExpandInkscape(v => !v); setExpandMesh(false); setExpandPaint(false); }}
                      title="Rotate, resize, flip or open in full Inkscape"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        expandInkscape
                          ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                          : 'bg-surface-700 hover:bg-surface-600 border-surface-600/50 text-slate-400 hover:text-slate-200'
                      }`}>
                      ✏ Edit Image
                    </button>
                  )}
                  {/* Edit in Blender — shown for 3D entries that have a .blend file */}
                  {currentImage.type === '3d' && currentImage.blendPath && (
                    <button
                      onClick={() => handleOpenInBlender(currentImage)}
                      disabled={openingBlender}
                      title="Open this mesh in full Blender GUI — Inter-Forge will sync on save"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-700/60 hover:bg-orange-600/70 rounded-lg text-xs text-orange-200 font-medium transition-all border border-orange-600/40 disabled:opacity-50">
                      {openingBlender ? '⬡ Opening…' : '⬡ Edit in Blender'}
                    </button>
                  )}
                  {/* Forge This → send to MasterForge tab */}
                  {currentImage.type !== '3d' && currentImage.type !== 'triposr' && onForgeThis && (
                    <button
                      onClick={onForgeThis}
                      title="Send this image to the MasterForge pipeline"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border"
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        borderColor: 'rgba(255,204,0,0.5)',
                        color: 'var(--yellow)',
                        background: 'rgba(255,204,0,0.06)',
                        letterSpacing: '0.1em',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255,204,0,0.15)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,204,0,0.06)';
                      }}
                    >
                      ⬡ Forge This →
                    </button>
                  )}
                  <button onClick={() => onReuseSettings?.(currentImage)}
                    title="Load these settings back into the panel"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-xs text-slate-300 hover:text-white font-medium transition-all border border-surface-600/50">
                    ↩ Reuse
                  </button>
                  <button onClick={() => handleDownload(currentImage)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 rounded-lg text-xs text-white font-medium transition-colors">
                    ↓ Save
                  </button>
                  {deleteConfirmId === currentImage.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDelete(currentImage)}
                        className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded-lg text-xs text-white font-medium transition-all">
                        Confirm
                      </button>
                      <button onClick={() => setDeleteConfirmId(null)}
                        className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 rounded-lg text-xs text-slate-400 font-medium transition-all border border-surface-600/50">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => handleDelete(currentImage)}
                      className="px-3 py-1.5 bg-surface-700 hover:bg-red-900/40 rounded-lg text-xs text-slate-500 hover:text-red-400 font-medium transition-all border border-surface-600/50 hover:border-red-800/50">
                      Delete
                    </button>
                  )}
                </div>

                {/* Paint canvas panel — inline expand */}
                {expandPaint && currentImage.type !== '3d' && currentImage.type !== 'triposr' && (
                  <PaintCanvas
                    currentImage={currentImage}
                    onClose={() => setExpandPaint(false)}
                    onApplied={(newFilename) => {
                      onGenerated?.({ ...currentImage, filename: newFilename, timestamp: Date.now() });
                      setExpandPaint(false);
                    }}
                  />
                )}

                {/* Inkscape editing panel — inline expand */}
                {expandInkscape && currentImage.type !== '3d' && currentImage.type !== 'triposr' && (
                  <InkscapePanel
                    currentImage={currentImage}
                    onClose={() => { setExpandInkscape(false); setPreviewFilter(''); }}
                    onEdited={(newFilename) => {
                      onGenerated?.({ ...currentImage, filename: newFilename, timestamp: Date.now() });
                      setExpandInkscape(false);
                      setPreviewFilter('');
                    }}
                    onPreviewFilter={setPreviewFilter}
                  />
                )}

                {/* Sprite sheet frames */}
                {currentImage.type === 'spritesheet' && currentImage.frames?.length > 0 && (
                  <div className="bg-surface-800/60 rounded-xl border border-surface-700/50 overflow-hidden">
                    <button
                      onClick={() => setExpandFrames(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                      <span className="font-medium">⊞ Individual Frames ({currentImage.frames.length})</span>
                      <span className="text-slate-600">{expandFrames ? '▲' : '▼'}</span>
                    </button>
                    {expandFrames && (
                      <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
                        {currentImage.frames.map((frame, i) => (
                          <div key={i} className="relative group">
                            <img
                              src={`/api/sprite-sheet/frame/${frame.filename}`}
                              alt={`Frame ${i + 1}`}
                              className="w-full aspect-square object-cover rounded-lg border border-surface-600/40"
                            />
                            <a
                              href={`/api/sprite-sheet/frame/${frame.filename}`}
                              download={frame.filename}
                              className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-white font-medium">
                              ↓ Save
                            </a>
                            <span className="absolute top-0.5 left-0.5 bg-surface-900/80 text-[8px] text-slate-400 px-1 rounded">{i + 1}</span>
                            {frame.pose && (
                              <span className="absolute bottom-0.5 left-0 right-0 mx-auto text-center bg-surface-900/80 text-[7px] text-slate-500 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity truncate">
                                {frame.pose}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </div>

      {/* History strip */}
      {(history.length > 0 || historyLoading) && (
        <aside className="w-36 shrink-0 border-l border-surface-700 bg-surface-800/50 overflow-y-auto p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-1 mb-0.5">
            <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wider">History</p>
            {history.length > 0 && !historyLoading && (
              clearConfirm ? (
                <div className="flex gap-1">
                  <button
                    onClick={handleClearAll}
                    disabled={clearingAll}
                    className="text-[9px] text-red-400 hover:text-red-300 transition-colors disabled:opacity-40 cursor-not-allowed">
                    {clearingAll ? '…' : 'Yes'}
                  </button>
                  <button
                    onClick={() => setClearConfirm(false)}
                    className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors">
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleClearAll}
                  disabled={clearingAll}
                  title="Clear all history"
                  className={`text-[9px] text-slate-600 hover:text-red-400 transition-colors ${clearingAll ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  {clearingAll ? '…' : 'Clear all'}
                </button>
              )
            )}
          </div>

          {/* Loading skeleton */}
          {historyLoading && history.length === 0 && (
            <>
              {[0, 1, 2].map(i => (
                <div key={i} className="w-full aspect-square rounded-lg bg-surface-700/40 animate-pulse" />
              ))}
            </>
          )}

          {history.map(entry => (
            <button key={entry.id} onClick={() => onSelect(entry)}
              className={`w-full rounded-lg overflow-hidden aspect-square transition-all hover:ring-2 hover:ring-brand-500/70 relative group ${
                currentImage?.id === entry.id ? 'ring-2 ring-brand-400' : ''
              }`}>
              <img
                src={imgUrl(entry)}
                alt={entry.prompt}
                className="w-full h-full object-cover"
              />
              {entry.type === 'spritesheet' && (
                <span className="absolute bottom-1 right-1 bg-surface-900/80 text-[8px] text-brand-400 px-1 rounded">⊞</span>
              )}
              {entry.type === 'triposr' && (
                <span className="absolute bottom-1 right-1 bg-surface-900/80 text-[8px] text-cyan-400 px-1 rounded">⬡ 3D</span>
              )}
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}

function Pill({ label, value }) {
  return (
    <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-700/40 border border-surface-600/30 text-[10px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300">{value}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-5 select-none max-w-sm text-center">
      <div className="w-24 h-24 rounded-2xl bg-surface-700/30 border border-surface-600/30 flex items-center justify-center text-4xl">
        🎨
      </div>
      <div>
        <p className="text-base text-slate-300 font-semibold mb-1">No image yet</p>
        <p className="text-sm text-slate-500 leading-relaxed">
          Pick an asset type and art style on the left, then hit <span className="text-slate-300 font-medium">✦ Generate</span>.
        </p>
        <p className="text-xs text-slate-600 mt-3">
          Tip: Use <kbd className="px-1 py-0.5 bg-surface-700 rounded text-[10px] border border-surface-600">Ctrl+Enter</kbd> to generate quickly.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-1 opacity-60">
        {['Character', 'Sprite Sheet', 'Texture', 'Environment', 'UI Element', 'Concept Art'].map(t => (
          <span key={t} className="px-2 py-1.5 bg-surface-700/40 border border-surface-600/30 rounded-lg text-[10px] text-slate-500">{t}</span>
        ))}
      </div>
    </div>
  );
}
