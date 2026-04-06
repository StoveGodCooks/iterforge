import { useMemo, useState } from "react";
import "../../styles/onboarding.css";

type OnboardingFinishMode = "guided" | "tinker" | "projects";

interface Props {
  onClose: () => void;
  onFinish: (mode: OnboardingFinishMode) => void;
}

interface OnboardingStep {
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
}

const STEPS: OnboardingStep[] = [
  {
    eyebrow: "Welcome",
    title: "InterForge turns rough ideas into structured game-ready output.",
    body: "Start wide in Prospecting, tighten structure in Smelting, then finish in Forge. InterForge is built to move from imagination to production without losing the thread.",
    accent: "Pipeline First",
  },
  {
    eyebrow: "Prospecting",
    title: "Prospecting is where you search for the right visual direction.",
    body: "Write the prompt, generate options, and lock one concept only when it feels like the right shape language, mood, and material read for the asset.",
    accent: "Generate and Lock",
  },
  {
    eyebrow: "Smelting",
    title: "Smelting turns a chosen concept into controlled production views.",
    body: "Approve the angles you want to carry forward. This is the disciplined path that prepares cleaner source material for final output.",
    accent: "Structure the Asset",
  },
  {
    eyebrow: "Forge",
    title: "Forge is where deliverables are made.",
    body: "Build the final mesh or sprite output from the approved inputs. Forge will also house Anvil, your visual sandbox for serious brainstorming and composition work.",
    accent: "Ship the Result",
  },
  {
    eyebrow: "Tinker Mode",
    title: "Tinker Mode is the experimental bypass path.",
    body: "Use it when you want to jump stages, push faster iterations, or move from a locked prospect directly into Forge without waiting for the full structured route.",
    accent: "Experiment Fast",
  },
  {
    eyebrow: "Projects",
    title: "Projects are the permanent memory of InterForge.",
    body: "Save notes, links, references, future Anvil boards, generations, and exports so your work survives across sessions instead of disappearing into one-off experiments.",
    accent: "Keep Everything",
  },
];

export default function OnboardingShell({ onClose, onFinish }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const progressLabel = useMemo(() => `${stepIndex + 1} / ${STEPS.length}`, [stepIndex]);

  return (
    <div className="onboarding-shell">
      <div className="onboarding-shell__scrim" onClick={onClose} />
      <div className="onboarding-shell__panel panel panel--forge" role="dialog" aria-modal="true" aria-label="InterForge walkthrough">
        <div className="onboarding-shell__header">
          <div className="onboarding-shell__meta">
            <span className="onboarding-shell__label">Walkthrough</span>
            <span className="onboarding-shell__progress">{progressLabel}</span>
          </div>
          <button className="onboarding-shell__close" onClick={onClose}>Skip</button>
        </div>

        <div className="onboarding-shell__hero">
          <span className="onboarding-shell__eyebrow">{step.eyebrow}</span>
          <h2 className="onboarding-shell__title">{step.title}</h2>
          <p className="onboarding-shell__body">{step.body}</p>
        </div>

        <div className="onboarding-shell__visual panel panel--forge">
          <span className="onboarding-shell__accent-label">{step.accent}</span>
          <div className="onboarding-shell__visual-stage">
            <div className="onboarding-shell__visual-rings" />
            <div className="onboarding-shell__visual-core">
              <span className="onboarding-shell__visual-index">0{stepIndex + 1}</span>
            </div>
          </div>
        </div>

        <div className="onboarding-shell__timeline" aria-label="Walkthrough steps">
          {STEPS.map((item, index) => (
            <button
              key={item.title}
              className={`onboarding-shell__timeline-step ${index === stepIndex ? "onboarding-shell__timeline-step--active" : ""}`}
              onClick={() => setStepIndex(index)}
            >
              <span className="onboarding-shell__timeline-index">0{index + 1}</span>
              <span className="onboarding-shell__timeline-copy">
                <span className="onboarding-shell__timeline-title">{item.eyebrow}</span>
                <span className="onboarding-shell__timeline-body">{item.accent}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="onboarding-shell__footer">
          <div className="onboarding-shell__nav-actions">
            <button
              className="btn btn--secondary"
              onClick={() => setStepIndex(current => Math.max(0, current - 1))}
              disabled={isFirst}
            >
              Back
            </button>
            {!isLast ? (
              <button
                className="btn btn--primary"
                onClick={() => setStepIndex(current => Math.min(STEPS.length - 1, current + 1))}
              >
                Next
              </button>
            ) : (
              <button
                className="btn btn--primary"
                onClick={() => onFinish("guided")}
              >
                Start Guided Workflow
              </button>
            )}
          </div>

          <div className="onboarding-shell__finish-actions">
            <button className="onboarding-shell__finish-btn" onClick={() => onFinish("projects")}>
              Open Projects
            </button>
            <button className="onboarding-shell__finish-btn" onClick={() => onFinish("tinker")}>
              Enter Tinker Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
