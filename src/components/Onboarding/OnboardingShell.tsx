import { useState } from "react";
import "../../styles/onboarding.css";

type OnboardingFinishMode = "guided" | "tinker" | "projects";

interface Props {
  onClose: () => void;
  onFinish: (mode: OnboardingFinishMode) => void;
  onNavigate?: (route: string) => void;
}

const STEPS: Array<{
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  route: string | null;
}> = [
  {
    eyebrow: "Welcome",
    title: "InterForge turns rough ideas into game-ready output.",
    body: "A unified pipeline from imagination to production. Move through Prospect, Smelt, and Forge — every stage feeds the next. Hit Next to walk through each one.",
    accent: "Pipeline First",
    route: null,
  },
  {
    eyebrow: "Prospect",
    title: "References, generation, and sketching — one workspace.",
    body: "Write prompts, generate candidates, sketch silhouettes in Anvil, and build a mood board. Lock your direction when the shape language and material feel right.",
    accent: "Explore and Lock",
    route: "prospect",
  },
  {
    eyebrow: "Smelt",
    title: "Turn one concept into controlled production views.",
    body: "Zero123++ generates 6 angles from your locked image. Approve the views you want to carry forward. This is the step that prepares clean, consistent 3D source material.",
    accent: "Structure the Asset",
    route: "smelt",
  },
  {
    eyebrow: "Forge",
    title: "Build the mesh. Export or publish from right here.",
    body: "Choose the Mesh pipeline (GLB / OBJ) or Sprite pipeline. When generation is done the result appears in the viewer — hit Export to save the file, or Publish to export a sprite atlas.",
    accent: "Build and Ship",
    route: "forge",
  },
  {
    eyebrow: "Projects",
    title: "Projects are the permanent memory of InterForge.",
    body: "Every generation, smelt run, and exported mesh is tied to a project on disk. Open the projects browser to manage your work across sessions.",
    accent: "Keep Everything",
    route: "projects",
  },
];

