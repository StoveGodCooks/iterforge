import { useState, useRef, useCallback, useEffect } from "react";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import "./Prospecting.css";
import AnvilWorkspace from "../../components/Anvil/AnvilWorkspace";
import LogoBadge3D from "../../components/MeshViewer/LogoBadge3D";
import ifLogoGlb from "../../assets/if-logo.glb?url";
import { useAssetTray } from "../../contexts/AssetTrayContext";
import { useAnvilBoard } from "../../contexts/AnvilBoardContext";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ProspectingOutput, AssetType, ArtStyle, ReconstructionPath, ModelInfo } from "../../types/pipeline";

import { BACKEND, jobStreamUrl } from "../../api/client";

interface ImageMeta {
  rawPath:            string | null;
  rgbaUrl:            string | null;
  svgData:            string | null;
  svgPath:            string | null;
  lightingPreset:     string | null;
  reconstructionPath: string | null;
}

interface Props {
  onLock: (data: ProspectingOutput) => void;
  onJumpTo: (stage: string) => void;
  tinkerMode: boolean;
}

type WorkspaceMode = "results" | "anvil";

/* ── Asset types ────────────────────────────────────────────── */
const ASSET_TYPES = [
  // Concept Art is FIRST — open sandbox, no pipeline constraints
  { id: "concept",     label: "💡 Concept Art",    desc: "Free brainstorm — no pipeline constraints" },
  { id: "character",   label: "🧙 Character",       desc: "Hero, NPC, villain, humanoid" },
  { id: "creature",    label: "👾 Creature",         desc: "Monster, beast, alien" },
  { id: "animal",      label: "🐉 Animal",           desc: "Wildlife, mount, pet" },
  { id: "weapon",      label: "⚔ Weapon",           desc: "Sword, gun, staff, bow" },
  { id: "armor",       label: "🛡 Armor",            desc: "Full suit, chest piece, helm" },
  { id: "shield",      label: "🔰 Shield",           desc: "Buckler, tower shield, barrier" },
  { id: "prop",        label: "📦 Prop",             desc: "Chest, barrel, furniture, item" },
  { id: "vehicle",     label: "⚙ Vehicle",          desc: "Cart, ship, mech, spacecraft" },
  { id: "building",    label: "🏰 Building",         desc: "Structure, dungeon, ruin, tower" },
  { id: "environment", label: "🌲 Environment",      desc: "Terrain, biome, landscape" },
  { id: "tileset",     label: "🧱 Tileset",          desc: "Repeatable ground, wall, floor tiles" },
  { id: "vfx",         label: "✨ VFX / Particle",   desc: "Explosion, magic, fire reference" },
  { id: "ui",          label: "🎯 UI Element",       desc: "Icon, button, frame, badge" },
  { id: "portrait",    label: "🖼 Portrait",         desc: "Face, bust, profile art" },
  { id: "logo",        label: "⚜ Logo / Emblem",    desc: "Faction crest, brand mark, seal" },
  { id: "background",  label: "🌄 Background",       desc: "Skybox, parallax layer, scene BG" },
];

/* ── Art styles ─────────────────────────────────────────────── */
const ART_STYLES = [
  { id: "painterly",  label: "Painterly" },
  { id: "pixel_art",  label: "Pixel Art" },
  { id: "low_poly",   label: "Low Poly" },
  { id: "realistic",  label: "Realistic" },
  { id: "stylized",   label: "Stylized" },
  { id: "sketch",     label: "Sketch" },
  { id: "cel_shaded", label: "Cel-Shaded" },
  { id: "isometric",  label: "Isometric" },
] as const satisfies ReadonlyArray<{ id: ArtStyle; label: string }>;

/* ── Auto lighting map (backend logic shown to user) ────────── */
const AUTO_LIGHTING: Record<string, { label: string; reason: string }> = {
  concept:     { label: "🎨 Free",            reason: "Concept Art mode — no lighting constraints" },
  character:   { label: "☀ Top ¾ Soft Box",  reason: "Industry standard for game characters" },
  creature:    { label: "☀ Top ¾ Soft Box",  reason: "Shows form and silhouette cleanly" },
  animal:      { label: "☀ Top ¾ Soft Box",  reason: "Consistent with character pipeline" },
  weapon:      { label: "⊙ Front + Rim",     reason: "Reveals edge detail and silhouette" },
  armor:       { label: "⊙ Front + Rim",     reason: "Shows surface material and edges" },
  shield:      { label: "⊙ Front + Rim",     reason: "Flat face reads best front-lit" },
  prop:        { label: "↗ 45° Overhead",    reason: "Clean read, no harsh shadows" },
  vehicle:     { label: "↗ 45° Overhead",    reason: "Shows scale and silhouette" },
  building:    { label: "↗ 45° Overhead",    reason: "Architectural clarity" },
  environment: { label: "◻ Overcast",        reason: "Even light, no directional bias" },
  tileset:     { label: "◻ Flat",            reason: "Tiles must be directionless to tile seamlessly" },
  vfx:         { label: "🌑 Dark BG",        reason: "Additive effects read on black" },
  ui:          { label: "◻ Flat",            reason: "UI elements need no lighting" },
  portrait:    { label: "☀ Top ¾ Soft Box",  reason: "Classic portrait lighting" },
  logo:        { label: "◻ Flat",            reason: "Logos need clean flat read" },
  background:  { label: "◻ Overcast",        reason: "Scene BGs need even lighting" },
};

