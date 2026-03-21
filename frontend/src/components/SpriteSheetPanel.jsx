import { useState, useEffect, useRef } from 'react';

// Pose preview labels (mirrors POSE_SETS in backend)
const POSE_PREVIEWS = {
  character: {
    4:  ['Idle (front)', 'Walk (side)', 'Attack', 'Hurt'],
    8:  ['Idle ×2', 'Walk ×2', 'Run', 'Attack ×2', 'Jump', 'Hurt'],
    9:  ['Idle ×3', 'Walk ×2', 'Run', 'Attack', 'Jump', 'Hurt'],
    16: ['Idle ×4', 'Walk ×4', 'Run ×2', 'Attack ×2', 'Jump', 'Fall', 'Hurt', 'Death'],
  },
  creature: {
    4:  ['Idle (front)', 'Prowl (side)', 'Attack', 'Hurt'],
    8:  ['Idle ×2', 'Walk ×2', 'Run', 'Attack', 'Jump', 'Hurt'],
  },
  item:     { 4: ['Front', 'Side', 'Top', '¾ view'] },
  weapon:   { 4: ['Front', 'Side', 'Back', '¾ view'] },
  prop:     { 4: ['Front', 'Side', 'Top', '¾ view'] },
  building: { 4: ['Front facade', 'Side', 'Back', 'Isometric'] },
  vfx:      { 4: ['Spawn', 'Build up', 'Peak', 'Fade'] },
  particle: { 4: ['Start', 'Expand', 'Peak', 'Dissolve'] },
  icon:     { 4: ['Normal', 'Hover', 'Active', 'Disabled'] },
};

function getPoseChips(assetType, frameCount) {
  const typeSet = POSE_PREVIEWS[assetType];
  if (!typeSet) return Array.from({ length: frameCount }, (_, i) => `Variation ${i + 1}`);
  const available = Object.keys(typeSet).map(Number).sort((a, b) => a - b);
  const closest = available.reduce((p, c) => Math.abs(c - frameCount) < Math.abs(p - frameCount) ? c : p);
  return (typeSet[closest] ?? []).filter(Boolean);
}

const GRID_LAYOUTS = [
  { id: '2x2', label: '2×2', cols: 2, rows: 2, frames: 4 },
  { id: '4x1', label: '4×1', cols: 4, rows: 1, frames: 4 },
  { id: '1x4', label: '1×4', cols: 1, rows: 4, frames: 4 },
  { id: '2x4', label: '2×4', cols: 2, rows: 4, frames: 8 },
  { id: '4x2', label: '4×2', cols: 4, rows: 2, frames: 8 },
  { id: '3x3', label: '3×3', cols: 3, rows: 3, frames: 9 },
  { id: '4x4', label: '4×4', cols: 4, rows: 4, frames: 16 },
];

const FRAME_SIZES = [
  { label: '256px', w: 256, h: 256 },
  { label: '512px', w: 512, h: 512 },
  { label: '768px', w: 768, h: 768 },
];

// Types best suited for animation sheets
const ASSET_TYPES = [
  { id: 'character', label: 'Character',  icon: '⚔' },
  { id: 'creature',  label: 'Creature',   icon: '🐉' },
  { id: 'vfx',       label: 'VFX/Spell',  icon: '✨' },
  { id: 'particle',  label: 'Particle',   icon: '💥' },
  { id: 'prop',      label: 'Prop',       icon: '📦' },
  { id: 'item',      label: 'Item',       icon: '🗡' },
  { id: 'weapon',    label: '⚔ Weapon',   icon: '' },
  { id: 'building',  label: 'Building',   icon: '🏰' },
  { id: 'icon',      label: 'Icon',       icon: '🔷' },
];

