import { useState, useEffect, useRef } from 'react';

// Asset types that activate server-side Game Asset Mode (Phase 28)
// These get a dedicated positive prefix, expanded negatives, tighter CFG/steps.
const GAME_ASSET_TYPE_IDS = new Set(['icon', 'item', 'weapon', 'prop', 'ui', 'tileset', 'texture', 'armor', 'shield', 'ring', 'furniture', 'tree']);

// Auto-mesh disabled — user should manually choose when to apply 3D.
// The 3D pipeline runs silently — users just see the final mesh appear.
const MESH_ASSET_TYPES = new Set([]);  // disabled — user manually clicks Pro Sword Asset or Apply to Mesh

const ASSET_TYPES = [
  { id: 'concept',     label: 'Concept Art' },
  { id: 'character',   label: 'Character'   },
  { id: 'creature',    label: 'Creature'    },
  { id: 'environment', label: 'Environment' },
  { id: 'prop',        label: '⚔ Prop'        },
  { id: 'item',        label: '⚔ Item'        },
  { id: 'weapon',      label: '⚔ Weapon'   },
  { id: 'armor',       label: '⚔ Armor'    },
  { id: 'shield',      label: '⚔ Shield'   },
  { id: 'ring',        label: '⚔ Ring'     },
  { id: 'building',    label: 'Building'    },
  { id: 'vehicle',     label: 'Vehicle'     },
  { id: 'furniture',   label: '⚔ Furniture'},
  { id: 'tree',        label: '⚔ Tree'     },
  { id: 'portrait',    label: 'Portrait'    },
  { id: 'tileset',     label: '⚔ Tileset'     },
  { id: 'texture',     label: '⚔ Texture'     },
  { id: 'icon',        label: '⚔ Icon/Badge'  },
  { id: 'ui',          label: '⚔ UI Element'  },
  { id: 'vfx',         label: 'VFX/Spell'  },
  { id: 'skybox',      label: 'Skybox'      },
  { id: 'particle',    label: 'Particle'    },
];

const ART_STYLES = [
  { id: 'stylized',    label: 'Stylized'     },
  { id: 'realistic',   label: 'Realistic'    },
  { id: 'pixel',       label: 'Pixel Art'    },
  { id: 'anime',       label: 'Anime'        },
  { id: 'painted',     label: 'Hand Painted' },
  { id: 'lowpoly',     label: 'Low Poly'     },
  { id: 'cartoon',     label: 'Cartoon'      },
  { id: 'watercolor',  label: 'Watercolor'   },
  { id: 'darkfantasy', label: 'Dark Fantasy' },
  { id: 'isometric',   label: 'Isometric'    },
  { id: 'scifi',       label: 'Sci-Fi'       },
  { id: 'chibi',       label: 'Chibi'        },
  { id: 'painterly',   label: 'Painterly'    },
  { id: 'ink',         label: 'Ink/Sketch'   },
];

const GAME_GENRES = [
  { id: '',             label: 'Any'         },
  { id: 'fantasy',      label: 'Fantasy'     },
  { id: 'scifi',        label: 'Sci-Fi'      },
  { id: 'horror',       label: 'Horror'      },
  { id: 'platformer',   label: 'Platformer'  },
  { id: 'topdown',      label: 'Top-Down'    },
  { id: 'metroidvania', label: 'Metroid.'    },
  { id: 'puzzle',       label: 'Puzzle'      },
  { id: 'strategy',     label: 'Strategy'    },
];

const SAMPLERS = [
  { id: 'dpmpp_2m',     label: 'Balanced' },
  { id: 'euler',        label: 'Fast' },
  { id: 'dpmpp_2m_sde', label: 'Detailed' },
  { id: 'ddim',         label: 'Precise' },
  { id: 'heun',         label: 'Maximum' },
];

const RESOLUTIONS = [
  { label: '512 × 512',   w: 512,  h: 512  },
  { label: '768 × 768',   w: 768,  h: 768  },
  { label: '1024 × 1024', w: 1024, h: 1024 },
  { label: '1024 × 576',  w: 1024, h: 576  },
  { label: '576 × 1024',  w: 576,  h: 1024 },
  { label: '1280 × 720',  w: 1280, h: 720  },
];