/* ── Samplers ───────────────────────────────────────────────── */
const SAMPLERS = [
  "DPM++ 2M Karras",
  "DPM++ SDE Karras",
  "Euler a",
  "Euler",
  "DDIM",
  "UniPC",
];

/* ── Mock LoRA list (will be populated from backend scan) ───── */
interface LoRA {
  id: string;          // filename stem (sent to the backend as `file`)
  name: string;        // prettified label
  filename?: string;
  size_mb?: number;
  weight: number;
  enabled: boolean;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export default function Prospecting({ onLock, onJumpTo, tinkerMode }: Props) {
  /* Prompt */
  const [prompt,    setPrompt]    = useState("");
  // Empty by default — the backend auto-applies the full system negative
  // prompt (shadow / multi-object / quality guardrails from MasterForge).
  // This field is for *extra* user-specific negatives only.
  const [negPrompt, setNegPrompt] = useState("");

  /* Selections */
  const [assetType,  setAssetType]  = useState<string | null>(null);
  const [artStyle,   setArtStyle]   = useState<ArtStyle | null>(null);

  /* Generation settings */
  const [steps,    setSteps]    = useState(30);
  const [cfg,      setCfg]      = useState(7);
  const [sampler,  setSampler]  = useState(SAMPLERS[0]);
  const [seed,     setSeed]     = useState(-1);
  const [batch,    setBatch]    = useState(1);

  /* LoRAs */
  const [loras, setLoras] = useState<LoRA[]>([]);

  /* Models (switchable checkpoints from the registry) */
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  /* Img2Img */
  const [img2imgOn,  setImg2imgOn]  = useState(false);
  const [img2imgSrc, setImg2imgSrc] = useState<string | null>(null);
  const [img2imgPath, setImg2imgPath] = useState<string | null>(null);
  const [denoise,    setDenoise]    = useState(0.75);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { addItem: addToTray } = useAssetTray();
  const anvil = useAnvilBoard();

  // When the Anvil sends a panel as a reference, load it into img2img.
  useEffect(() => {
    if (!anvil.pendingReference) return;
    setImg2imgPath(anvil.pendingReference);
    try { setImg2imgSrc(convertFileSrc(anvil.pendingReference)); } catch { /* browser dev */ }
    setImg2imgOn(true);
    anvil.clearPendingReference();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anvil.pendingReference]);

  /* Drag an Asset Tray item onto the display → show it in the results view. */
  const [dropActive, setDropActive] = useState(false);
  function handleAssetDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    let display: string | null = null;
    const raw = e.dataTransfer.getData("application/x-interforge-asset");
    if (raw) {
      try { display = (JSON.parse(raw).display as string) ?? null; } catch { /* not our payload */ }
    }
    if (!display) display = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || null;
    if (!display) return;
    setWorkspaceMode("results");
    setImages((prev) => {
      const idx = prev.indexOf(display!);
      if (idx >= 0) { setSelected(idx); return prev; }   // already shown → just select it
      const next = [...prev, display!];
      setSelected(next.length - 1);
      return next;
    });
  }

