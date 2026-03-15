import { useState, useEffect, useRef } from 'react';

const ASSET_TYPES = [
  { id: 'character',   label: 'Character',   icon: '🧙' },
  { id: 'environment', label: 'Environment', icon: '🏔' },
  { id: 'prop',        label: 'Prop',        icon: '⚔️' },
  { id: 'creature',    label: 'Creature',    icon: '🐉' },
  { id: 'vehicle',     label: 'Vehicle',     icon: '🚀' },
  { id: 'ui',          label: 'UI Element',  icon: '🖼' },
  { id: 'texture',     label: 'Texture',     icon: '🎨' },
  { id: 'concept',     label: 'Concept Art', icon: '✏️' },
];

const ART_STYLES = [
  { id: 'stylized',  label: 'Stylized'     },
  { id: 'realistic', label: 'Realistic'    },
  { id: 'pixel',     label: 'Pixel Art'    },
  { id: 'painted',   label: 'Hand Painted' },
  { id: 'lowpoly',   label: 'Low Poly'     },
  { id: 'anime',     label: 'Anime'        },
];

const SAMPLERS = ['dpmpp_2m_sde', 'euler', 'dpmpp_2m', 'ddim', 'heun'];

const RESOLUTIONS = [
  { label: '512 × 512',   w: 512,  h: 512  },
  { label: '768 × 768',   w: 768,  h: 768  },
  { label: '1024 × 1024', w: 1024, h: 1024 },
  { label: '1024 × 576',  w: 1024, h: 576  },
  { label: '576 × 1024',  w: 576,  h: 1024 },
  { label: '1280 × 720',  w: 1280, h: 720  },
];

