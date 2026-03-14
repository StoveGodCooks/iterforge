import { useState, useEffect, useRef } from 'react';

const FACTIONS    = ['AEGIS', 'ECLIPSE', 'SPECTER'];
const ATMOSPHERES = ['midday', 'nighttime', 'rain', 'flooded'];
const CONDITIONS  = ['standard', 'damaged', 'flooded'];
const SAMPLERS    = ['dpmpp_2m_sde', 'euler', 'dpmpp_2m', 'ddim', 'heun'];

export default function GenerationPanel({ onGenerated }) {
  const [mode,          setMode]          = useState('custom');   // 'custom' | 'preset' | 'template'
  const [prompt,        setPrompt]        = useState('');
  const [negative,      setNegative]      = useState('');
  const [faction,       setFaction]       = useState('AEGIS');
  const [atmosphere,    setAtmosphere]    = useState('midday');
  const [condition,     setCondition]     = useState('standard');
  const [type,          setType]          = useState('arena');
  const [model,         setModel]         = useState('');
  const [models,        setModels]        = useState([]);
  const [seed,          setSeed]          = useState('');
  const [steps,         setSteps]         = useState(30);
  const [cfg,           setCfg]           = useState(7);
  const [sampler,       setSampler]       = useState('dpmpp_2m_sde');
  const [width,         setWidth]         = useState(1024);
  const [height,        setHeight]        = useState(1024);
  const [refImage,      setRefImage]      = useState(null);
  const [refPreview,    setRefPreview]    = useState(null);
  const [strength,      setStrength]      = useState(0.75);
  const [showAdvanced,  setShowAdvanced]  = useState(false);
  const [templates,     setTemplates]     = useState([]);
  const [selectedTpl,   setSelectedTpl]   = useState('');
  const [generating,    setGenerating]    = useState(false);
  const [progress,      setProgress]      = useState('');
  const [error,         setError]         = useState('');
  const pollRef = useRef(null);

  // Load models + templates
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

  function applyTemplate(id) {
    const t = templates.find(t => t.id === id);
    if (!t) return;
    setSelectedTpl(id);
    setPrompt(t.prompt);
    setNegative(t.negativePrompt ?? '');
    if (t.defaultModel) setModel(t.defaultModel);
    if (t.defaultSteps) setSteps(t.defaultSteps);
    if (t.defaultCfg)   setCfg(t.defaultCfg);
    if (t.defaultSampler) setSampler(t.defaultSampler);
    if (t.defaultResolution) {
      const [w, h] = t.defaultResolution.split('x').map(Number);
      if (w && h) { setWidth(w); setHeight(h); }
    }
  }

  async function saveAsTemplate() {
    const name = window.prompt('Template name?');
    if (!name) return;
    const body = {
      name, prompt, negativePrompt: negative, defaultModel: model,
      defaultSteps: steps, defaultCfg: cfg, defaultSampler: sampler,
      defaultResolution: `${width}x${height}`,
    };
    const r = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) {
      const d = await r.json();
      setTemplates(ts => [d.template, ...ts]);
      alert(`Template "${name}" saved!`);
    }
  }

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    setProgress('Sending to ComfyUI…');

    try {
      const formData = new FormData();
      formData.append('mode',           mode);
      formData.append('prompt',         prompt);
      formData.append('negativePrompt', negative);
      formData.append('faction',        faction);
      formData.append('atmosphere',     atmosphere);
      formData.append('condition',      condition);
      formData.append('type',           type);
      formData.append('model',          model);
      formData.append('seed',           seed || '');
      formData.append('steps',          steps);
      formData.append('cfg',            cfg);
      formData.append('sampler',        sampler);
      formData.append('width',          width);
      formData.append('height',         height);
      formData.append('strength',       strength);
      if (refImage) formData.append('refImage', refImage);

      const startRes = await fetch('/api/generate', { method: 'POST', body: formData });
      if (!startRes.ok) {
        const err = await startRes.json();
        throw new Error(err.error || 'Generation failed');
      }
      const { jobId } = await startRes.json();

      // Poll until done
      await new Promise((resolve, reject) => {
        let elapsed = 0;
        pollRef.current = setInterval(async () => {
          elapsed += 1;
          setProgress(`Generating… ${elapsed}s`);
          try {
            const pollRes = await fetch(`/api/generate/${jobId}`);
            const job = await pollRes.json();
            if (job.status === 'completed') {
              clearInterval(pollRef.current);
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
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">Generate</h2>

      {/* Mode tabs */}
      <div className="flex rounded-lg bg-surface-700 p-0.5 text-xs">
        {['custom', 'preset', 'template'].map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1.5 rounded-md capitalize transition-colors ${mode === m ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {m}
          </button>
        ))}
      </div>

      {/* Template selector */}
      {mode === 'template' && (
        <select value={selectedTpl} onChange={e => applyTemplate(e.target.value)}
          className="w-full bg-surface-700 border border-surface-500 rounded px-3 py-2 text-sm text-slate-200">
          <option value="">— select template —</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}

      {/* Preset controls */}
      {mode === 'preset' && (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-slate-400">Type</label>
          <div className="flex gap-2">
            {['arena', 'card'].map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`flex-1 py-1.5 rounded text-sm capitalize border transition-colors ${type === t ? 'border-brand-500 bg-brand-600/20 text-brand-300' : 'border-surface-500 text-slate-400 hover:text-white'}`}>
                {t}
              </button>
            ))}
          </div>
          <label className="text-xs text-slate-400 mt-1">Faction</label>
          <div className="flex gap-2">
            {FACTIONS.map(f => (
              <button key={f} onClick={() => setFaction(f)}
                className={`flex-1 py-1 rounded text-xs border transition-colors ${faction === f ? 'border-brand-500 bg-brand-600/20 text-brand-300' : 'border-surface-500 text-slate-400 hover:text-white'}`}>
                {f}
              </button>
            ))}
          </div>
          <label className="text-xs text-slate-400 mt-1">Atmosphere</label>
          <select value={atmosphere} onChange={e => setAtmosphere(e.target.value)}
            className="bg-surface-700 border border-surface-500 rounded px-3 py-1.5 text-sm text-slate-200">
            {ATMOSPHERES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <label className="text-xs text-slate-400 mt-1">Condition</label>
          <select value={condition} onChange={e => setCondition(e.target.value)}
            className="bg-surface-700 border border-surface-500 rounded px-3 py-1.5 text-sm text-slate-200">
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {/* Custom / template prompt */}
      {mode !== 'preset' && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Prompt</label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Describe what to generate…"
              className="w-full bg-surface-700 border border-surface-500 rounded px-3 py-2 text-sm text-slate-200 resize-none focus:outline-none focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Negative prompt <span className="text-slate-600">(optional)</span></label>
            <textarea value={negative} onChange={e => setNegative(e.target.value)} rows={2} placeholder="What to avoid…"
              className="w-full bg-surface-700 border border-surface-500 rounded px-3 py-2 text-sm text-slate-200 resize-none focus:outline-none focus:border-brand-500" />
          </div>
        </>
      )}

      {/* Reference image */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Reference image <span className="text-slate-600">(optional, img2img)</span></label>
        <input type="file" accept="image/png,image/jpeg" onChange={handleRefFile}
          className="w-full text-xs text-slate-400 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-surface-600 file:text-slate-300 hover:file:bg-surface-500 cursor-pointer" />
        {refPreview && (
          <div className="mt-2 relative">
            <img src={refPreview} alt="reference" className="w-full rounded object-cover max-h-28" />
            <button onClick={() => { setRefImage(null); setRefPreview(null); }}
              className="absolute top-1 right-1 bg-surface-900/80 rounded-full w-5 h-5 flex items-center justify-center text-xs text-slate-400 hover:text-white">✕</button>
            <div className="mt-1">
              <label className="text-xs text-slate-400">Strength {strength}</label>
              <input type="range" min="0.1" max="1" step="0.05" value={strength} onChange={e => setStrength(Number(e.target.value))}
                className="w-full accent-brand-500" />
            </div>
          </div>
        )}
      </div>

      {/* Advanced */}
      <button onClick={() => setShowAdvanced(v => !v)}
        className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors">
        <span>{showAdvanced ? '▾' : '▸'}</span> Advanced
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 pl-2 border-l border-surface-600">
          {/* Model */}
          {models.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Model</label>
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full bg-surface-700 border border-surface-500 rounded px-2 py-1.5 text-sm text-slate-200">
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}

          {/* Resolution */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Width</label>
              <select value={width} onChange={e => setWidth(Number(e.target.value))}
                className="w-full bg-surface-700 border border-surface-500 rounded px-2 py-1.5 text-sm text-slate-200">
                {[512, 768, 1024, 1280].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Height</label>
              <select value={height} onChange={e => setHeight(Number(e.target.value))}
                className="w-full bg-surface-700 border border-surface-500 rounded px-2 py-1.5 text-sm text-slate-200">
                {[512, 768, 1024, 1280].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {/* Steps + CFG */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Steps: {steps}</label>
            <input type="range" min={10} max={50} value={steps} onChange={e => setSteps(Number(e.target.value))}
              className="w-full accent-brand-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">CFG scale: {cfg}</label>
            <input type="range" min={1} max={20} step={0.5} value={cfg} onChange={e => setCfg(Number(e.target.value))}
              className="w-full accent-brand-500" />
          </div>

          {/* Sampler */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Sampler</label>
            <select value={sampler} onChange={e => setSampler(e.target.value)}
              className="w-full bg-surface-700 border border-surface-500 rounded px-2 py-1.5 text-sm text-slate-200">
              {SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Seed */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Seed <span className="text-slate-600">(blank = random)</span></label>
            <input type="number" value={seed} onChange={e => setSeed(e.target.value)} placeholder="random"
              className="w-full bg-surface-700 border border-surface-500 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Save template button (custom/template mode) */}
      {mode !== 'preset' && prompt.trim() && (
        <button onClick={saveAsTemplate}
          className="text-xs text-slate-500 hover:text-brand-400 transition-colors text-left">
          + Save as template
        </button>
      )}

      {/* Generate button */}
      <button onClick={handleGenerate} disabled={!canGenerate}
        className={`mt-2 w-full py-3 rounded-lg font-semibold text-sm transition-all ${canGenerate
          ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40 active:scale-95'
          : 'bg-surface-600 text-slate-500 cursor-not-allowed'}`}>
        {generating ? progress || 'Generating…' : 'Generate'}
      </button>
    </div>
  );
}