export default function OnboardingShell({ onClose, onFinish, onNavigate }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  function goNext() {
    const nextIdx = Math.min(STEPS.length - 1, stepIndex + 1);
    const nextStep = STEPS[nextIdx];
    setStepIndex(nextIdx);
    if (nextStep.route && onNavigate) {
      onNavigate(nextStep.route);
      onClose();
    }
  }
  function goBack() { setStepIndex((i) => Math.max(0, i - 1)); }

  return (
    <div className="ob-shell">
      <div className="ob-scrim" onClick={onClose} />

      <div className="ob-panel" role="dialog" aria-modal="true" aria-label="InterForge walkthrough">

        {/* Progress bar — sits flush at the top, fills with amber as you advance */}
        <div className="ob-progress" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemax={STEPS.length}>
          <div className="ob-progress__fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Header */}
        <div className="ob-header">
          <span className="ob-header__label">Walkthrough</span>
          <button className="ob-header__skip" onClick={onClose}>Skip</button>
        </div>

        {/* Main content — left: visual, right: text */}
        <div className="ob-content" key={stepIndex}>
          <div className={`ob-visual ob-visual--s${stepIndex}`}>
            <StepVisual stepIndex={stepIndex} />
            <span className="ob-visual__caption">{step.accent}</span>
          </div>
          <div className="ob-text">
            <span className="ob-eyebrow">{step.eyebrow}</span>
            <h2 className="ob-title">{step.title}</h2>
            <p className="ob-body">{step.body}</p>
          </div>
        </div>

        {/* Chapter chips — compact, single scrollable row */}
        <nav className="ob-chapters" aria-label="Walkthrough chapters">
          {STEPS.map((s, i) => (
            <button
              key={s.eyebrow}
              className={[
                "ob-chip",
                i === stepIndex ? "ob-chip--active" : "",
                i < stepIndex ? "ob-chip--done" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setStepIndex(i)}
              aria-current={i === stepIndex ? "step" : undefined}
            >
              <span className="ob-chip__num">0{i + 1}</span>
              <span className="ob-chip__name">{s.eyebrow}</span>
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="ob-footer">
          <div className="ob-footer__nav">
            <button className="btn btn--secondary" onClick={goBack} disabled={isFirst}>
              Back
            </button>
            {!isLast ? (
              <button className="btn btn--primary" onClick={goNext}>Next</button>
            ) : (
              <button className="btn btn--primary" onClick={() => onFinish("guided")}>
                Start Guided
              </button>
            )}
          </div>
          <div className="ob-footer__actions">
            <button className="ob-action-btn" onClick={() => onFinish("projects")}>
              Open Projects
            </button>
            <button className="ob-action-btn" onClick={() => onFinish("guided")}>
              Start Creating
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Step visuals ────────────────────────────────────────────── */

function StepVisual({ stepIndex }: { stepIndex: number }) {
  switch (stepIndex) {
    case 0: return <VisualPipeline />;
    case 1: return <VisualProspecting />;
    case 2: return <VisualSmelting />;
    case 3: return <VisualForge />;
    case 4: return <VisualProjects />;
    default: return null;
  }
}

/* Step 0 — Welcome: animated three-node pipeline rail */
function VisualPipeline() {
  return (
    <div className="ob-pipeline">
      <div className="ob-pipeline__step">
        <div className="ob-pipeline__node ob-pipeline__node--a" />
        <span className="ob-pipeline__label">Prospect</span>
      </div>

      <div className="ob-pipeline__track">
        <div className="ob-pipeline__traveler" />
      </div>

      <div className="ob-pipeline__step">
        <div className="ob-pipeline__node ob-pipeline__node--b" />
        <span className="ob-pipeline__label">Smelt</span>
      </div>

      <div className="ob-pipeline__track">
        <div className="ob-pipeline__traveler ob-pipeline__traveler--2" />
      </div>

      <div className="ob-pipeline__step">
        <div className="ob-pipeline__node ob-pipeline__node--c" />
        <span className="ob-pipeline__label">Forge</span>
      </div>
    </div>
  );
}

/* Step 1 — Prospecting: prompt card → shimmer image */
function VisualProspecting() {
  return (
    <div className="ob-prospect">
      <div className="ob-prospect__card">
        <div className="ob-prospect__line" />
        <div className="ob-prospect__line ob-prospect__line--med" />
        <div className="ob-prospect__line ob-prospect__line--short" />
        <div className="ob-prospect__cursor" />
      </div>
      <span className="ob-viz-arrow">→</span>
      <div className="ob-prospect__output">
        <div className="ob-prospect__shimmer" />
        <div className="ob-prospect__output-label">Generating…</div>
      </div>
    </div>
  );
}

/* Step 2 — Smelting: source image fans into 2×2 multiview */
function VisualSmelting() {
  const labels = ["Front", "¾ Left", "Side", "Back"];
  return (
    <div className="ob-smelt">
      <div className="ob-smelt__source">
        <span className="ob-smelt__source-label">Concept</span>
      </div>
      <span className="ob-viz-arrow">→</span>
      <div className="ob-smelt__grid">
        {labels.map((label, i) => (
          <div key={label} className={`ob-smelt__view ob-smelt__view--${i + 1}`}>
            <span className="ob-smelt__view-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Step 3 — Forge: 2×2 inputs → mesh diamond */
function VisualForge() {
  return (
    <div className="ob-forge">
      <div className="ob-forge__inputs">
        {["F", "¾", "S", "B"].map((label) => (
          <div key={label} className="ob-forge__input">
            <span>{label}</span>
          </div>
        ))}
      </div>
      <span className="ob-viz-arrow">→</span>
      <div className="ob-forge__mesh-wrap">
        <svg
          className="ob-forge__mesh"
          viewBox="0 0 96 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Outer diamond */}
          <polygon
            points="48,6 84,48 48,90 12,48"
            stroke="rgba(200,80,30,0.7)"
            strokeWidth="1.5"
            fill="rgba(200,80,30,0.06)"
          />
          {/* Inner subdivision lines */}
          <line x1="48" y1="6"  x2="48" y2="90" stroke="rgba(200,80,30,0.22)" strokeWidth="1" />
          <line x1="12" y1="48" x2="84" y2="48" stroke="rgba(200,80,30,0.22)" strokeWidth="1" />
          <line x1="48" y1="6"  x2="84" y2="48" stroke="rgba(200,80,30,0.12)" strokeWidth="1" />
          <line x1="84" y1="48" x2="48" y2="90" stroke="rgba(200,80,30,0.12)" strokeWidth="1" />
          <line x1="48" y1="90" x2="12" y2="48" stroke="rgba(200,80,30,0.12)" strokeWidth="1" />
          <line x1="12" y1="48" x2="48" y2="6"  stroke="rgba(200,80,30,0.12)" strokeWidth="1" />
          {/* Vertices */}
          <circle cx="48" cy="6"  r="3" fill="rgba(200,80,30,0.8)" />
          <circle cx="84" cy="48" r="3" fill="rgba(200,80,30,0.8)" />
          <circle cx="48" cy="90" r="3" fill="rgba(200,80,30,0.8)" />
          <circle cx="12" cy="48" r="3" fill="rgba(200,80,30,0.8)" />
          <circle cx="48" cy="48" r="2" fill="rgba(200,80,30,0.5)" />
        </svg>
      </div>
    </div>
  );
}

/* Step 5 — Projects: stacked content vault */
function VisualProjects() {
  const items = [
    { symbol: "✎", label: "Art Direction Note" },
    { symbol: "▣", label: "Reference Image" },
    { symbol: "⌁", label: "Research Link" },
    { symbol: "◈", label: "Generation Record" },
  ];
  return (
    <div className="ob-vault">
      <div className="ob-vault__header">
        <span className="ob-vault__title">Creative Vault</span>
      </div>
      {items.map((item, i) => (
        <div key={item.label} className={`ob-vault__row ob-vault__row--${i + 1}`}>
          <span className="ob-vault__symbol">{item.symbol}</span>
          <span className="ob-vault__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
