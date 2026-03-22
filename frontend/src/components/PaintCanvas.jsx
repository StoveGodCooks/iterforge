import { useState, useRef, useEffect, useCallback } from 'react';

// ── Tool groups ────────────────────────────────────────────────────────────────
const DRAW_TOOLS   = [
  { id: 'brush',    icon: '🖌',  title: 'Brush'      },
  { id: 'pen',      icon: '✒',   title: 'Pen (smooth)' },
  { id: 'eraser',   icon: '◻',   title: 'Eraser'     },
  { id: 'fill',     icon: '🪣',  title: 'Fill Bucket' },
  { id: 'eyedrop',  icon: '💧',  title: 'Eyedropper' },
];
const SHAPE_TOOLS  = [
  { id: 'line',     icon: '╱',   title: 'Line'       },
  { id: 'rect',     icon: '▭',   title: 'Rectangle'  },
  { id: 'ellipse',  icon: '○',   title: 'Ellipse'    },
  { id: 'triangle', icon: '△',   title: 'Triangle'   },
  { id: 'arrow',    icon: '→',   title: 'Arrow'      },
];
const OTHER_TOOLS  = [
  { id: 'text',     icon: 'T',   title: 'Text'       },
  { id: 'crop',     icon: '✂',   title: 'Crop'       },
];

const SHAPE_IDS = new Set(['line','rect','ellipse','triangle','arrow']);

// ── Flood fill ─────────────────────────────────────────────────────────────────
function floodFill(canvas, sx, sy, hexColor, alpha) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const i0 = (Math.round(sy) * w + Math.round(sx)) * 4;
  const tr = data[i0], tg = data[i0+1], tb = data[i0+2], ta = data[i0+3];
  const fr = parseInt(hexColor.slice(1,3),16);
  const fg = parseInt(hexColor.slice(3,5),16);
  const fb = parseInt(hexColor.slice(5,7),16);
  const fa = Math.round(alpha * 255);
  if (tr===fr && tg===fg && tb===fb && ta===fa) return;
  const tol = 28;
  const visited = new Uint8Array(w * h);
  const stack = [Math.round(sx), Math.round(sy)];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x<0||x>=w||y<0||y>=h||visited[y*w+x]) continue;
    const i = (y*w+x)*4;
    if (Math.abs(data[i]-tr)>tol||Math.abs(data[i+1]-tg)>tol||Math.abs(data[i+2]-tb)>tol||Math.abs(data[i+3]-ta)>tol) continue;
    visited[y*w+x] = 1;
    data[i]=fr; data[i+1]=fg; data[i+2]=fb; data[i+3]=fa;
    stack.push(x+1,y, x-1,y, x,y+1, x,y-1);
  }
  ctx.putImageData(imgData, 0, 0);
}

