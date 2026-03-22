import { useState, useEffect, useCallback } from 'react';

const STEPS = [
  { sel: null, title: '🎮 Welcome to Inter-Forge!', body: "Your AI game asset pipeline. Generate 2D images, edit them, and convert to 3D — all in one place. Let's take a quick tour.", tip: 'bottom-center' },
  { sel: '#tab-single', title: '✦ Single Generator', body: 'Pick an asset type, art style, and genre. Then describe what you want — or let the presets handle it.', tip: 'right' },
  { sel: 'button.bg-brand-600.w-full', title: '⚡ Generate', body: 'Click Generate (or press Ctrl+Enter) to create your first asset. Inter-Forge runs it locally — no cloud needed.', tip: 'right' },
  { sel: '[data-tutorial="preview-area"]', title: '🖼 Preview Area', body: 'Your generated image appears here. Click it to zoom in. Every generation is saved in the history strip on the right.', tip: 'bottom' },
  { sel: '[data-tutorial="edit-image-btn"]', title: '✏ Edit Image', body: 'Paint, draw, and edit your image inline — then feed it back into generation or into MasterForge.', tip: 'top' },
  { sel: '[data-tutorial="apply-mesh-btn"]', title: '⬡ Apply to 3D Mesh', body: 'Wrap your image onto a 3D mesh — plane, cube, cylinder, sphere, torus and more. Blender runs headless in the background.', tip: 'top' },
  { sel: '#tab-settings', title: '⚙ Settings & Diagnostics', body: "Check system status, run diagnostics, and configure paths here. You're all set — go make something great!", tip: 'right' },
];

const PAD = 8;

function getRect(sel) {
  if (!sel) return null;
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x1: r.left   - PAD,
    y1: r.top    - PAD,
    x2: r.right  + PAD,
    y2: r.bottom + PAD,
    w:  r.width  + PAD * 2,
    h:  r.height + PAD * 2,
  };
}

function pct(px, total) {
  return `${((px / total) * 100).toFixed(4)}%`;
}

function buildClipPath(rect, vw, vh) {
  const { x1, y1, x2, y2 } = rect;
  // 8-point polygon cutout
  return [
    `0% 0%`,
    `0% 100%`,
    `${pct(x1, vw)} 100%`,
    `${pct(x1, vw)} ${pct(y1, vh)}`,
    `${pct(x2, vw)} ${pct(y1, vh)}`,
    `${pct(x2, vw)} ${pct(y2, vh)}`,
    `${pct(x1, vw)} ${pct(y2, vh)}`,
    `${pct(x1, vw)} 100%`,
    `100% 100%`,
    `100% 0%`,
  ].join(', ');
}

function TooltipCard({ step, rect, vw, vh, onBack, onNext, onSkip, stepIdx, total }) {
  const isLast = stepIdx === total - 1;

  // Compute position based on tip direction and rect
  let style = {};
  const CARD_W = 288; // w-72
  const OFFSET = 16;

  if (!rect) {
    // Welcome step: centered fixed
    style = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: CARD_W,
      zIndex: 60,
    };
  } else {
    style = { position: 'absolute', width: CARD_W, zIndex: 60 };

    if (step.tip === 'right') {
      style.left = rect.x2 + OFFSET;
      style.top  = rect.y1 + (rect.h / 2) - 60;
    } else if (step.tip === 'left') {
      style.left = rect.x1 - CARD_W - OFFSET;
      style.top  = rect.y1 + (rect.h / 2) - 60;
    } else if (step.tip === 'top') {
      style.left = rect.x1 + (rect.w / 2) - CARD_W / 2;
      style.top  = rect.y1 - OFFSET - 160;
    } else if (step.tip === 'bottom' || step.tip === 'bottom-center') {
      style.left = rect.x1 + (rect.w / 2) - CARD_W / 2;
      style.top  = rect.y2 + OFFSET;
    }

    // Clamp to viewport
    style.left = Math.max(8, Math.min(style.left, vw - CARD_W - 8));
    style.top  = Math.max(8, Math.min(style.top,  vh - 200));
  }

  return (
    <div
      style={style}
      className="bg-surface-800 border border-surface-700 rounded-xl p-5 w-72 shadow-2xl z-50"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-100 leading-snug pr-2">{step.title}</h3>
        <button
          onClick={onSkip}
          className="text-slate-600 hover:text-slate-400 text-xs shrink-0 transition-colors mt-0.5"
          title="Skip tutorial"
        >
          ✕
        </button>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed mb-4">{step.body}</p>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] text-slate-600 font-mono">{stepIdx + 1} / {total}</span>
        <div className="flex gap-1.5">
          {stepIdx > 0 && (
            <button
              onClick={onBack}
              className="px-3 py-1 rounded-lg text-[10px] font-medium border
                bg-surface-700/60 border-surface-600/40 text-slate-400
                hover:text-slate-200 hover:border-surface-500/60 transition-all"
            >
              Back
            </button>
          )}
          <button
            onClick={onNext}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold transition-all
              bg-brand-600 hover:bg-brand-500 text-white"
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>

      {/* Step dots */}
      <div className="flex gap-1 justify-center mt-3">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all ${
              i === stepIdx ? 'w-3 h-1.5 bg-brand-500' : 'w-1.5 h-1.5 bg-surface-600'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default function TutorialOverlay({ onDone }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect,    setRect]    = useState(null);
  const [vw,      setVw]      = useState(window.innerWidth);
  const [vh,      setVh]      = useState(window.innerHeight);

  const step = STEPS[stepIdx];

  const recalc = useCallback(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    setRect(getRect(step.sel));
  }, [step.sel]);

  useEffect(() => {
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [recalc]);

  function goNext() {
    if (stepIdx === STEPS.length - 1) { onDone?.(); return; }
    setStepIdx(i => i + 1);
  }
  function goBack() {
    if (stepIdx === 0) return;
    setStepIdx(i => i - 1);
  }

  const isWelcome = step.sel === null;
  const clipPath  = !isWelcome && rect ? `polygon(${buildClipPath(rect, vw, vh)})` : undefined;

  return (
    <>
      {isWelcome ? (
        /* Welcome step: just a dark full-screen backdrop */
        <div
          className="fixed inset-0 bg-black/70 z-40"
          onClick={e => e.stopPropagation()}
        />
      ) : (
        /* Spotlight overlay */
        <div
          className="fixed inset-0 bg-black/70 z-40 pointer-events-none"
          style={{ clipPath }}
        />
      )}

      <TooltipCard
        step={step}
        rect={isWelcome ? null : rect}
        vw={vw}
        vh={vh}
        onBack={goBack}
        onNext={goNext}
        onSkip={onDone}
        stepIdx={stepIdx}
        total={STEPS.length}
      />
    </>
  );
}