// Pro tool presets — modify prompts & generation params
// (Removed Phase 31 - UI Cleanup)

const STORAGE_KEY = 'interforge_panel_v1';
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
}
function persist(patch) {
  try {
    const cur = loadSaved();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}

export default function GenerationPanel({ onOpenAnvil, onGenerated, reuseSettings, onReuseConsumed, onGeneratingChange, tinkerMode, onToggleTinker }) {
  const saved = loadSaved();
  // Mode is always 'preset' — Custom/Template tabs were removed
  const mode = 'preset';
  const [prompt,      setPrompt]      = useState(saved.prompt      ?? '');
  const [negative,    setNegative]    = useState(saved.negative    ?? '');
  const [promptBoost, setPromptBoost] = useState('');
  const [assetType,   setAssetType]   = useState(saved.assetType   ?? 'concept');
  const [artStyle,    setArtStyle]    = useState(saved.artStyle    ?? 'stylized');
  const [genre,       setGenre]       = useState(saved.genre       ?? '');
  const [subject,     setSubject]     = useState(saved.subject     ?? '');
  const [model,       setModel]       = useState(saved.model       ?? '');
  const [models,      setModels]      = useState([]);
  const [seed,        setSeed]        = useState('');
  const [steps,       setSteps]       = useState(saved.steps       ?? 6);
  const [cfg,         setCfg]         = useState(saved.cfg         ?? 2);
  const [sampler,     setSampler]     = useState(saved.sampler     ?? 'dpmpp_2m');
  const [resolution,  setResolution]  = useState(saved.resolution  ?? 2);
  const [refImage,    setRefImage]    = useState(null);
  const [refPreview,  setRefPreview]  = useState(null);
  const [strength,    setStrength]    = useState(0.75);
  const [showAdv,     setShowAdv]     = useState(false);
  const [showPro,     setShowPro]     = useState(false);
  const [showAssets,  setShowAssets]  = useState(true);
  const [showStyles,  setShowStyles]  = useState(true);
  const [showGenre,   setShowGenre]   = useState(false);
  const [templates,   setTemplates]   = useState([]);
  const [selectedTpl, setSelectedTpl] = useState('');
  const [generating,    setGenerating]    = useState(false);
  const [progress,      setProgress]      = useState('');
  const [error,         setError]         = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName,   setTemplateName]   = useState('');
  const pollRef   = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => {
      const available = d.available ?? [];
      setModels(available);
      // Reset to default if saved model no longer exists (e.g. model was swapped out)
      if (!saved.model || !available.includes(saved.model)) {
        setModel(d.default ?? '');
      }
    }).catch(() => {});
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {});
  }, []);

  // Persist settings on change
  useEffect(() => { persist({ prompt, negative, assetType, artStyle, genre, subject, steps, cfg, sampler, resolution }); },
    [prompt, negative, assetType, artStyle, genre, subject, steps, cfg, sampler, resolution]);

  // Apply reuseSettings from history
  useEffect(() => {
    if (!reuseSettings) return;
    const e = reuseSettings;
    if (e.prompt)  { setPrompt(e.prompt); }
    if (e.params?.steps)  setSteps(e.params.steps);
    if (e.params?.cfg)    setCfg(e.params.cfg);
    onReuseConsumed?.();
  }, [reuseSettings]);

  // Ctrl+Enter to generate
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (!generating) handleGenerate();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [generating, mode, prompt, assetType, artStyle, genre, subject, steps, cfg, sampler, negative, promptBoost]);

  function toggleTool(id) {
    setActiveTools(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleRefFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefImage(file);
    const reader = new FileReader();
    reader.onload = ev => setRefPreview(ev.target.result);
    reader.readAsDataURL(file);
  }
  function clearRef() { setRefImage(null); setRefPreview(null); }

  function applyTemplate(id) {
    const t = templates.find(t => t.id === id);
    if (!t) return;
    setSelectedTpl(id);
    setPrompt(t.prompt);
    setNegative(t.negativePrompt ?? '');
    if (t.defaultModel)   setModel(t.defaultModel);
    if (t.defaultSteps)   setSteps(t.defaultSteps);
    if (t.defaultCfg)     setCfg(t.defaultCfg);
    if (t.defaultSampler) setSampler(t.defaultSampler);
    if (t.defaultResolution) {
      const [w, h] = t.defaultResolution.split('x').map(Number);
      const idx = RESOLUTIONS.findIndex(r => r.w === w && r.h === h);
      if (idx >= 0) setResolution(idx);
    }
  }

  async function saveAsTemplate() {
    if (!templateName.trim()) return;
    const res = RESOLUTIONS[resolution];
    const body = {
      name: templateName.trim(), prompt, negativePrompt: negative, defaultModel: model,
      defaultSteps: steps, defaultCfg: cfg, defaultSampler: sampler,
      defaultResolution: `${res.w}x${res.h}`,
    };
    const r = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      const d = await r.json();
      setTemplates(ts => [d.template, ...ts]);
    }
    setSavingTemplate(false);
    setTemplateName('');
  }

  function handleCancel() {
    cancelRef.current = true;
    if (pollRef.current) clearInterval(pollRef.current);
    setGenerating(false);
    onGeneratingChange?.(false);
    setProgress('');
    setError('Cancelled.');
  }

  async function handleGenerate() {
    setError('');
    cancelRef.current = false;
    setGenerating(true);
    onGeneratingChange?.(true);
    setProgress('Forging…');
    const res = RESOLUTIONS[resolution];

    try {
      const form = new FormData();
      form.append('mode',           'preset');
      form.append('prompt',         [prompt, promptBoost].filter(Boolean).join(', '));
      form.append('negativePrompt', negative);
      form.append('assetType',      assetType);
      form.append('artStyle',       artStyle);
      form.append('genre',          genre);
      form.append('subject',        subject);
      form.append('model',          model);
      form.append('seed',           seed || '');
      form.append('steps',          steps);
      form.append('cfg',            cfg);
      form.append('sampler',        sampler);
      form.append('width',          res.w);
      form.append('height',         res.h);
      form.append('strength',       strength);
      if (refImage) form.append('refImage', refImage);

      const startRes = await fetch('/api/generate', { method: 'POST', body: form });
      if (!startRes.ok) {
        const err = await startRes.json();
        throw new Error(err.error || 'Generation failed');
      }
      const { jobId } = await startRes.json();

      await new Promise((resolve, reject) => {
        let elapsed = 0;
        pollRef.current = setInterval(async () => {
          if (cancelRef.current) { clearInterval(pollRef.current); resolve(); return; }
          elapsed++;
          // First generation loads model into VRAM — warn user if it's taking a while
          const msg = elapsed <= 12
            ? `Generating… ${elapsed}s`
            : elapsed <= 30
              ? `Loading model into VRAM… ${elapsed}s`
              : `Almost there… ${elapsed}s`;
          setProgress(msg);
          try {
            const poll = await fetch(`/api/generate/${jobId}`);
            const job  = await poll.json();
            if (job.status === 'completed') {
              clearInterval(pollRef.current);
              if (!cancelRef.current) {
                // Show 2D image immediately
                onGenerated(job.result);
                // Silently chain 3D reconstruction for meshable asset types
                if (MESH_ASSET_TYPES.has(assetType)) {
                  try {
                    setProgress('Building 3D mesh…');
                    // Weapon type → sword silhouette pipeline (proper UV-mapped mesh)
                    // Other types → TripoSR (AI-based reconstruction)
                    const isSword = assetType === 'weapon';
                    const meshEndpoint = isSword
                      ? '/api/blender/sword-asset'
                      : '/api/triposr/generate';
                    const meshBody = isSword
                      ? { textureFilename: job.result.filename }
                      : { imageFilename: job.result.filename, resolution: 256 };
                    const meshPollBase = isSword ? '/api/blender' : '/api/triposr';

                    const tsrRes = await fetch(meshEndpoint, {
                      method:  'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body:    JSON.stringify(meshBody),
                    });
                    const tsrData = await tsrRes.json();
                    if (tsrData.jobId && !cancelRef.current) {
                      await new Promise((res3d) => {
                        const poll3d = setInterval(async () => {
                          if (cancelRef.current) { clearInterval(poll3d); res3d(); return; }
                          try {
                            const r = await fetch(`${meshPollBase}/${tsrData.jobId}`);
                            const d = await r.json();
                            if (d.status === 'completed') {
                              clearInterval(poll3d);
                              if (isSword && d.result) {
                                // Blender sword pipeline returns a full history entry
                                onGenerated(d.result);
                              } else if (d.result?.glbUrl) {
                                const glbFilename = d.result.glbUrl.split('/').pop().split('?')[0];
                                onGenerated({
                                  id:          tsrData.jobId,
                                  type:        'triposr',
                                  filename:    glbFilename,
                                  prompt:      job.result.prompt,
                                  timestamp:   Date.now(),
                                  sourceImage: job.result.filename,
                                  seed:        job.result.seed,
                                  params:      job.result.params,
                                });
                              }
                              res3d();
                            } else if (d.status === 'failed') {
                              clearInterval(poll3d); res3d(); // Silently swallow — 2D already shown
                            }
                          } catch { clearInterval(poll3d); res3d(); }
                        }, 1500);
                      });
                    }
                  } catch { /* 2D already shown — ignore 3D errors */ }
                }
              }
              resolve();
            } else if (job.status === 'failed') {
              clearInterval(pollRef.current);
              reject(new Error(job.error || 'Generation failed'));
            }
          } catch (e) { clearInterval(pollRef.current); reject(e); }
        }, 1000);
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
      onGeneratingChange?.(false);
      setProgress('');
    }
  }

  const canGenerate = !generating && (subject.trim().length > 0 || prompt.trim().length > 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Scrollable content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">


        {/* ── PRESET MODE ── */}
        <div className="flex flex-col gap-4">
          {/* ── UNIFIED PROMPT BUILDER ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-brand-400 uppercase tracking-wider">Subject & Negative</label>
              <button
                onClick={onToggleTinker}
                title="Tinker Mode: bypass smelt quality gate — send any image straight to MasterForge"
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ${
                  tinkerMode
                    ? 'bg-yellow-500/20 border-yellow-500/60 text-yellow-400'
                    : 'bg-surface-700/50 border-surface-600/40 text-slate-500 hover:text-slate-300 hover:border-slate-500/60'
                }`}
              >
                ⚙ Tinker
              </button>
            </div>
            <div className="relative rounded-lg border-2 border-brand-500/60 bg-surface-800 overflow-hidden">
              {/* Subject area (70%) */}
              <textarea
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Your subject or scene…"
                rows={4}
                className="w-full px-3 py-2.5 bg-surface-800 placeholder-slate-600 resize-none focus:outline-none text-sm"
                style={{ height: '70%', minHeight: '100px', color: '#ffcc00' }}
              />

              {/* Separator line with indicator */}
              <div className="relative h-px border-t border-dotted border-brand-500/60">
                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 bg-surface-800 text-[10px] font-bold text-brand-300 uppercase tracking-wider">
                  <span style={{ color: '#ffcc00' }}>—</span>
                  Negative
                  <span style={{ color: '#ffcc00' }}>—</span>
                </div>
              </div>

              {/* Negative area (30%) */}
              <textarea
                value={promptBoost}
                onChange={e => setPromptBoost(e.target.value)}
                placeholder="What to avoid…"
                rows={2}
                className="w-full px-3 py-2.5 bg-surface-800 placeholder-slate-600 resize-none focus:outline-none text-sm"
                style={{ height: '30%', minHeight: '60px', color: '#ff4d00' }}
              />
            </div>
          </div>

          {/* ── RESOLUTION BAR ── */}
          <div className="flex items-center gap-1.5 overflow-x-auto res-scrollbar py-1">
            {RESOLUTIONS.map((r, i) => (
              <button
                key={i}
                onClick={() => setResolution(i)}
                className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-bold border transition-all ${
                  resolution === i
                    ? 'border-brand-500 bg-brand-600/30 text-brand-200'
                    : 'border-surface-700/40 text-slate-500 hover:border-surface-600 hover:text-slate-300 bg-surface-800/10'
                }`}
              >
                {r.label.replace(' × ', '×')}
              </button>
            ))}
          </div>

          {/* ── REFERENCE IMAGE ── */}
          <div>
            <label className="section-label">Reference <span className="normal-case text-slate-600 font-normal">(img2img)</span></label>
            {refPreview ? (
              <div className="rounded-lg overflow-hidden border border-surface-600/60">
                <div className="relative">
                  <img src={refPreview} alt="reference" className="w-full object-cover max-h-28" />
                  <button onClick={clearRef}
                    className="absolute top-2 right-2 bg-surface-900/80 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center text-xs text-slate-400 hover:text-white transition-colors">
                    ✕
                  </button>
                </div>
                <div className="px-3 py-2 bg-surface-800/80 flex items-center gap-3">
                  <span className="text-[10px] text-slate-500">Strength</span>
                  <input type="range" min="0.1" max="1" step="0.05" value={strength}
                    onChange={e => setStrength(Number(e.target.value))}
                    className="flex-1 accent-brand-500" />
                  <span className="text-[10px] text-brand-400 font-mono w-6 text-right">{strength}</span>
                </div>
              </div>
            ) : (
              <label className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-700/40 border border-surface-600/50 border-dashed rounded-lg cursor-pointer hover:border-brand-500/60 hover:bg-surface-700/60 transition-all group">
                <span className="text-slate-500 group-hover:text-brand-400 transition-colors">⬆</span>
                <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">Upload reference image</span>
                <input type="file" accept="image/png,image/jpeg" onChange={handleRefFile} className="hidden" />
              </label>
            )}
          </div>

            {/* Asset Type — Collapsible */}
            <div>
              <button onClick={() => setShowAssets(v => !v)}
                className="flex items-center gap-2 text-[11px] font-semibold text-brand-400 hover:text-brand-300 uppercase tracking-wider transition-colors w-full">
                <span className={`transition-transform duration-150 text-[9px] ${showAssets ? 'rotate-90' : ''}`}>▶</span>
                Asset Type
              </button>
              {showAssets && (
                <div className="mt-3 grid grid-cols-3 gap-1">
                  {ASSET_TYPES.map(t => (
                    <button key={t.id} onClick={() => setAssetType(t.id)}
                      className={`px-1.5 py-1.5 rounded-lg text-[10px] font-medium border transition-all ${
                        t.id === 'concept' ? 'col-span-3 py-2 text-xs' : ''
                      } ${
                        assetType === t.id
                          ? 'border-brand-500/70 bg-brand-600/20 text-brand-300'
                          : 'border-surface-600/50 text-slate-400 hover:border-surface-500 hover:text-slate-200'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Art Style — Collapsible */}
            <div>
              <button onClick={() => setShowStyles(v => !v)}
                className="flex items-center gap-2 text-[11px] font-semibold text-brand-400 hover:text-brand-300 uppercase tracking-wider transition-colors w-full">
                <span className={`transition-transform duration-150 text-[9px] ${showStyles ? 'rotate-90' : ''}`}>▶</span>
                Art Style
              </button>
              {showStyles && (
                <div className="mt-3 grid grid-cols-2 gap-1">
                  {ART_STYLES.map(s => (
                    <button key={s.id} onClick={() => setArtStyle(s.id)}
                      className={`px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-all ${
                        artStyle === s.id
                          ? 'border-brand-500/70 bg-brand-600/20 text-brand-300'
                          : 'border-surface-600/50 text-slate-400 hover:border-surface-500 hover:text-slate-200'
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Game Genre — Collapsible with yellow header */}
            <div>
              <button onClick={() => setShowGenre(v => !v)}
                className="flex items-center gap-2 text-[11px] font-semibold text-brand-400 hover:text-brand-300 uppercase tracking-wider transition-colors w-full"
                style={{ color: '#ffcc00' }}>
                <span className={`transition-transform duration-150 text-[9px] ${showGenre ? 'rotate-90' : ''}`}>▶</span>
                Genre
              </button>
              {showGenre && (
                <div className="mt-3 grid grid-cols-3 gap-1">
                  {GAME_GENRES.map(g => (
                    <button key={g.id} onClick={() => setGenre(g.id)}
                      className={`px-1 py-1.5 rounded-lg text-[10px] font-medium border transition-all ${
                        genre === g.id
                          ? 'border-brand-500/70 bg-brand-600/20 text-brand-300'
                          : 'border-surface-600/50 text-slate-400 hover:border-surface-500 hover:text-slate-200'
                      }`}>
                      {g.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

        {/* ── PRO TOOLS ── */}
        <div>
          <button onClick={() => setShowPro(v => !v)}
            className="flex items-center gap-2 text-[11px] font-semibold text-brand-400 hover:text-brand-300 uppercase tracking-wider transition-colors w-full">
            <span className={`transition-transform duration-150 text-[9px] ${showPro ? 'rotate-90' : ''}`}>▶</span>
            Pro Tools
            <span className="ml-auto text-slate-600 font-mono normal-case tracking-normal font-normal text-[10px]">
              {steps}st · CFG {cfg}
            </span>
          </button>

          {showPro && (
            <div className="mt-3 flex flex-col gap-4 pl-3 border-l-2 border-brand-500/40">
              
              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">Steps</label>
                    <div className="group relative">
                      <span className="text-[9px] w-4 h-4 flex items-center justify-center rounded-full bg-surface-700 text-slate-500 cursor-help">?</span>
                      <div className="absolute bottom-full left-0 mb-2 w-40 p-2 rounded-lg bg-surface-900 border border-surface-600 text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        Number of denoising iterations. More steps = better quality but slower (6-20 recommended).
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-brand-400 font-mono">{steps}</span>
                </div>
                <input type="range" min={4} max={50} value={steps}
                  onChange={e => setSteps(Number(e.target.value))}
                  className="w-full accent-brand-500" />
              </div>

              {/* CFG */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-slate-500 uppercase tracking-wider">CFG Scale</label>
                    <div className="group relative">
                      <span className="text-[9px] w-4 h-4 flex items-center justify-center rounded-full bg-surface-700 text-slate-500 cursor-help">?</span>
                      <div className="absolute bottom-full left-0 mb-2 w-40 p-2 rounded-lg bg-surface-900 border border-surface-600 text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        Prompt adherence strength. Higher = stricter to prompt (1-8 recommended).
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-brand-400 font-mono">{cfg}</span>
                </div>
                <input type="range" min={1} max={15} step={0.5} value={cfg}
                  onChange={e => setCfg(Number(e.target.value))}
                  className="w-full accent-brand-500" />
              </div>

              {/* Sampler */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">Sampler</label>
                  <div className="group relative">
                    <span className="text-[9px] w-4 h-4 flex items-center justify-center rounded-full bg-surface-700 text-slate-500 cursor-help">?</span>
                    <div className="absolute bottom-full left-0 mb-2 w-48 p-2 rounded-lg bg-surface-900 border border-surface-600 text-[9px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      Denoising algorithm. Changes quality/speed/creativity. "Balanced" is recommended.
                    </div>
                  </div>
                </div>
                <select value={sampler} onChange={e => setSampler(e.target.value)}
                  className="input-field text-xs bg-surface-800 border-surface-600 text-slate-300">
                  {SAMPLERS.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>

            </div>
          )}
        </div>

        </div>{/* end preset mode div */}

        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2.5 text-xs text-red-400">
            {error}
          </div>
        )}

      </div>

      {/* ── Generate button — always visible ── */}
      <div className="shrink-0 px-4 py-3 border-t border-surface-700/60 bg-surface-800">
        {generating ? (
          <div className="flex gap-2">
            <div className="flex-1 py-3 rounded-xl bg-surface-700/60 flex items-center justify-center gap-2 text-sm text-slate-400">
              <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
              </svg>
              <span className="truncate text-xs">{progress || 'Forging…'}</span>
            </div>
            <button onClick={handleCancel}
              className="px-4 py-3 rounded-xl bg-red-900/40 hover:bg-red-800/60 border border-red-800/40 text-red-400 text-xs font-semibold transition-all">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            title="Ctrl+Enter"
            className={`w-full py-3 rounded-xl font-semibold text-sm tracking-wide transition-all ${
              canGenerate
                ? 'bg-gradient-to-r from-brand-700 to-brand-500 hover:from-brand-600 hover:to-brand-400 text-white shadow-lg shadow-brand-900/40 active:scale-[0.98]'
                : 'bg-surface-700/60 text-slate-600 cursor-not-allowed'
            }`}>
            ✦ Forge
          </button>
        )}
      </div>
    </div>
  );
}