const ART_STYLES = [
  { id: 'stylized',    label: 'Stylized'     },
  { id: 'pixel',       label: 'Pixel Art'    },
  { id: 'anime',       label: 'Anime'        },
  { id: 'painted',     label: 'Hand Painted' },
  { id: 'realistic',   label: 'Realistic'    },
  { id: 'lowpoly',     label: 'Low Poly'     },
  { id: 'cartoon',     label: 'Cartoon'      },
  { id: 'isometric',   label: 'Isometric'    },
  { id: 'darkfantasy', label: 'Dark Fantasy' },
  { id: 'chibi',       label: 'Chibi'        },
  { id: 'scifi',       label: 'Sci-Fi'       },
  { id: 'watercolor',  label: 'Watercolor'   },
];

const WARN_STYLES = new Set(['realistic', 'darkfantasy']);

// Collapsible section header — matches Forge orange style
function Section({ label, open, onToggle, children }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-[11px] font-semibold uppercase tracking-wider transition-colors mb-2"
        style={{ color: open ? '#ff4d00' : '#666', fontFamily: "'IBM Plex Mono', monospace" }}
      >
        <span className={`text-[9px] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
        {label}
      </button>
      {open && children}
    </div>
  );
}

export default function SpriteSheetPanel({ onGenerated, models = [], defaultModel = '' }) {
  const [assetType,       setAssetType]       = useState('character');
  const [artStyle,        setArtStyle]        = useState('stylized');
  const [subject,         setSubject]         = useState('');
  const [gridLayout,      setGridLayout]      = useState('2x2');
  const [frameSize,       setFrameSize]       = useState(1);
  const [model,           setModel]           = useState(defaultModel);
  const [steps,           setSteps]           = useState(6);
  const [cfg,             setCfg]             = useState(2);
  const [consistencyMode, setConsistencyMode] = useState(true);

  // Section collapse state
  const [showAssets,  setShowAssets]  = useState(true);
  const [showStyles,  setShowStyles]  = useState(false);
  const [showLayout,  setShowLayout]  = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [generating,  setGenerating]  = useState(false);
  const [progress,    setProgress]    = useState('');
  const [error,       setError]       = useState('');
  const [frames,      setFrames]      = useState([]);
  const [sheetResult, setSheetResult] = useState(null);

  const [arranging,   setArranging]   = useState(false);
  const [frameOrder,  setFrameOrder]  = useState([]);
  const [dragIdx,     setDragIdx]     = useState(null);

  const pollRef = useRef(null);

  useEffect(() => {
    if (defaultModel && !model) setModel(defaultModel);
  }, [defaultModel]);

  const layout = GRID_LAYOUTS.find(l => l.id === gridLayout) ?? GRID_LAYOUTS[0];
  const size   = FRAME_SIZES[frameSize];

  async function handleGenerate() {
    setError('');
    setFrames([]);
    setSheetResult(null);
    setArranging(false);
    setGenerating(true);
    setProgress('Generating anchor frame…');

    try {
      const startRes = await fetch('/api/sprite-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'preset',
          assetType, artStyle, subject,
          gridLayout,
          model: model || '',
          steps, cfg,
          sampler: 'euler',
          width:  size.w,
          height: size.h,
          consistencyMode,
        }),
      });

      if (!startRes.ok) {
        const err = await startRes.json();
        throw new Error(err.error || 'Sprite sheet generation failed');
      }

      const { jobId, frameCount } = await startRes.json();

      await new Promise((resolve, reject) => {
        let elapsed = 0;
        pollRef.current = setInterval(async () => {
          elapsed++;
          try {
            const poll = await fetch(`/api/sprite-sheet/${jobId}`);
            const job  = await poll.json();

            if (job.status === 'running' && job.progress) {
              const { completed, total } = job.progress;
              setProgress(
                completed === 1
                  ? `Anchor frame done — generating frame ${completed}/${total}… ${elapsed}s`
                  : `Generating frame ${completed}/${total}… ${elapsed}s`
              );
            } else if (job.status === 'pending') {
              setProgress(`Queued… ${elapsed}s`);
            }

            if (job.status === 'completed') {
              clearInterval(pollRef.current);
              setSheetResult(job.result);
              setFrames(job.result.frames ?? []);
              setFrameOrder(job.result.frames?.map((_, i) => i) ?? []);
              setProgress('');
              onGenerated(job.result);
              resolve();
            } else if (job.status === 'failed') {
              clearInterval(pollRef.current);
              reject(new Error(job.error || 'Generation failed'));
            }
          } catch (e) {
            clearInterval(pollRef.current);
            reject(e);
          }
        }, 1500);
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  function handleDragStart(i) { setDragIdx(i); }
  function handleDrop(i) {
    if (dragIdx === null || dragIdx === i) return;
    const next = [...frameOrder];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    setFrameOrder(next);
    setDragIdx(null);
  }

  async function handleComposeCustom() {
    if (!sheetResult) return;
    setGenerating(true);
    setProgress('Compositing custom layout…');
    try {
      const res = await fetch('/api/sprite-sheet/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frameFilenames: frameOrder.map(i => frames[i]?.filename).filter(Boolean),
          gridLayout,
          frameWidth:  size.w,
          frameHeight: size.h,
          originalJobId: sheetResult.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSheetResult(data.entry);
        onGenerated(data.entry);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
      setProgress('');
    }
  }

  const poseChips = getPoseChips(assetType, layout.frames);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-4">

        {/* Subject input — required for consistency */}
        <div>
          <label className="forge-label block mb-1.5">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder='e.g. "orc warrior", "fire mage"'
            className="forge-input"
          />
          <p className="text-[9px] mt-1" style={{ color: '#555', fontFamily: "'IBM Plex Mono', monospace" }}>
            Be specific — this anchors character identity across all frames
          </p>
        </div>

        {/* Character Consistency toggle */}
        <div
          className="flex items-center justify-between rounded-lg px-3 py-2.5"
          style={{ background: consistencyMode ? 'rgba(255,77,0,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${consistencyMode ? 'rgba(255,77,0,0.4)' : 'rgba(255,255,255,0.06)'}` }}
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: consistencyMode ? '#ff4d00' : '#555', fontFamily: "'IBM Plex Mono', monospace" }}>
              Character Lock
            </p>
            <p className="text-[9px] mt-0.5" style={{ color: '#666' }}>
              Frame 1 anchors identity &mdash; remaining frames use img2img
            </p>
          </div>
          <button
            onClick={() => setConsistencyMode(v => !v)}
            className="relative shrink-0 w-10 h-5 rounded-full transition-colors duration-200"
            style={{ background: consistencyMode ? '#ff4d00' : 'rgba(255,255,255,0.1)' }}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200"
              style={{ left: consistencyMode ? '22px' : '2px' }}
            />
          </button>
        </div>

        {/* Asset Type */}
        <Section label="Asset Type" open={showAssets} onToggle={() => setShowAssets(v => !v)}>
          <div className="grid grid-cols-3 gap-1">
            {ASSET_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setAssetType(t.id)}
                className="py-1.5 px-1 text-[10px] rounded-md border transition-all"
                style={assetType === t.id
                  ? { background: 'rgba(255,77,0,0.12)', borderColor: 'rgba(255,77,0,0.6)', color: '#ff4d00' }
                  : { borderColor: 'rgba(255,204,0,0.08)', color: '#666' }
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Art Style */}
        <Section label="Art Style" open={showStyles} onToggle={() => setShowStyles(v => !v)}>
          <div className="grid grid-cols-3 gap-1">
            {ART_STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => setArtStyle(s.id)}
                className="py-1.5 px-1 text-[10px] rounded-md border transition-all"
                style={artStyle === s.id
                  ? { background: 'rgba(255,77,0,0.12)', borderColor: 'rgba(255,77,0,0.6)', color: '#ff4d00' }
                  : { borderColor: 'rgba(255,204,0,0.08)', color: '#666' }
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          {WARN_STYLES.has(artStyle) && (
            <p className="mt-1.5 text-[9px] leading-snug" style={{ color: '#ca8a04' }}>
              ⚠ {artStyle === 'realistic' ? 'Realistic' : 'Dark Fantasy'} often adds backgrounds. Try Stylized or Cartoon for clean sprites.
            </p>
          )}
        </Section>

        {/* Grid Layout + frame size */}
        <Section label="Layout" open={showLayout} onToggle={() => setShowLayout(v => !v)}>
          <div className="grid grid-cols-4 gap-1 mb-3">
            {GRID_LAYOUTS.map(l => (
              <button
                key={l.id}
                onClick={() => setGridLayout(l.id)}
                className="py-1.5 text-[10px] rounded-md border transition-all flex flex-col items-center gap-0.5"
                style={gridLayout === l.id
                  ? { background: 'rgba(255,77,0,0.12)', borderColor: 'rgba(255,77,0,0.6)', color: '#ff4d00' }
                  : { borderColor: 'rgba(255,204,0,0.08)', color: '#666' }
                }
              >
                <span className="font-medium">{l.label}</span>
                <span className="text-[9px]" style={{ color: '#444' }}>{l.frames}fr</span>
              </button>
            ))}
          </div>

          <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#555', fontFamily: "'IBM Plex Mono', monospace" }}>Frame Size</label>
          <div className="grid grid-cols-3 gap-1 mb-2">
            {FRAME_SIZES.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setFrameSize(i)}
                className="py-1.5 text-[10px] rounded-md border transition-all"
                style={frameSize === i
                  ? { background: 'rgba(255,77,0,0.12)', borderColor: 'rgba(255,77,0,0.6)', color: '#ff4d00' }
                  : { borderColor: 'rgba(255,204,0,0.08)', color: '#666' }
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[9px]" style={{ color: '#444', fontFamily: "'IBM Plex Mono', monospace" }}>
            Sheet: {size.w * layout.cols}&times;{size.h * layout.rows}px &bull; {layout.frames} frames
          </p>

          {/* Pose preview chips */}
          {poseChips.length > 0 && (
            <div className="mt-2">
              <p className="text-[9px] mb-1" style={{ color: '#444' }}>Poses per frame:</p>
              <div className="flex flex-wrap gap-1">
                {poseChips.map((chip, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,204,0,0.05)', border: '1px solid rgba(255,204,0,0.1)', color: '#888' }}>
                    {i + 1}. {chip}
                  </span>
                ))}
              </div>
            </div>
          )}

          {layout.frames >= 9 && frameSize >= 1 && (
            <p className="text-[9px] mt-1" style={{ color: '#ca8a04' }}>⚠ {layout.frames} frames at {size.label} may be slow on low VRAM</p>
          )}
        </Section>

        {/* Advanced */}
        <Section label="Advanced" open={showAdvanced} onToggle={() => setShowAdvanced(v => !v)}>
          {models.length > 0 && (
            <div className="mb-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#555', fontFamily: "'IBM Plex Mono', monospace" }}>Model</label>
              <select value={model} onChange={e => setModel(e.target.value)} className="input-field text-xs">
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#555', fontFamily: "'IBM Plex Mono', monospace" }}>
                Steps <span style={{ color: '#ff4d00' }}>{steps}</span>
              </label>
              <input type="range" min={4} max={20} value={steps} onChange={e => setSteps(Number(e.target.value))}
                className="w-full accent-brand-500" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#555', fontFamily: "'IBM Plex Mono', monospace" }}>
                CFG <span style={{ color: '#ff4d00' }}>{cfg}</span>
              </label>
              <input type="range" min={1} max={10} step={0.5} value={cfg} onChange={e => setCfg(Number(e.target.value))}
                className="w-full accent-brand-500" />
            </div>
          </div>
        </Section>

        {/* Frame results */}
        {frames.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#555', fontFamily: "'IBM Plex Mono', monospace" }}>Frames</label>
              <button
                onClick={() => setArranging(v => !v)}
                className="text-[10px] px-2 py-0.5 rounded border transition-all"
                style={arranging
                  ? { background: 'rgba(255,77,0,0.12)', borderColor: 'rgba(255,77,0,0.4)', color: '#ff4d00' }
                  : { borderColor: 'rgba(255,204,0,0.12)', color: '#666' }
                }
              >
                {arranging ? 'Auto Layout' : 'Arrange Manually'}
              </button>
            </div>

            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(layout.cols, 4)}, 1fr)` }}>
              {(arranging ? frameOrder : frames.map((_, i) => i)).map((origIdx, slotIdx) => {
                const frame = frames[origIdx];
                if (!frame) return null;
                return (
                  <div
                    key={slotIdx}
                    draggable={arranging}
                    onDragStart={arranging ? () => handleDragStart(slotIdx) : undefined}
                    onDragOver={arranging ? e => e.preventDefault() : undefined}
                    onDrop={arranging ? () => handleDrop(slotIdx) : undefined}
                    className="relative aspect-square rounded-md overflow-hidden border group transition-all"
                    style={{ borderColor: slotIdx === 0 ? 'rgba(255,204,0,0.4)' : 'rgba(255,255,255,0.06)', cursor: arranging ? 'grab' : 'default' }}
                  >
                    <img
                      src={`/api/sprite-sheet/frame/${frame.filename}?t=${Date.now()}`}
                      alt={`Frame ${origIdx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {/* Anchor badge on frame 0 */}
                    {origIdx === 0 && (
                      <span className="absolute top-0.5 right-0.5 text-[7px] px-1 rounded" style={{ background: 'rgba(255,204,0,0.2)', color: '#ffcc00', fontFamily: "'IBM Plex Mono', monospace" }}>
                        ANCHOR
                      </span>
                    )}
                    {frame.pose && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[7px] text-slate-300 truncate">{frame.pose}</p>
                      </div>
                    )}
                    <span className="absolute top-0.5 left-0.5 text-[7px] px-0.5 rounded" style={{ background: 'rgba(0,0,0,0.7)', color: '#555' }}>{origIdx + 1}</span>
                  </div>
                );
              })}
            </div>

            {arranging && (
              <button
                onClick={handleComposeCustom}
                disabled={generating}
                className="mt-2 w-full py-2 text-xs rounded-lg border transition-all"
                style={{ background: 'rgba(255,77,0,0.1)', borderColor: 'rgba(255,77,0,0.4)', color: '#ff4d00' }}
              >
                ✦ Compose with This Order
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', color: '#f87171' }}>
            {error}
          </div>
        )}
      </div>

      {/* Generate button pinned at bottom */}
      <div className="px-4 py-3 shrink-0" style={{ borderTop: '1px solid rgba(255,204,0,0.1)' }}>
        {/* Guardrail badges */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80', fontFamily: "'IBM Plex Mono', monospace" }}>
            ✓ White BG forced
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80', fontFamily: "'IBM Plex Mono', monospace" }}>
            ✓ Watermarks blocked
          </span>
          {consistencyMode && (
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,77,0,0.1)', border: '1px solid rgba(255,77,0,0.3)', color: '#ff4d00', fontFamily: "'IBM Plex Mono', monospace" }}>
              ✓ Character locked
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80', fontFamily: "'IBM Plex Mono', monospace" }}>
            ✓ Pose variation on
          </span>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn-forge orange w-full"
        >
          {generating
            ? <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                {progress || 'Generating…'}
              </span>
            : `⊞ Generate ${layout.frames}-Frame Sheet`}
        </button>
      </div>
    </div>
  );
}