export default function GenerationPanel({ onGenerated }) {
  const [mode,        setMode]        = useState('custom');
  const [prompt,      setPrompt]      = useState('');
  const [negative,    setNegative]    = useState('');
  const [assetType,   setAssetType]   = useState('character');
  const [artStyle,    setArtStyle]    = useState('stylized');
  const [subject,     setSubject]     = useState('');
  const [model,       setModel]       = useState('');
  const [models,      setModels]      = useState([]);
  const [seed,        setSeed]        = useState('');
  const [steps,       setSteps]       = useState(30);
  const [cfg,         setCfg]         = useState(7);
  const [sampler,     setSampler]     = useState('dpmpp_2m_sde');
  const [resolution,  setResolution]  = useState(2);
  const [refImage,    setRefImage]    = useState(null);
  const [refPreview,  setRefPreview]  = useState(null);
  const [strength,    setStrength]    = useState(0.75);
  const [showAdv,     setShowAdv]     = useState(false);
  const [templates,   setTemplates]   = useState([]);
  const [selectedTpl, setSelectedTpl] = useState('');
  const [generating,  setGenerating]  = useState(false);
  const [progress,    setProgress]    = useState('');
  const [error,       setError]       = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => {
      setModels(d.available ?? []);
      if (d.default) setModel(d.default);
    }).catch(() => {});
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {});
  }, []);

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
    const name = window.prompt('Template name?');
    if (!name) return;
    const res = RESOLUTIONS[resolution];
    const body = {
      name, prompt, negativePrompt: negative, defaultModel: model,
      defaultSteps: steps, defaultCfg: cfg, defaultSampler: sampler,
      defaultResolution: `${res.w}x${res.h}`,
    };
    const r = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      const d = await r.json();
      setTemplates(ts => [d.template, ...ts]);
    }
  }

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    setProgress('Sending to ComfyUI…');
    const res = RESOLUTIONS[resolution];

    try {
      const form = new FormData();
      form.append('mode',           mode);
      form.append('prompt',         prompt);
      form.append('negativePrompt', negative);
      form.append('assetType',      assetType);
      form.append('artStyle',       artStyle);
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
          elapsed++;
          setProgress(`Generating… ${elapsed}s`);
          try {
            const poll = await fetch(`/api/generate/${jobId}`);
            const job  = await poll.json();
            if (job.status === 'completed') {
              clearInterval(pollRef.current);
              onGenerated(job.result);
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
      setProgress('');
    }
  }

  const canGenerate = !generating && (mode === 'preset' || prompt.trim().length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">

        <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em]">Generate</h2>

        {/* Mode tabs */}
        <div className="flex rounded-lg bg-surface-900 p-0.5 gap-0.5">
          {[['custom', 'Custom'], ['preset', 'Preset'], ['template', 'Template']].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === m
                  ? 'bg-surface-600 text-slate-100 shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── PRESET MODE ── */}
        {mode === 'preset' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-2 uppercase tracking-wider">Asset Type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {ASSET_TYPES.map(t => (
                  <button key={t.id} onClick={() => setAssetType(t.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      assetType === t.id
                        ? 'border-brand-500 bg-brand-600/15 text-brand-300'
                        : 'border-surface-600 bg-surface-700/50 text-slate-400 hover:border-surface-500 hover:text-slate-200'
                    }`}>
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-2 uppercase tracking-wider">Art Style</label>
              <div className="flex flex-wrap gap-1.5">
                {ART_STYLES.map(s => (
                  <button key={s.id} onClick={() => setArtStyle(s.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      artStyle === s.id
                        ? 'border-brand-500 bg-brand-600/15 text-brand-300'
                        : 'border-surface-600 text-slate-400 hover:border-surface-500 hover:text-slate-200'
                    }`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
                Subject <span className="normal-case text-slate-600">(optional)</span>
              </label>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={`e.g. "dark knight", "forest cave"`}
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          </div>
        )}

        {/* ── TEMPLATE MODE ── */}
        {mode === 'template' && (
          <div className="flex flex-col gap-3">
            <select value={selectedTpl} onChange={e => applyTemplate(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-brand-500">
              <option value="">— select a template —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {templates.length === 0 && (
              <p className="text-xs text-slate-600 text-center py-2">No templates yet — save one from Custom mode.</p>
            )}
          </div>
        )}

        {/* ── PROMPT FIELDS ── */}
        {mode !== 'preset' && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Prompt</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={4}
                placeholder="Describe what to generate…"
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
                Negative <span className="normal-case text-slate-600">(optional)</span>
              </label>
              <textarea
                value={negative}
                onChange={e => setNegative(e.target.value)}
                rows={2}
                placeholder="What to avoid…"
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          </div>
        )}

        {/* ── REFERENCE IMAGE ── */}
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5 uppercase tracking-wider">
            Reference <span className="normal-case text-slate-600">(img2img, optional)</span>
          </label>
          {refPreview ? (
            <div className="rounded-lg overflow-hidden border border-surface-600">
              <div className="relative">
                <img src={refPreview} alt="reference" className="w-full object-cover max-h-32" />
                <button onClick={clearRef}
                  className="absolute top-2 right-2 bg-surface-900/80 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center text-xs text-slate-400 hover:text-white transition-colors">
                  ✕
                </button>
              </div>
              <div className="px-3 py-2 bg-surface-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-500">Strength</span>
                  <span className="text-[11px] text-brand-400 font-mono">{strength}</span>
                </div>
                <input type="range" min="0.1" max="1" step="0.05" value={strength}
                  onChange={e => setStrength(Number(e.target.value))}
                  className="w-full accent-brand-500" />
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-700 border border-surface-600 border-dashed rounded-lg cursor-pointer hover:border-brand-500/60 hover:bg-surface-600/50 transition-all group">
              <span className="text-slate-600 group-hover:text-brand-400 text-sm transition-colors">⬆</span>
              <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">Upload reference image</span>
              <input type="file" accept="image/png,image/jpeg" onChange={handleRefFile} className="hidden" />
            </label>
          )}
        </div>

        {/* ── ADVANCED ── */}
        <div>
          <button onClick={() => setShowAdv(v => !v)}
            className="flex items-center gap-2 text-[11px] font-medium text-slate-500 hover:text-slate-300 uppercase tracking-wider transition-colors w-full">
            <span className={`transition-transform duration-150 text-[10px] ${showAdv ? 'rotate-90' : ''}`}>▶</span>
            Advanced
            <span className="ml-auto text-slate-700 font-mono normal-case tracking-normal font-normal text-[10px]">
              {steps}st · CFG {cfg} · {RESOLUTIONS[resolution].label}
            </span>
          </button>

          {showAdv && (
            <div className="mt-3 flex flex-col gap-4 pl-3 border-l-2 border-surface-700">
              {/* Resolution */}
              <div>
                <label className="block text-[11px] text-slate-500 mb-2 uppercase tracking-wider">Resolution</label>
                <div className="grid grid-cols-2 gap-1">
                  {RESOLUTIONS.map((r, i) => (
                    <button key={i} onClick={() => setResolution(i)}
                      className={`px-2 py-1.5 rounded-lg text-[11px] border transition-all ${
                        resolution === i
                          ? 'border-brand-500 bg-brand-600/15 text-brand-300'
                          : 'border-surface-600 text-slate-500 hover:border-surface-500 hover:text-slate-300'
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider">Steps</label>
                  <span className="text-[11px] text-brand-400 font-mono">{steps}</span>
                </div>
                <input type="range" min={10} max={50} value={steps}
                  onChange={e => setSteps(Number(e.target.value))}
                  className="w-full accent-brand-500" />
              </div>

              {/* CFG */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider">CFG Scale</label>
                  <span className="text-[11px] text-brand-400 font-mono">{cfg}</span>
                </div>
                <input type="range" min={1} max={20} step={0.5} value={cfg}
                  onChange={e => setCfg(Number(e.target.value))}
                  className="w-full accent-brand-500" />
              </div>

              {/* Model */}
              {models.length > 0 && (
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1.5 uppercase tracking-wider">Model</label>
                  <select value={model} onChange={e => setModel(e.target.value)}
                    className="w-full bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500">
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}

              {/* Sampler */}
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5 uppercase tracking-wider">Sampler</label>
                <select value={sampler} onChange={e => setSampler(e.target.value)}
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500">
                  {SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Seed */}
              <div>
                <label className="block text-[11px] text-slate-500 mb-1.5 uppercase tracking-wider">
                  Seed <span className="normal-case text-slate-600">(blank = random)</span>
                </label>
                <input type="number" value={seed} onChange={e => setSeed(e.target.value)}
                  placeholder="random"
                  className="w-full bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500" />
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-800/60 rounded-lg px-3 py-2.5 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Save as template */}
        {mode !== 'preset' && prompt.trim() && (
          <button onClick={saveAsTemplate}
            className="text-[11px] text-slate-600 hover:text-brand-400 transition-colors text-left">
            + Save as template
          </button>
        )}
      </div>

      {/* Generate button — pinned to bottom */}
      <div className="p-4 border-t border-surface-700 shrink-0">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`w-full py-3 rounded-xl font-semibold text-sm tracking-wide transition-all ${
            canGenerate
              ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/50 active:scale-[0.98]'
              : 'bg-surface-700 text-slate-600 cursor-not-allowed'
          }`}>
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
              </svg>
              {progress || 'Generating…'}
            </span>
          ) : 'Generate'}
        </button>
      </div>
    </div>
  );
}