// ── Arrow helper ───────────────────────────────────────────────────────────────
function drawArrow(ctx, x1, y1, x2, y2, size) {
  const angle = Math.atan2(y2-y1, x2-x1);
  const hw = Math.max(size * 2.5, 12);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hw * Math.cos(angle - Math.PI/6), y2 - hw * Math.sin(angle - Math.PI/6));
  ctx.lineTo(x2 - hw * Math.cos(angle + Math.PI/6), y2 - hw * Math.sin(angle + Math.PI/6));
  ctx.closePath();
  ctx.fill();
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PaintCanvas({ currentImage, onClose, onApplied }) {
  const blankMode = !currentImage;

  const [tool,      setTool]      = useState('brush');
  const [color,     setColor]     = useState('#ffcc00');
  const [hexInput,  setHexInput]  = useState('#ffcc00');
  const [size,      setSize]      = useState(8);
  const [opacity,   setOpacity]   = useState(0.9);
  const [filled,    setFilled]    = useState(false);   // shape fill toggle
  const [applying,  setApplying]  = useState(false);
  const [error,     setError]     = useState(null);
  const [canUndo,   setCanUndo]   = useState(false);
  const [canRedo,   setCanRedo]   = useState(false);

  // Crop
  const [cropStart,  setCropStart]  = useState(null);
  const [cropRect,   setCropRect]   = useState(null);
  const [isCropping, setIsCropping] = useState(false);

  // Text overlay
  const [textPos,   setTextPos]   = useState(null);   // { x, y } canvas coords
  const [textValue, setTextValue] = useState('');

  const imgRef         = useRef(null);
  const canvasRef      = useRef(null);
  const containerRef   = useRef(null);
  const isDrawingRef   = useRef(false);
  const lastPosRef     = useRef(null);
  const penPointsRef   = useRef([]);
  const shapeStartRef  = useRef(null);
  const snapshotRef    = useRef(null);  // ImageData before shape preview

  // Undo/Redo stack
  const undoStack  = useRef([]);
  const undoIdx    = useRef(-1);

  // ── Dark grid background for blank mode ──
  function fillBlankBackground(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0c0c12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    const step = 24;
    for (let x = step; x < canvas.width; x += step)
      for (let y = step; y < canvas.height; y += step)
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
  }

  // ── Undo / Redo ──
  function saveUndoState() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    undoStack.current = undoStack.current.slice(0, undoIdx.current + 1);
    if (undoStack.current.length >= 60) undoStack.current.shift();
    undoStack.current.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
    undoIdx.current = undoStack.current.length - 1;
    setCanUndo(undoIdx.current > 0);
    setCanRedo(false);
  }

  function undo() {
    if (undoIdx.current <= 0) return;
    undoIdx.current--;
    canvasRef.current?.getContext('2d').putImageData(undoStack.current[undoIdx.current], 0, 0);
    setCanUndo(undoIdx.current > 0);
    setCanRedo(true);
  }

  function redo() {
    if (undoIdx.current >= undoStack.current.length - 1) return;
    undoIdx.current++;
    canvasRef.current?.getContext('2d').putImageData(undoStack.current[undoIdx.current], 0, 0);
    setCanUndo(true);
    setCanRedo(undoIdx.current < undoStack.current.length - 1);
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Canvas sizing ──
  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (blankMode) {
      const container = containerRef.current;
      if (!container) return;
      const { width, height } = container.getBoundingClientRect();
      const w = Math.round(width), h = Math.round(height);
      if (canvas.width !== w || canvas.height !== h) {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        tmp.getContext('2d').drawImage(canvas, 0, 0);
        canvas.width = w; canvas.height = h;
        fillBlankBackground(canvas);
        canvas.getContext('2d').drawImage(tmp, 0, 0, w, h);
      }
    } else {
      const img = imgRef.current;
      if (!img) return;
      const { width, height } = img.getBoundingClientRect();
      if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        tmp.getContext('2d').drawImage(canvas, 0, 0);
        canvas.width  = Math.round(width);
        canvas.height = Math.round(height);
        canvas.getContext('2d').drawImage(tmp, 0, 0, canvas.width, canvas.height);
      }
    }
  }, [blankMode]);

  // Initialize blank canvas
  useEffect(() => {
    if (blankMode && canvasRef.current && containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      canvasRef.current.width  = Math.round(width)  || 800;
      canvasRef.current.height = Math.round(height) || 560;
      fillBlankBackground(canvasRef.current);
      saveUndoState();
    }
  }, [blankMode]);

  useEffect(() => {
    const obs = new ResizeObserver(syncCanvasSize);
    const target = blankMode ? containerRef.current : imgRef.current;
    if (target) obs.observe(target);
    return () => obs.disconnect();
  }, [syncCanvasSize, blankMode]);

  // ── Canvas position helper ──
  function getPos(e) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ── Apply draw style ──
  function applyStyle(ctx, isEraser) {
    ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth   = size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }

  // ── Draw shape helper ──
  function drawShape(ctx, id, x1, y1, x2, y2) {
    applyStyle(ctx, false);
    ctx.beginPath();
    if (id === 'line') {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else if (id === 'rect') {
      if (filled) ctx.fillRect(x1, y1, x2-x1, y2-y1);
      else ctx.strokeRect(x1, y1, x2-x1, y2-y1);
    } else if (id === 'ellipse') {
      const rx = Math.abs(x2-x1)/2, ry = Math.abs(y2-y1)/2;
      const cx = (x1+x2)/2, cy = (y1+y2)/2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
      filled ? ctx.fill() : ctx.stroke();
    } else if (id === 'triangle') {
      ctx.moveTo((x1+x2)/2, y1);
      ctx.lineTo(x2, y2); ctx.lineTo(x1, y2); ctx.closePath();
      filled ? ctx.fill() : ctx.stroke();
    } else if (id === 'arrow') {
      drawArrow(ctx, x1, y1, x2, y2, size);
    }
  }

  // ── Commit text to canvas ──
  function commitText() {
    if (!textValue.trim() || !textPos) { setTextPos(null); setTextValue(''); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    saveUndoState();
    const ctx = canvas.getContext('2d');
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `${Math.max(size * 2, 14)}px sans-serif`;
    ctx.fillText(textValue, textPos.x, textPos.y);
    setTextPos(null);
    setTextValue('');
  }

  // ── Mouse handlers ──
  function handleMouseDown(e) {
    const pos = getPos(e);

    if (tool === 'text') {
      if (textPos) commitText();
      setTextPos(pos);
      setTextValue('');
      return;
    }

    if (tool === 'eyedrop') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const px = ctx.getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data;
      const hex = '#' + [px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
      setColor(hex); setHexInput(hex);
      return;
    }

    if (tool === 'fill') {
      saveUndoState();
      floodFill(canvasRef.current, pos.x, pos.y, color, opacity);
      return;
    }

    if (tool === 'crop') {
      setCropStart(pos); setCropRect(null); setIsCropping(true); return;
    }

    if (SHAPE_IDS.has(tool)) {
      shapeStartRef.current = pos;
      const canvas = canvasRef.current;
      if (canvas) snapshotRef.current = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      isDrawingRef.current = true;
      return;
    }

    // Brush / pen / eraser
    isDrawingRef.current = true;
    lastPosRef.current = pos;
    penPointsRef.current = [pos];
    saveUndoState();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    applyStyle(ctx, tool === 'eraser');
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function handleMouseMove(e) {
    const pos = getPos(e);

    if (tool === 'crop' && isCropping && cropStart) {
      setCropRect({ x: Math.min(cropStart.x,pos.x), y: Math.min(cropStart.y,pos.y), w: Math.abs(pos.x-cropStart.x), h: Math.abs(pos.y-cropStart.y) });
      return;
    }

    if (!isDrawingRef.current) return;

    // Shape preview
    if (SHAPE_IDS.has(tool) && shapeStartRef.current && snapshotRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.putImageData(snapshotRef.current, 0, 0);
      const s = shapeStartRef.current;
      drawShape(ctx, tool, s.x, s.y, pos.x, pos.y);
      return;
    }

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    applyStyle(ctx, tool === 'eraser');

    if (tool === 'pen') {
      penPointsRef.current.push(pos);
      const pts = penPointsRef.current;
      if (pts.length >= 3) {
        const p0 = pts[pts.length-3];
        const p1 = pts[pts.length-2];
        const p2 = pts[pts.length-1];
        const mid01 = { x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2 };
        const mid12 = { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 };
        ctx.beginPath();
        ctx.moveTo(mid01.x, mid01.y);
        ctx.quadraticCurveTo(p1.x, p1.y, mid12.x, mid12.y);
        ctx.stroke();
      }
    } else {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }

    lastPosRef.current = pos;
  }

  function handleMouseUp(e) {
    if (tool === 'crop') { setIsCropping(false); return; }

    if (SHAPE_IDS.has(tool) && shapeStartRef.current) {
      const pos = getPos(e);
      const s = shapeStartRef.current;
      const canvas = canvasRef.current;
      if (canvas && snapshotRef.current) {
        const ctx = canvas.getContext('2d');
        ctx.putImageData(snapshotRef.current, 0, 0);
        saveUndoState();
        drawShape(ctx, tool, s.x, s.y, pos.x, pos.y);
      }
      shapeStartRef.current = null; snapshotRef.current = null;
    }

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    isDrawingRef.current = false;
    lastPosRef.current = null;
    penPointsRef.current = [];
  }

  function handleMouseLeave() {
    if (tool !== 'crop' && !SHAPE_IDS.has(tool)) {
      isDrawingRef.current = false;
      lastPosRef.current = null;
    }
  }

  // ── Clear ──
  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    saveUndoState();
    const ctx = canvas.getContext('2d');
    if (blankMode) {
      fillBlankBackground(canvas);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setCropRect(null);
  }

  // ── Crop apply ──
  async function handleCropApply() {
    if (!cropRect || !cropRect.w || !cropRect.h) return;
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas) return;

    const offscreen = document.createElement('canvas');
    if (img) {
      const scaleX = img.naturalWidth / canvas.width;
      const scaleY = img.naturalHeight / canvas.height;
      offscreen.width  = Math.round(cropRect.w * scaleX);
      offscreen.height = Math.round(cropRect.h * scaleY);
      const ctx = offscreen.getContext('2d');
      ctx.drawImage(img, cropRect.x*scaleX, cropRect.y*scaleY, offscreen.width, offscreen.height, 0, 0, offscreen.width, offscreen.height);
      ctx.drawImage(canvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, offscreen.width, offscreen.height);
    } else {
      offscreen.width  = Math.round(cropRect.w);
      offscreen.height = Math.round(cropRect.h);
      offscreen.getContext('2d').drawImage(canvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, offscreen.width, offscreen.height);
    }
    await postApply(offscreen.toDataURL('image/png'));
  }

  // ── Apply paint to image ──
  async function handleApply() {
    if (tool === 'crop') { await handleCropApply(); return; }
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img || !currentImage?.filename) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = img.naturalWidth; offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(img, 0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
    await postApply(offscreen.toDataURL('image/png'));
  }

  async function postApply(imageData) {
    if (!currentImage?.filename) return;
    setError(null); setApplying(true);
    try {
      const r = await fetch('/api/editor/paint-apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData, filename: currentImage.filename, historyId: currentImage.id }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Apply failed'); }
      else { handleClear(); setCropRect(null); onApplied?.(data.filename); }
    } catch (err) { setError(err.message); }
    finally { setApplying(false); }
  }

  // ── Download ──
  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `anvil-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // ── Color hex input sync ──
  function onHexChange(v) {
    setHexInput(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v);
  }

  const imgSrc = currentImage?.filename
    ? `/api/generate/image/${currentImage.filename}?t=${Date.now()}`
    : null;

  const isShapeTool = SHAPE_IDS.has(tool);
  const hasCrop = tool === 'crop' && cropRect && cropRect.w > 2 && cropRect.h > 2;

  // ── Cursor ──
  const cursor = tool === 'eyedrop' ? 'crosshair' : tool === 'text' ? 'text' : tool === 'fill' ? 'cell' : 'crosshair';

  return (
    <div className={`rounded-xl border border-surface-700/50 overflow-hidden flex flex-col ${blankMode ? 'h-full bg-surface-800/60' : 'bg-surface-800/60'}`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-700/40 shrink-0">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#ffcc00' }}>
          ⚒ Anvil {blankMode ? '— Brainstorm Pad' : '— Edit Image'}
        </span>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-300 text-sm transition-colors">✕</button>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-surface-700/30 shrink-0 flex-wrap">
        {/* Draw tools */}
        <div className="flex gap-0.5">
          {DRAW_TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={t.title}
              className={`w-8 h-8 rounded-lg text-sm transition-all border ${
                tool === t.id
                  ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-300'
                  : 'border-surface-600/30 bg-surface-900/40 text-slate-400 hover:text-slate-200 hover:border-surface-500/50'
              }`}>{t.icon}</button>
          ))}
        </div>
        <div className="w-px h-6 bg-surface-600/40 mx-1" />
        {/* Shape tools */}
        <div className="flex gap-0.5">
          {SHAPE_TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={t.title}
              className={`w-8 h-8 rounded-lg text-sm transition-all border ${
                tool === t.id
                  ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-300'
                  : 'border-surface-600/30 bg-surface-900/40 text-slate-400 hover:text-slate-200 hover:border-surface-500/50'
              }`}>{t.icon}</button>
          ))}
          {/* Filled / Outline toggle — only for shape tools */}
          {isShapeTool && tool !== 'line' && tool !== 'arrow' && (
            <button onClick={() => setFilled(v => !v)} title={filled ? 'Filled' : 'Outline'}
              className={`w-8 h-8 rounded-lg text-xs font-bold transition-all border ${
                filled
                  ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-300'
                  : 'border-surface-600/30 bg-surface-900/40 text-slate-400 hover:text-slate-200'
              }`}>{filled ? '■' : '□'}</button>
          )}
        </div>
        <div className="w-px h-6 bg-surface-600/40 mx-1" />
        {/* Other tools */}
        <div className="flex gap-0.5">
          {OTHER_TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={t.title}
              className={`w-8 h-8 rounded-lg text-sm font-bold transition-all border ${
                tool === t.id
                  ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-300'
                  : 'border-surface-600/30 bg-surface-900/40 text-slate-400 hover:text-slate-200 hover:border-surface-500/50'
              }`}>{t.icon}</button>
          ))}
        </div>
        <div className="w-px h-6 bg-surface-600/40 mx-1" />
        {/* Undo / Redo */}
        <div className="flex gap-0.5">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
            className="w-8 h-8 rounded-lg text-sm transition-all border border-surface-600/30 bg-surface-900/40 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed">↩</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
            className="w-8 h-8 rounded-lg text-sm transition-all border border-surface-600/30 bg-surface-900/40 text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed">↪</button>
        </div>
      </div>

      {/* ── Controls strip ── */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-surface-700/30 shrink-0 flex-wrap">
        {/* Color */}
        <div className="flex items-center gap-1.5">
          <input type="color" value={color} onChange={e => { setColor(e.target.value); setHexInput(e.target.value); }}
            className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0" />
          <input type="text" value={hexInput} onChange={e => onHexChange(e.target.value)} maxLength={7}
            className="w-16 px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-900/60 border border-surface-600/40 text-slate-300 focus:outline-none focus:border-yellow-500/50" />
        </div>
        {/* Size */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500 shrink-0">Size</span>
          <input type="range" min={1} max={60} value={size} onChange={e => setSize(Number(e.target.value))}
            className="w-20" />
          <span className="text-[9px] text-slate-400 font-mono w-4">{size}</span>
        </div>
        {/* Opacity — hide for eraser */}
        {tool !== 'eraser' && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 shrink-0">Opacity</span>
            <input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))}
              className="w-20" />
            <span className="text-[9px] text-slate-400 font-mono w-7">{Math.round(opacity*100)}%</span>
          </div>
        )}
        {/* Tool hint */}
        {tool === 'crop' && (
          <span className="text-[9px] text-slate-600 ml-1">Drag to select region, then Crop</span>
        )}
        {tool === 'text' && (
          <span className="text-[9px] text-slate-600 ml-1">Click canvas to place text</span>
        )}
        {tool === 'eyedrop' && (
          <span className="text-[9px] text-slate-600 ml-1">Click canvas to pick color</span>
        )}
        {tool === 'fill' && (
          <span className="text-[9px] text-slate-600 ml-1">Click to flood fill a region</span>
        )}
      </div>

      {/* ── Canvas area ── */}
      <div className={`px-3 py-2 flex flex-col gap-2 ${blankMode ? 'flex-1 min-h-0' : ''}`}>

        {blankMode ? (
          <div ref={containerRef} className="relative rounded-lg overflow-hidden flex-1 min-h-0"
            style={{ border: '1px solid rgba(255,204,0,0.12)' }}>
            <canvas ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ cursor, touchAction: 'none', display: 'block' }}
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave} />
            {/* Text input overlay */}
            {textPos && (
              <input autoFocus type="text" value={textValue}
                onChange={e => setTextValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') { setTextPos(null); setTextValue(''); } }}
                onBlur={commitText}
                className="absolute bg-transparent border-b border-yellow-400/60 text-yellow-300 focus:outline-none"
                style={{ left: textPos.x, top: textPos.y - 16, fontSize: Math.max(size*2,14), color, fontFamily: 'sans-serif', minWidth: 60 }} />
            )}
          </div>
        ) : imgSrc ? (
          <div ref={containerRef} className="relative rounded-lg overflow-hidden bg-surface-900/60 border border-surface-700/40 select-none">
            <img ref={imgRef} src={imgSrc} alt="Edit" className="block w-full h-auto" draggable={false} onLoad={syncCanvasSize} />
            <canvas ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ cursor, touchAction: 'none' }}
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave} />
            {/* Text input overlay */}
            {textPos && (
              <input autoFocus type="text" value={textValue}
                onChange={e => setTextValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') { setTextPos(null); setTextValue(''); } }}
                onBlur={commitText}
                className="absolute bg-transparent border-b border-yellow-400/60 focus:outline-none"
                style={{ left: textPos.x, top: textPos.y - 16, fontSize: Math.max(size*2,14), color, fontFamily: 'sans-serif', minWidth: 60 }} />
            )}
            {/* Crop overlay */}
            {tool === 'crop' && cropRect && cropRect.w > 0 && (
              <div className="absolute border-2 border-yellow-400 bg-yellow-400/10 pointer-events-none"
                style={{ left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h }} />
            )}
          </div>
        ) : null}

        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-[10px] text-red-400 shrink-0">{error}</div>
        )}

        {/* ── Actions ── */}
        <div className="flex gap-1.5 shrink-0">
          <button onClick={handleClear}
            className="px-3 py-1.5 rounded-lg border text-[10px] font-medium transition-all bg-surface-900/40 border-surface-600/30 text-slate-500 hover:text-slate-300 hover:border-surface-500/50">
            Clear
          </button>
          {blankMode ? (
            <button onClick={handleDownload}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all bg-surface-700/60 hover:bg-surface-600/70 border border-surface-600/40 text-slate-300 hover:text-white">
              ↓ Save PNG
            </button>
          ) : (
            <button onClick={handleApply}
              disabled={applying || !imgSrc || (tool === 'crop' && !hasCrop)}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                applying || !imgSrc || (tool === 'crop' && !hasCrop)
                  ? 'bg-surface-700/40 text-slate-600 cursor-not-allowed'
                  : 'bg-brand-600 hover:bg-brand-500 text-white'
              }`}>
              {applying ? '⏳ Saving…' : tool === 'crop' ? '✂ Crop' : '✓ Apply & Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
