import { useState, useRef, useEffect, useCallback } from 'react';

const TOOLS = [
  { id: 'brush',  label: '🖌 Brush' },
  { id: 'eraser', label: '◻ Eraser' },
  { id: 'crop',   label: '✂ Crop' },
];

export default function PaintCanvas({ currentImage, onClose, onApplied }) {
  const [tool,       setTool]       = useState('brush');
  const [color,      setColor]      = useState('#ff4444');
  const [size,       setSize]       = useState(8);
  const [opacity,    setOpacity]    = useState(0.8);
  const [applying,   setApplying]   = useState(false);
  const [error,      setError]      = useState(null);

  // Crop state
  const [cropStart,  setCropStart]  = useState(null);   // { x, y } in canvas coords
  const [cropRect,   setCropRect]   = useState(null);   // { x, y, w, h }
  const [isCropping, setIsCropping] = useState(false);

  const imgRef        = useRef(null);
  const canvasRef     = useRef(null);
  const cropOverlayRef = useRef(null);
  const isDrawingRef  = useRef(false);
  const lastPosRef    = useRef(null);
  const containerRef  = useRef(null);

  // Resize canvas to match image display size
  const syncCanvasSize = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const { width, height } = img.getBoundingClientRect();
    if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
      // Preserve existing drawing
      const tmp = document.createElement('canvas');
      tmp.width  = canvas.width;
      tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width  = Math.round(width);
      canvas.height = Math.round(height);
      canvas.getContext('2d').drawImage(tmp, 0, 0, canvas.width, canvas.height);
    }
  }, []);

  useEffect(() => {
    const obs = new ResizeObserver(syncCanvasSize);
    if (imgRef.current) obs.observe(imgRef.current);
    return () => obs.disconnect();
  }, [syncCanvasSize]);

  function getCanvasPos(e) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  // ── Drawing handlers ──
  function handleMouseDown(e) {
    if (tool === 'crop') {
      const pos = getCanvasPos(e);
      setCropStart(pos);
      setCropRect(null);
      setIsCropping(true);
      return;
    }
    isDrawingRef.current = true;
    lastPosRef.current = getCanvasPos(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
  }

  function handleMouseMove(e) {
    if (tool === 'crop' && isCropping && cropStart) {
      const pos = getCanvasPos(e);
      setCropRect({
        x: Math.min(cropStart.x, pos.x),
        y: Math.min(cropStart.y, pos.y),
        w: Math.abs(pos.x - cropStart.x),
        h: Math.abs(pos.y - cropStart.y),
      });
      return;
    }
    if (!isDrawingRef.current) return;
    const pos = getCanvasPos(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle  = color;
    ctx.globalAlpha  = opacity;
    ctx.lineWidth    = size;
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';

    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);

    lastPosRef.current = pos;
  }

  function handleMouseUp(e) {
    if (tool === 'crop') {
      setIsCropping(false);
      return;
    }
    if (isDrawingRef.current) {
      // Draw a dot if no movement
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    isDrawingRef.current = false;
    lastPosRef.current = null;
  }

  function handleMouseLeave() {
    if (tool !== 'crop') {
      isDrawingRef.current = false;
      lastPosRef.current = null;
    }
  }

  // ── Clear ──
  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setCropRect(null);
  }

  // ── Crop ──
  async function handleCropApply() {
    if (!cropRect || !cropRect.w || !cropRect.h) return;
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    // Scale factors: canvas display px vs natural image px
    const scaleX = img.naturalWidth  / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;

    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.round(cropRect.w * scaleX);
    offscreen.height = Math.round(cropRect.h * scaleY);
    const ctx = offscreen.getContext('2d');

    // Draw source image cropped region
    ctx.drawImage(
      img,
      cropRect.x * scaleX,
      cropRect.y * scaleY,
      offscreen.width,
      offscreen.height,
      0, 0,
      offscreen.width,
      offscreen.height,
    );

    // Composite any paint strokes in that region
    ctx.drawImage(
      canvas,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0, 0,
      offscreen.width,
      offscreen.height,
    );

    const imageData = offscreen.toDataURL('image/png');
    await postApply(imageData);
  }

  // ── Apply (paint composite) ──
  async function handleApply() {
    if (tool === 'crop') { await handleCropApply(); return; }

    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img || !currentImage?.filename) return;

    const offscreen = document.createElement('canvas');
    offscreen.width  = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext('2d');

    // Draw original image
    ctx.drawImage(img, 0, 0, offscreen.width, offscreen.height);

    // Composite the paint layer on top (scaled to natural size)
    ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);

    const imageData = offscreen.toDataURL('image/png');
    await postApply(imageData);
  }

  async function postApply(imageData) {
    if (!currentImage?.filename) return;
    setError(null);
    setApplying(true);
    try {
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
        setError(data.error || 'Apply failed');
      } else {
        handleClear();
        setCropRect(null);
        onApplied?.(data.filename);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const imgSrc = currentImage?.filename
    ? `/api/generate/image/${currentImage.filename}?t=${Date.now()}`
    : null;

  const hasCrop = tool === 'crop' && cropRect && cropRect.w > 2 && cropRect.h > 2;

  return (
    <div className="bg-surface-800/60 rounded-xl border border-surface-700/50 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-700/40">
        <span className="text-xs font-semibold text-slate-300">🎨 Paint &amp; Crop</span>
        <button
          onClick={onClose}
          className="text-slate-600 hover:text-slate-300 text-sm transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">

        {/* Tool selector */}
        <div className="flex gap-1.5">
          {TOOLS.map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                tool === t.id
                  ? 'bg-brand-600/20 border-brand-500/60 text-brand-300'
                  : 'bg-surface-900/40 border-surface-600/30 text-slate-500 hover:text-slate-300 hover:border-surface-500/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Brush / Eraser controls */}
        {(tool === 'brush' || tool === 'eraser') && (
          <div className="flex flex-col gap-2 px-1">
            {tool === 'brush' && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-10 shrink-0">Color</span>
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                />
                <span className="text-[9px] text-slate-600 font-mono">{color}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-500 w-10 shrink-0">Size</span>
              <input
                type="range"
                min={1} max={50} value={size}
                onChange={e => setSize(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-[9px] text-slate-400 font-mono w-5 text-right">{size}</span>
            </div>
            {tool === 'brush' && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-500 w-10 shrink-0">Opacity</span>
                <input
                  type="range"
                  min={0.1} max={1.0} step={0.05} value={opacity}
                  onChange={e => setOpacity(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-[9px] text-slate-400 font-mono w-8 text-right">
                  {Math.round(opacity * 100)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Crop hint */}
        {tool === 'crop' && (
          <p className="text-[9px] text-slate-600 px-1">
            Drag on the image to select the region to keep, then click Crop.
          </p>
        )}

        {/* Canvas display area */}
        {imgSrc ? (
          <div ref={containerRef} className="relative rounded-lg overflow-hidden bg-surface-900/60 border border-surface-700/40 select-none">
            <img
              ref={imgRef}
              src={imgSrc}
              alt="Edit canvas"
              className="block w-full h-auto"
              draggable={false}
              onLoad={syncCanvasSize}
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ cursor: tool === 'eraser' ? 'cell' : tool === 'crop' ? 'crosshair' : 'crosshair', touchAction: 'none' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            />
            {/* Crop selection overlay */}
            {tool === 'crop' && cropRect && cropRect.w > 0 && cropRect.h > 0 && (
              <div
                className="absolute border-2 border-brand-400 bg-brand-400/10 pointer-events-none"
                style={{
                  left:   cropRect.x,
                  top:    cropRect.y,
                  width:  cropRect.w,
                  height: cropRect.h,
                }}
              />
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-surface-900/60 border border-surface-700/40 h-32 flex items-center justify-center">
            <span className="text-[10px] text-slate-600">No image selected</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-[10px] text-red-400">
            {error}
          </div>
        )}

        {/* Action row */}
        <div className="flex gap-1.5">
          <button
            onClick={handleClear}
            className="px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all
              bg-surface-900/40 border-surface-600/30 text-slate-500
              hover:text-slate-300 hover:border-surface-500/50"
          >
            Clear
          </button>
          <button
            onClick={handleApply}
            disabled={applying || !imgSrc || (tool === 'crop' && !hasCrop)}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
              applying || !imgSrc || (tool === 'crop' && !hasCrop)
                ? 'bg-surface-700/40 text-slate-600 cursor-not-allowed'
                : 'bg-brand-600 hover:bg-brand-500 text-white'
            }`}
          >
            {applying ? '⏳ Saving…' : tool === 'crop' ? '✂ Crop' : '✓ Apply & Save'}
          </button>
        </div>

      </div>
    </div>
  );
}