  /* Output gallery */
  const [images,     setImages]     = useState<string[]>([]);
  const [imageMeta,  setImageMeta]  = useState<Record<number, ImageMeta>>({});
  const [selected,   setSelected]   = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genStatus,  setGenStatus]  = useState<string>("");
  const [genPct,     setGenPct]     = useState(0);
  const [genStep,    setGenStep]    = useState(0);
  const [genTotal,   setGenTotal]   = useState(0);
  const [genError,   setGenError]   = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const genTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  /* Cleanup timeout + EventSource on unmount */
  useEffect(() => {
    return () => {
      if (genTimeoutRef.current) clearTimeout(genTimeoutRef.current);
      sseRef.current?.close();
    };
  }, []);

  /* Scan the real LoRA library from the backend. Retries until the backend is
     up — the desktop window can open before the FastAPI process is ready, and
     a single failed fetch would otherwise leave the list permanently empty. */
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const load = () => {
      fetch(`${BACKEND}/api/loras`)
        .then(r => r.ok ? r.json() as Promise<{ loras: { id: string; name: string; filename: string; size_mb: number }[] }> : Promise.reject(r.status))
        .then(data => {
          if (cancelled) return;
          setLoras(data.loras.map(l => ({ ...l, weight: 0.8, enabled: false })));
        })
        .catch(() => {
          if (!cancelled && attempt++ < 15) setTimeout(load, 1500);
        });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  /* Scan the switchable model registry from the backend (same retry rationale). */
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const load = () => {
      fetch(`${BACKEND}/api/models`)
        .then(r => r.ok ? r.json() as Promise<{ models: ModelInfo[] }> : Promise.reject(r.status))
        .then(data => {
          if (cancelled) return;
          setModels(data.models);
          // Default the picker to the shipped default (or first enabled).
          setSelectedModel(prev => {
            if (prev) return prev;
            const def = data.models.find(m => m.default && m.enabled)
              ?? data.models.find(m => m.enabled);
            return def?.id ?? null;
          });
        })
        .catch(() => {
          if (!cancelled && attempt++ < 15) setTimeout(load, 1500);
        });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  /* SVG overlay */
  const [svgOn,        setSvgOn]        = useState(false);
  const [svgDetail,    setSvgDetail]    = useState(0.6);
  const [svgData,      setSvgData]      = useState<string | null>(null);
  const [svgAnalyzing, setSvgAnalyzing] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("results");

  /* Collapsible state */
  const [open, setOpen] = useState<Record<string, boolean>>({
    asset: true,
    style: true,
    gen:   false,
    lora:  false,
    model: false,
  });
  function toggleSection(key: string) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  }

  /* Auto lighting for current asset type */
  const autoLight = assetType ? AUTO_LIGHTING[assetType] : null;
  const isConcept = assetType === "concept";

  /* Suggested LoRAs for current asset type */
  // Real LoRA files have no tags — show them all.
  const suggestedLoras = loras;
  const activeLoras = loras.filter(l => l.enabled).map(l => ({ file: l.id, weight: l.weight }));

  /* Toggle LoRA on/off */
  function toggleLora(id: string) {
    setLoras(prev => prev.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l));
  }

  /* Adjust LoRA weight */
  function setLoraWeight(id: string, weight: number) {
    setLoras(prev => prev.map(l => l.id === id ? { ...l, weight } : l));
  }

  /* Img2Img — use Tauri open dialog for real filesystem path */
  const handleImg2ImgDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Drag-and-drop: browser can't give us a real path, prompt user to use file picker
    // Set preview blob for display, but clear the path so we don't send a blob: URL
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      setImg2imgSrc(URL.createObjectURL(file));
      setImg2imgPath(null); // no real path from drag — backend won't use this
      setImg2imgOn(true);
    }
  }, []);

  const handleImg2ImgFile = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (selected) {
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      setImg2imgPath(filePath);
      // Also set preview src via backend URL
      setImg2imgSrc(`http://127.0.0.1:7842/outputs/../${filePath}`);
      setImg2imgOn(true);
    }
  }, []);

  function randomSeed() {
    setSeed(Math.floor(Math.random() * 2_147_483_647));
  }

  /* When selected image changes — sync SVG from metadata ──── */
  useEffect(() => {
    if (selected === null) return;
    const meta = imageMeta[selected];
    if (meta?.svgData) {
      setSvgData(meta.svgData);
      setSvgOn(true);
    } else {
      setSvgData(null);
      setSvgOn(false);
    }
  }, [selected, imageMeta]);

  /* Generate — calls real backend ─────────────────────────── */
  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenStatus("Starting…");
    setGenPct(0);
    setGenStep(0);
    setGenTotal(0);
    setGenError(null);
    // Clear any previous timeout
    if (genTimeoutRef.current) clearTimeout(genTimeoutRef.current);

    let jobId: string;
    try {
      const res = await fetch(`${BACKEND}/api/prospect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          neg_prompt:   negPrompt,
          asset_type:   assetType  || "prop",
          art_style:    artStyle   || "stylized",
          seed,
          batch_size:   batch,
          reference_image_path: img2imgOn && img2imgPath ? img2imgPath : null,
          loras:        activeLoras,
          model:        selectedModel,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(
          err.detail?.message
          ?? (typeof err.detail === "string" ? err.detail : null)
          ?? "Backend error"
        );
      }
      const data = await res.json();
      jobId = data.job_id;
      setCurrentJobId(jobId);
    } catch (err: unknown) {
      setGenStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setGenerating(false);
      return;
    }

    // Subscribe to SSE stream
    const evtSource = new EventSource(jobStreamUrl(jobId));
    sseRef.current = evtSource;

    // Watchdog: if nothing resolves within 15 minutes, surface an error
    // (rembg downloads its model ~175 MB on first run which can take several minutes)
    genTimeoutRef.current = setTimeout(() => {
      evtSource.close();
      setGenerating(false);
      setGenError("Generation timed out after 15 minutes. Check the backend terminal for errors.");
    }, 15 * 60 * 1000);

    function finish() {
      if (genTimeoutRef.current) clearTimeout(genTimeoutRef.current);
      evtSource.close();
      sseRef.current = null;
      setGenerating(false);
    }

    evtSource.onmessage = (e) => {
      const event = JSON.parse(e.data) as Record<string, unknown>;
      const type  = event.type as string;

      if (type === "progress") {
        const pct   = event.pct   as number;
        const step  = event.step  as number;
        const total = event.total as number;
        setGenPct(pct);
        setGenStep(step);
        setGenTotal(total);
        setGenStatus(event.message as string ?? "Generating…");
      }

      if (type === "log") {
        setGenStatus(event.message as string);
      }

      if (type === "image_ready") {
        const idx      = event.index     as number;
        const imageUrl = event.image_url as string;
        const rawPath  = (event.raw_path as string | null) ?? null;
        const rgbaUrl  = event.rgba_url  as string | null;
        setImages(prev => {
          const next = [...prev];
          next[idx]  = imageUrl;
          return next;
        });
        addToTray({
          src: imageUrl,
          thumbnailSrc: imageUrl,
          label: `Concept ${idx + 1}`,
          sourceStage: "prospect",
          sourceJobId: jobId,
          tags: [],
        });
        setImageMeta(prev => ({
          ...prev,
          [idx]: {
            ...prev[idx],
            rawPath,
            rgbaUrl,
            svgData:            null,
            svgPath:            null,
            lightingPreset:     null,
            reconstructionPath: null,
          },
        }));
        setSelected(s => s === null ? idx : s);
      }

      if (type === "svg_ready") {
        const idx     = event.index    as number;
        const rgbaUrl = event.rgba_url as string | null;
        const svgData = event.svg_data as string | null;
        setImageMeta(prev => ({
          ...prev,
          [idx]: {
            ...prev[idx],
            rgbaUrl,
            svgData,
          },
        }));
      }

      if (type === "done") {
        const result = event as Record<string, unknown>;
        const imgs   = result.images as Array<Record<string, unknown>>;
        if (Array.isArray(imgs)) {
          if (imgs.length === 0) {
            setGenError("Generation finished but returned no images. Check the backend terminal for errors.");
          }
          setImageMeta(prev => {
            const next = { ...prev };
            imgs.forEach((img, i) => {
              next[i] = {
                ...next[i],
                rawPath:            (img.raw_path as string | null) ?? next[i]?.rawPath ?? null,
                rgbaUrl:            (img.rgba_url as string | null) ?? next[i]?.rgbaUrl ?? null,
                svgPath:            (img.svg_path as string | null) ?? next[i]?.svgPath ?? null,
                svgData:            (img.svg_data as string | null) ?? next[i]?.svgData ?? null,
                lightingPreset:     result.lighting_preset   as string | null,
                reconstructionPath: result.reconstruction_path as string | null,
              };
            });
            return next;
          });
        }
        setGenStatus("Done");
        setGenPct(100);
        finish();
      }

      if (type === "error") {
        const msg = event.message as string;
        setGenError(`${msg}`);
        setGenStatus(`Failed`);
        finish();
      }
    };

    evtSource.onerror = () => {
      // Only surface an error if we haven't already finished cleanly
      setGenError(e =>
        e !== null ? e : "Lost connection to backend. The job may still be running — check the backend terminal and try again."
      );
      finish();
    };
  }

  /* Regen SVG — hits /api/prospect/svg with the RGBA path ─── */
  async function handleRegenSvg() {
    if (selected === null) return;
    const meta = imageMeta[selected];
    if (!meta?.rawPath) return;

    setSvgAnalyzing(true);
    setSvgData(null);
    setSvgOn(false);
    try {
      const res = await fetch(`${BACKEND}/api/prospect/svg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: meta.rawPath, detail: svgDetail }),
      });
      if (!res.ok) throw new Error("SVG regen failed");
      const data = await res.json() as { svg_data: string };
      setSvgData(data.svg_data);
      setSvgOn(true);
      setImageMeta(prev => ({
        ...prev,
        [selected]: { ...prev[selected], svgData: data.svg_data },
      }));
    } catch {
      // Silently fail — user can retry
    } finally {
      setSvgAnalyzing(false);
    }
  }

  async function handleDownload(imageUrl: string, index: number) {
    try {
      const targetPath = await save({
        title: "Save Image",
        defaultPath: `prospect_${index + 1}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!targetPath) return;
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      await writeFile(targetPath, new Uint8Array(await response.arrayBuffer()));
    } catch {
      // Silent — user can retry
    }
  }

  function handleLock() {
    if (selected === null || images.length === 0) return;
    const meta = imageMeta[selected] ?? {};
    onLock({
      imagePath:          images[selected],
      rgbaPath:           meta.rgbaUrl            ?? null,
      svgPath:            meta.svgPath            ?? null,
      svgData:            meta.svgData ?? svgData ?? null,
      prompt,
      negPrompt,
      seed,
      assetType:          assetType as AssetType | null,
      artStyle:           artStyle  as ArtStyle  | null,
      lightingPreset:     meta.lightingPreset                              ?? null,
      reconstructionPath: (meta.reconstructionPath as ReconstructionPath) ?? null,
      prospectJobId:      currentJobId,
      lockedImageIndex:   selected,
      loras:              activeLoras,
      model:              selectedModel ?? undefined,
    });
  }

  return (
    <div className="prospecting">

      {/* ── LEFT PANEL ───────────────────────────────────────── */}
      <aside className="pros__panel">
        <div className="pros__panel-scroll">

          {/* 1. PROMPT BOX ─────────────────────────────────── */}
          <div className="prompt-box">
            <div className="prompt-box__positive">
              <span className="prompt-box__tag prompt-box__tag--pos">Prompt</span>
              <textarea
                className="prompt-box__textarea prompt-box__textarea--pos"
                placeholder={isConcept
                  ? "What are you imagining? Describe anything…"
                  : "Describe your game asset in detail…"}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={6}
              />
              <span className="prompt-box__count">{prompt.length}</span>
            </div>
            <div className="prompt-box__negative">
              <span className="prompt-box__tag prompt-box__tag--neg">Negative (extras)</span>
              <textarea
                className="prompt-box__textarea prompt-box__textarea--neg"
                placeholder="System guardrails (shadows, multi-object, quality) are applied automatically. Add extra exclusions here…"
                value={negPrompt}
                onChange={e => setNegPrompt(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {/* 2. IMAGE REFERENCE — compact bar under prompt ─────── */}
          <div className="img2img">
            <div
              className="img2img__bar"
              onDrop={handleImg2ImgDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => !img2imgSrc && fileInputRef.current?.click()}
            >
              {/* Left: toggle + label */}
              <button
                className={`img2img__toggle ${img2imgOn ? "img2img__toggle--on" : ""}`}
                onClick={e => { e.stopPropagation(); setImg2imgOn(p => !p); }}
                title={img2imgOn ? "Disable img2img" : "Enable img2img"}
              />
              <span className="img2img__bar-label">
                🖼 Image Reference
              </span>
              {img2imgOn && <span className="badge badge--yellow">ON</span>}

              {/* Right: thumbnail or hint */}
              <div className="img2img__bar-right">
                {img2imgSrc ? (
                  <div className="img2img__thumb">
                    <img src={img2imgSrc} alt="ref" />
                    <button className="img2img__thumb-remove"
                      onClick={e => { e.stopPropagation(); setImg2imgSrc(null); setImg2imgOn(false); }}>
                      ✕
                    </button>
                  </div>
                ) : (
                  <span className="img2img__bar-hint">Drop or click ↑</span>
                )}
              </div>
            </div>

            {/* Denoise slider — only when img2img is on AND image loaded */}
            {img2imgOn && img2imgSrc && (
              <div className="img2img__strength">
                <div className="slider-row">
                  <div className="slider-row__header">
                    <span className="slider-row__label">Denoise Strength</span>
                    <span className="slider-row__value">{denoise.toFixed(2)}</span>
                  </div>
                  <input type="range" className="slider"
                    min={0.1} max={1.0} step={0.05}
                    value={denoise} onChange={e => setDenoise(Number(e.target.value))} />
                </div>
              </div>
            )}

            <input ref={fileInputRef} type="file" accept="image/*"
              style={{ display: "none" }} onChange={handleImg2ImgFile} />
          </div>

          {/* 3. ASSET TYPE ──────────────────────────────────── */}
          <Collapsible icon="⚔" title="Asset Type" id="asset"
            open={open.asset} onToggle={() => toggleSection("asset")}
            selectionLabel={assetType
              ? ASSET_TYPES.find(t => t.id === assetType)?.label ?? null
              : null}>

            <div className="asset-grid">
              {ASSET_TYPES.map(t => (
                <button
                  key={t.id}
                  className={`asset-chip ${assetType === t.id ? "asset-chip--active" : ""} ${t.id === "concept" ? "asset-chip--concept" : ""}`}
                  onClick={() => setAssetType(assetType === t.id ? null : t.id)}
                  title={t.desc}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Auto-lighting badge */}
            {autoLight && (
              <div className={`lighting-badge ${isConcept ? "lighting-badge--free" : ""}`}>
                <span className="lighting-badge__icon">💡</span>
                <div>
                  <span className="lighting-badge__label">
                    Auto Lighting: <strong>{autoLight.label}</strong>
                  </span>
                  <span className="lighting-badge__reason">{autoLight.reason}</span>
                </div>
              </div>
            )}
          </Collapsible>

          {/* 4. ART STYLE ───────────────────────────────────── */}
          <Collapsible icon="🎨" title="Art Style" id="style"
            open={open.style} onToggle={() => toggleSection("style")}
            selectionLabel={artStyle
              ? ART_STYLES.find(s => s.id === artStyle)?.label ?? null
              : null}>
            <div className="chip-grid">
              {ART_STYLES.map(s => (
                <button
                  key={s.id}
                  className={`chip ${artStyle === s.id ? "chip--active" : ""}`}
                  onClick={() => setArtStyle(artStyle === s.id ? null : s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </Collapsible>

          {/* 5. GENERATION SETTINGS ─────────────────────────── */}
          <Collapsible icon="⚙" title="Generation Settings" id="gen"
            open={open.gen} onToggle={() => toggleSection("gen")}>

            <div className="slider-row">
              <div className="slider-row__header">
                <span className="slider-row__label">Steps</span>
                <span className="slider-row__value">{steps}</span>
              </div>
              <input type="range" className="slider"
                min={10} max={60} step={1}
                value={steps} onChange={e => setSteps(Number(e.target.value))} />
            </div>

            <div className="slider-row">
              <div className="slider-row__header">
                <span className="slider-row__label">CFG Scale</span>
                <span className="slider-row__value">{cfg.toFixed(1)}</span>
              </div>
              <input type="range" className="slider"
                min={1} max={20} step={0.5}
                value={cfg} onChange={e => setCfg(Number(e.target.value))} />
            </div>

            <div style={{ marginBottom: "var(--space-3)" }}>
              <label className="label">Sampler</label>
              <select className="select" value={sampler} onChange={e => setSampler(e.target.value)}>
                {SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <label className="label">Seed</label>
            <div className="seed-row">
              <input type="number" className="input"
                value={seed} onChange={e => setSeed(Number(e.target.value))}
                placeholder="-1 = random" />
              <button className="btn btn--secondary btn--icon" onClick={randomSeed} title="Randomise seed">🎲</button>
            </div>

            <div style={{ marginTop: "var(--space-3)" }}>
              <label className="label">Batch Size</label>
              <div className="batch-row">
                {[1, 2, 4].map(n => (
                  <button key={n}
                    className={`batch-btn ${batch === n ? "batch-btn--active" : ""}`}
                    onClick={() => setBatch(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </Collapsible>

          {/* 6. LORA ────────────────────────────────────────── */}
          <Collapsible icon="🧬" title="LoRA" id="lora"
            open={open.lora} onToggle={() => toggleSection("lora")}
            badge={loras.filter(l => l.enabled).length > 0
              ? `${loras.filter(l => l.enabled).length} active`
              : undefined}>

            {/* Backend scan notice */}
            <div className="lora-scan-notice">
              <span>📂</span>
              <span>{loras.length} scanned from <code>models/loras/</code></span>
            </div>

            {loras.length === 0 && (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
                No LoRA files found in <code>models/loras/</code>.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {suggestedLoras.map(lora => (
                <div key={lora.id} className={`lora-card ${lora.enabled ? "lora-card--active" : ""}`}>
                  <div className="lora-card__top">
                    <div className="lora-card__info">
                      <span className="lora-card__name">{lora.name}</span>
                      {typeof lora.size_mb === "number" && (
                        <span className="badge badge--yellow">{lora.size_mb} MB</span>
                      )}
                    </div>
                    <button
                      className={`lora-toggle ${lora.enabled ? "lora-toggle--on" : ""}`}
                      onClick={() => toggleLora(lora.id)}
                    />
                  </div>
                  {lora.enabled && (
                    <div className="lora-card__weight">
                      <div className="slider-row__header">
                        <span className="slider-row__label">Weight</span>
                        <span className="slider-row__value">{lora.weight.toFixed(2)}</span>
                      </div>
                      <input type="range" className="slider"
                        min={0} max={1.5} step={0.05}
                        value={lora.weight}
                        onChange={e => setLoraWeight(lora.id, Number(e.target.value))} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Collapsible>

          {/* 7. MODEL ───────────────────────────────────────── */}
          <Collapsible icon="🎨" title="Model" id="model"
            open={open.model} onToggle={() => toggleSection("model")}
            badge={models.find(m => m.id === selectedModel)?.label}>

            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
              First use of a model downloads it; on 8&nbsp;GB VRAM, switching unloads
              the current model and reloads.
            </p>

            {models.length === 0 && (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                No models reported by the backend.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {models.map(m => {
                const active = m.id === selectedModel;
                const disabled = !m.enabled;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`lora-card ${active ? "lora-card--active" : ""}`}
                    disabled={disabled}
                    onClick={() => !disabled && setSelectedModel(m.id)}
                    style={{
                      textAlign: "left", cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1, width: "100%",
                      border: active ? "1px solid var(--yellow-bright)" : undefined,
                    }}
                  >
                    <div className="lora-card__top">
                      <div className="lora-card__info">
                        <span className="lora-card__name">{m.label}</span>
                        <span className="badge badge--yellow">{m.license}</span>
                        {!m.local && <span className="badge">↓ download</span>}
                        {disabled && <span className="badge">soon</span>}
                      </div>
                      <span
                        className={`lora-toggle ${active ? "lora-toggle--on" : ""}`}
                        style={{ pointerEvents: "none" }}
                      />
                    </div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: "var(--space-1)" }}>
                      {m.note}
                    </div>
                  </button>
                );
              })}
            </div>
          </Collapsible>

        </div>

        {/* ── Sticky generate footer ───────────────────────── */}
        <div className="pros__panel-footer">
          <button
            className="pros__generate-btn"
            onClick={handleGenerate}
            disabled={!prompt.trim() || generating}
          >
            {generating ? (
              <>
                <span className="spinner" style={{ borderTopColor: "#000" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                  {genStep > 0 && genTotal > 0 && genPct < 100
                    ? `Step ${genStep}/${genTotal}`
                    : genStatus || "Processing…"}
                </span>
              </>
            ) : <>✦ Generate</>}
          </button>
          <button className="pros__rand-btn" onClick={randomSeed} title="New random seed">🎲</button>
        </div>
        {generating && (
          <div className="pros__progress-bar">
            <div
              className={`pros__progress-fill ${genPct === 0 ? "pros__progress-fill--pulse" : ""}`}
              style={{ width: genPct > 0 ? `${genPct}%` : "8%" }}
            />
          </div>
        )}
        {generating && genStatus && (
          <div className="pros__gen-status-label">{genStatus}</div>
        )}
      </aside>

      {/* ── RIGHT CANVAS ─────────────────────────────────────── */}
      <section
        className="pros__canvas"
        onDrop={handleAssetDrop}
        onDragOver={(e) => { e.preventDefault(); if (!dropActive) setDropActive(true); }}
        onDragLeave={() => setDropActive(false)}
        style={dropActive ? { outline: "2px dashed var(--yellow-core)", outlineOffset: -8 } : undefined}
      >
        <div className="pros__canvas-toolbar">
          <span className="pros__canvas-info">
            {workspaceMode === "anvil"
              ? "Anvil workspace active"
              : images.length > 0
                ? `${images.length} image${images.length !== 1 ? "s" : ""} generated`
                : ""}
          </span>
          <div className="pros__canvas-toolbar-actions">
            <div className="pros__workspace-toggle" role="tablist" aria-label="Prospecting workspace mode">
              <button
                className={`pros__workspace-toggle-btn ${workspaceMode === "results" ? "pros__workspace-toggle-btn--active" : ""}`}
                onClick={() => setWorkspaceMode("results")}
              >
                Results
              </button>
              <button
                className={`pros__workspace-toggle-btn ${workspaceMode === "anvil" ? "pros__workspace-toggle-btn--active" : ""}`}
                onClick={() => anvil.open()}
              >
                Anvil
              </button>
            </div>
            {images.length > 0 && (
              <button className="btn btn--ghost" style={{ fontSize: "var(--text-xs)", height: 28 }}
                onClick={() => { setImages([]); setSelected(null); anvil.open(); }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* ── SVG Analysis Bar ─────────────────────────────── */}
        {workspaceMode === "results" && selected !== null && (
          <div className="pros__svg-bar">
            <div className="pros__svg-bar__left">
              <button
                className={`pros__svg-toggle ${svgOn ? "pros__svg-toggle--on" : ""}`}
                onClick={() => setSvgOn(v => !v)}
                disabled={!svgData}
                title="Toggle SVG contour overlay"
              >
                <span className="pros__svg-toggle-dot" />
                SVG Overlay
              </button>

              {svgData && (
                <div className="pros__svg-detail">
                  <span>Detail</span>
                  <input
                    type="range" className="slider"
                    min={0.1} max={1.0} step={0.05}
                    value={svgDetail}
                    onChange={e => setSvgDetail(Number(e.target.value))}
                    style={{ width: 72 }}
                  />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--yellow-bright)", minWidth: 28 }}>
                    {svgDetail.toFixed(2)}
                  </span>
                </div>
              )}

              {svgAnalyzing && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  Analysing contours…
                </span>
              )}
            </div>

            <button
              className="pros__svg-regen-btn"
              onClick={handleRegenSvg}
              disabled={svgAnalyzing}
              title="Re-run SVG contour analysis"
            >
              {svgAnalyzing ? "…" : "↺"} Regen SVG
            </button>
          </div>
        )}

        {/* ── Error banner ─────────────────────────────────── */}
        {workspaceMode === "results" && genError && (
          <div className="pros__gen-error">
            <div className="pros__gen-error__header">
              <span>⚠ Generation failed</span>
              <button className="pros__gen-error__dismiss" onClick={() => setGenError(null)}>✕</button>
            </div>
            <p className="pros__gen-error__msg">{genError}</p>
          </div>
        )}

        {workspaceMode === "anvil" ? (
          <div className="pros__anvil-stage">
            <AnvilWorkspace embedded />
          </div>
        ) : images.length === 0 && !genError ? (
          /* ── Forge-vibe empty state ── */
          <div className="pros__forge-empty">
            <div style={{ position: "relative", marginBottom: 24 }}>
              {/* Glow bloom */}
              <div style={{
                position: "absolute", inset: "-48px",
                background: "radial-gradient(circle, rgba(94,169,255,0.22) 0%, transparent 65%)",
                filter: "blur(16px)",
                pointerEvents: "none",
              }} />
              {/* Animated 3D InterForge logo */}
              <div style={{ position: "relative" }}>
                <LogoBadge3D glbUrl={ifLogoGlb} size={160} />
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-primary)", fontWeight: 600, letterSpacing: "0.01em" }}>
              Describe your asset — strike Generate.
            </p>
            <p style={{ margin: "6px 0 0", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Or sketch your concept first.
            </p>
            <button
              style={{
                marginTop: 20, padding: "8px 18px",
                border: "1px solid rgba(94,169,255,0.25)",
                borderRadius: "var(--radius-full)",
                background: "rgba(94,169,255,0.07)",
                color: "var(--yellow-bright)",
                fontSize: "var(--text-xs)", fontWeight: 700,
                letterSpacing: "0.06em", textTransform: "uppercase",
                cursor: "pointer",
                transition: "background var(--transition-fast), border-color var(--transition-fast)",
              }}
              onClick={() => anvil.open()}
            >
              Open Anvil →
            </button>
          </div>
        ) : images.length === 0 ? null : (
          <div className="pros__gallery">
            {images.map((src, i) => (
              <div key={i}
                className={`img-card ${selected === i ? "img-card--selected" : ""}`}
                onClick={() => setSelected(i)}>
                {/* Prefer the rembg'd cutout once it arrives — that's what
                    the mesh pipeline actually consumes. Falls back
                    to the raw render while rembg is still running. */}
                <img src={imageMeta[i]?.rgbaUrl || src} alt={`Generated ${i + 1}`} />

                {/* SVG contour overlay — only on selected image when on */}
                {selected === i && svgOn && svgData && (
                  <div className="img-card__svg-overlay">
                    <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"
                      dangerouslySetInnerHTML={{ __html: svgData }} />
                  </div>
                )}

                {/* SVG analysing indicator */}
                {selected === i && svgAnalyzing && (
                  <div className="img-card__svg-analyzing">
                    <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5, borderTopColor: "#c8960a" }} />
                    Analysing…
                  </div>
                )}

                <div className="img-card__actions">
                  <button className="img-card__action-btn" title="Use as reference"
                    onClick={e => { e.stopPropagation(); setImg2imgSrc(src); setImg2imgOn(true); }}>
                    🖼
                  </button>
                  <button className="img-card__action-btn" title="Download"
                    onClick={e => { e.stopPropagation(); handleDownload(src, i); }}>
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pros__canvas-footer">
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            {workspaceMode === "anvil" ? "Anvil is docked into Prospecting for early ideation and edits" : selected !== null
              ? `Image ${selected + 1} selected — ready to lock`
              : tinkerMode
                ? "Tinker Mode — jump to any pipeline"
                : "Select an image to lock in"}
          </span>

          <div className="pros__footer-actions">
            {/* Tinker Mode jump buttons */}
            {workspaceMode === "results" && tinkerMode && (
              <>
                <button className="pros__jump-btn" onClick={() => onJumpTo("smelting")}
                  title="Jump straight to Smelting">
                  ⚡ → Smelt
                </button>
                <button className="pros__jump-btn" onClick={() => onJumpTo("forge")}
                  title="Jump straight to Forge">
                  ⚡ → Forge
                </button>
                <div className="pros__footer-divider" />
              </>
            )}
            {workspaceMode === "anvil" && (
              <button className="pros__jump-btn" onClick={() => setWorkspaceMode("results")}>
                View Results
              </button>
            )}
            <button className="pros__lock-btn" onClick={handleLock} disabled={workspaceMode !== "results" || selected === null}>
              🔒 Lock In Prospect
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Collapsible ─────────────────────────────────────────────── */
interface CollapsibleProps {
  icon: string; title: string; id: string;
  open: boolean; onToggle: () => void;
  badge?: string;
  selectionLabel?: string | null;  // shown in header when collapsed
  children: React.ReactNode;
}
function Collapsible({ icon, title, open, onToggle, badge, selectionLabel, children }: CollapsibleProps) {
  return (
    <div className={`collapsible ${open ? "collapsible--open" : ""}`}>
      <button className="collapsible__trigger" onClick={onToggle}>
        <span className="collapsible__title">
          <span className="collapsible__icon">{icon}</span>
          {title}
          {badge && <span className="badge badge--yellow" style={{ marginLeft: 6 }}>{badge}</span>}
        </span>

        <span className="collapsible__right">
          {/* Selection label — only visible when collapsed */}
          {!open && selectionLabel && (
            <span className="collapsible__selection">{selectionLabel}</span>
          )}
          <span className="collapsible__chevron">▼</span>
        </span>
      </button>
      {open && <div className="collapsible__body">{children}</div>}
    </div>
  );
}
