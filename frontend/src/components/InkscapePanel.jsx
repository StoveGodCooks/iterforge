import { useState, useEffect } from 'react';

const ROTATE_OPTIONS = [
  { label: '↻ 90°',  angle: 90 },
  { label: '↺ 90°',  angle: -90 },
  { label: '↻ 180°', angle: 180 },
];

/**
 * InkscapePanel — inline image editing tools.
 * Mirrors MeshPanel layout/pattern from Blender integration.
 *
 * Props:
 *   currentImage   — history entry to edit
 *   onClose        — collapse panel
 *   onEdited       — called with new filename after an op completes
 */
export default function InkscapePanel({ currentImage, onClose, onEdited, onPreviewFilter }) {
  const [inkStatus,    setInkStatus]    = useState(null);   // null | { found, version }
  const [busy,         setBusy]         = useState(false);
  const [busyLabel,    setBusyLabel]    = useState('');
  const [error,        setError]        = useState(null);
  const [resizeW,      setResizeW]      = useState('');
  const [resizeH,      setResizeH]      = useState('');
  const [openingFull,  setOpeningFull]  = useState(false);

  // Color adjustment state
  const [brightness,   setBrightness]   = useState(0);   // -100 to +100
  const [contrast,     setContrast]     = useState(0);
  const [saturation,   setSaturation]   = useState(0);
  const [hueRotate,    setHueRotate]    = useState(0);   // 0 to 360

  useEffect(() => {
    fetch('/api/inkscape/status')
      .then(r => r.json())
      .then(setInkStatus)
      .catch(() => setInkStatus({ found: false }));
  }, []);

  // Emit CSS filter string whenever any color slider changes
  useEffect(() => {
    const f = [
      brightness !== 0 ? `brightness(${1 + brightness / 100})` : '',
      contrast   !== 0 ? `contrast(${1 + contrast / 100})`     : '',
      saturation !== 0 ? `saturate(${1 + saturation / 100})`   : '',
      hueRotate  !== 0 ? `hue-rotate(${hueRotate}deg)`         : '',
    ].filter(Boolean).join(' ');
    onPreviewFilter?.(f || '');
  }, [brightness, contrast, saturation, hueRotate]);

  function resetColorSliders() {
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setHueRotate(0);
    onPreviewFilter?.('');
  }

  const anyColorChanged = brightness !== 0 || contrast !== 0 || saturation !== 0 || hueRotate !== 0;

  async function applyColorAdjust() {
    if (!currentImage?.filename || !anyColorChanged) return;
    const filterStr = [
      brightness !== 0 ? `brightness(${1 + brightness / 100})` : '',
      contrast   !== 0 ? `contrast(${1 + contrast / 100})`     : '',
      saturation !== 0 ? `saturate(${1 + saturation / 100})`   : '',
      hueRotate  !== 0 ? `hue-rotate(${hueRotate}deg)`         : '',
    ].filter(Boolean).join(' ');

    setError(null);
    setBusy(true);
    setBusyLabel('color-adjust');

    try {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload  = resolve;
        img.onerror = reject;
        img.src = `/api/generate/image/${currentImage.filename}?t=${Date.now()}`;
      });

      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.filter = filterStr;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = canvas.toDataURL('image/png');

      const r = await fetch('/api/inkscape/paint-apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          imageData,
          filename:  currentImage.filename,
          historyId: currentImage.id,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Color apply failed');
      } else {
        onEdited?.(data.filename);
        resetColorSliders();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  const missing = inkStatus && !inkStatus.found;
  const canRun  = !busy && !missing && currentImage;

  async function runOp(op, params = {}) {
    if (!canRun) return;
    setError(null);
    setBusy(true);
    setBusyLabel(op);
    try {
      const r = await fetch('/api/inkscape/quick-op', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          filename:  currentImage.filename,
          historyId: currentImage.id,
          op,
          params,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Operation failed');
      } else {
        onEdited?.(data.filename);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  async function openInInkscape() {
    if (!currentImage?.filename) return;
    setOpeningFull(true);
    try {
      const r = await fetch('/api/inkscape/open', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filename: currentImage.filename, historyId: currentImage.id }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.notFound) setError('Inkscape not found — run Setup');
      }
    } finally {
      setOpeningFull(false);
    }
  }

  return (
    <div className="bg-surface-800/60 rounded-xl border border-surface-700/50 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-700/40">
        <span className="text-xs font-semibold text-slate-300">✏ Edit Image</span>
        <div className="flex items-center gap-3">
          {inkStatus?.found && (
            <span className="text-[9px] text-green-500 font-mono">
              Inkscape {inkStatus.version ?? ''}
            </span>
          )}
          {missing && <span className="text-[9px] text-yellow-500">Inkscape not found</span>}
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 text-sm transition-colors">✕</button>
        </div>
      </div>

      <div className="px-4 py-3 flex flex-col gap-4">

        {/* ── Rotate ── */}
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Rotate</p>
          <div className="flex gap-1.5">
            {ROTATE_OPTIONS.map(opt => (
              <button
                key={opt.angle}
                disabled={!canRun}
                onClick={() => runOp('rotate', { angle: opt.angle })}
                className="flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all
                  bg-surface-900/40 border-surface-600/30 text-slate-400
                  hover:text-slate-200 hover:border-surface-500/50
                  disabled:opacity-40 disabled:cursor-not-allowed">
                {busy && busyLabel === 'rotate' ? '⏳' : opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Flip ── */}
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Flip</p>
          <div className="flex gap-1.5">
            <button
              disabled={!canRun}
              onClick={() => runOp('flip', { axis: 'h' })}
              className="flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all
                bg-surface-900/40 border-surface-600/30 text-slate-400
                hover:text-slate-200 hover:border-surface-500/50
                disabled:opacity-40 disabled:cursor-not-allowed">
              ↔ Horizontal
            </button>
            <button
              disabled={!canRun}
              onClick={() => runOp('flip', { axis: 'v' })}
              className="flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all
                bg-surface-900/40 border-surface-600/30 text-slate-400
                hover:text-slate-200 hover:border-surface-500/50
                disabled:opacity-40 disabled:cursor-not-allowed">
              ↕ Vertical
            </button>
          </div>
        </div>

        {/* ── Resize ── */}
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Resize</p>
          <div className="flex gap-1.5 items-center">
            <input
              type="number"
              placeholder="W px"
              value={resizeW}
              onChange={e => setResizeW(e.target.value)}
              className="w-20 px-2 py-1.5 rounded-lg border border-surface-600/40 bg-surface-900/60
                text-[10px] text-slate-300 placeholder-slate-600
                focus:outline-none focus:border-brand-500/60"
            />
            <span className="text-slate-600 text-[10px]">×</span>
            <input
              type="number"
              placeholder="H px"
              value={resizeH}
              onChange={e => setResizeH(e.target.value)}
              className="w-20 px-2 py-1.5 rounded-lg border border-surface-600/40 bg-surface-900/60
                text-[10px] text-slate-300 placeholder-slate-600
                focus:outline-none focus:border-brand-500/60"
            />
            <button
              disabled={!canRun || (!resizeW && !resizeH)}
              onClick={() => runOp('resize', {
                width:  resizeW ? parseInt(resizeW) : undefined,
                height: resizeH ? parseInt(resizeH) : undefined,
              })}
              className="flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all
                bg-surface-900/40 border-surface-600/30 text-slate-400
                hover:text-slate-200 hover:border-surface-500/50
                disabled:opacity-40 disabled:cursor-not-allowed">
              {busy && busyLabel === 'resize' ? '⏳' : 'Apply'}
            </button>
          </div>
          {/* Quick resize presets */}
          <div className="flex gap-1 mt-1.5">
            {[256, 512, 1024, 2048].map(s => (
              <button
                key={s}
                disabled={!canRun}
                onClick={() => runOp('resize', { width: s, height: s })}
                className="flex-1 py-1 rounded-md border text-[9px] font-mono transition-all
                  bg-surface-900/30 border-surface-600/20 text-slate-600
                  hover:text-slate-300 hover:border-surface-500/40
                  disabled:opacity-40 disabled:cursor-not-allowed">
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Color Adjustments ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Color</p>
            <div className="flex gap-1.5">
              <button
                onClick={resetColorSliders}
                disabled={!anyColorChanged}
                className="px-2 py-0.5 rounded text-[9px] border transition-all
                  bg-surface-900/40 border-surface-600/30 text-slate-500
                  hover:text-slate-300 hover:border-surface-500/50
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Reset
              </button>
              <button
                onClick={applyColorAdjust}
                disabled={!canRun || !anyColorChanged}
                className="px-2 py-0.5 rounded text-[9px] font-semibold border transition-all
                  bg-brand-600/20 border-brand-500/50 text-brand-300
                  hover:bg-brand-600/30 hover:border-brand-400/70
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {busy && busyLabel === 'color-adjust' ? '⏳' : 'Apply Colors'}
              </button>
            </div>
          </div>

          {[
            { label: 'Brightness', value: brightness, set: setBrightness, min: -100, max: 100 },
            { label: 'Contrast',   value: contrast,   set: setContrast,   min: -100, max: 100 },
            { label: 'Saturation', value: saturation, set: setSaturation, min: -100, max: 100 },
            { label: 'Hue Rotate', value: hueRotate,  set: setHueRotate,  min: 0,    max: 360 },
          ].map(({ label, value, set, min, max }) => (
            <div key={label} className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] text-slate-500 w-20 shrink-0">
                {label}{' '}
                <span className={`font-mono ${value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-slate-600'}`}>
                  {value > 0 ? `+${value}` : value}
                </span>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={e => set(Number(e.target.value))}
                className="flex-1"
              />
            </div>
          ))}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-[10px] text-red-400">
            {error}
          </div>
        )}

        {/* ── Busy indicator ── */}
        {busy && (
          <div className="px-3 py-2 rounded-lg bg-surface-700/40 text-[10px] text-slate-400 font-mono">
            ⏳ Running {busyLabel}…
          </div>
        )}

        {/* ── Divider ── */}
        <div className="border-t border-surface-700/40" />

        {/* ── Open in full Inkscape ── */}
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Full Editor
          </p>
          <button
            onClick={openInInkscape}
            disabled={!canRun || openingFull}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all border
              bg-indigo-600/20 border-indigo-500/40 text-indigo-300
              hover:bg-indigo-600/30 hover:border-indigo-400/60
              disabled:opacity-40 disabled:cursor-not-allowed">
            {openingFull ? '✏ Opening Inkscape…' : '✏ Open in Inkscape'}
          </button>
          <p className="text-[9px] text-slate-600 text-center mt-1">
            Opens full Inkscape — Ctrl+S syncs back to Inter-Forge
          </p>
        </div>

        {missing && (
          <p className="text-[9px] text-slate-600 text-center -mt-2">
            Inkscape not found — run ⚙ Setup to install
          </p>
        )}
      </div>
    </div>
  );
}
