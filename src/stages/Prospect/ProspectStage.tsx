/**
 * ProspectStage — Unified workspace: Generate, Board, Sequence, Sketch.
 *
 * Combines concept generation (Prospecting), mood board (VisionBoard),
 * storyboard (VisionSequence), and drawing pad (AnvilWorkspace) into
 * one stage with sub-tabs.
 */
import { useState } from "react";
import { usePipeline } from "../../contexts/PipelineContext";
import Prospecting from "../../tabs/Prospecting/Prospecting";
import VisionBoard from "../Vision/VisionBoard";
import VisionSequence from "../Vision/VisionSequence";
import AnvilWorkspace from "../../components/Anvil/AnvilWorkspace";
import AnvilLayers from "../Anvil/AnvilLayers";
import AnvilAITools from "../Anvil/AnvilAITools";
import "../../styles/vision.css";
import "../../styles/anvil-stage.css";

type ProspectMode = "generate" | "board" | "sequence" | "sketch";

const TABS: { id: ProspectMode; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "board",    label: "Board" },
  { id: "sequence", label: "Sequence" },
  { id: "sketch",   label: "Sketch" },
];

export default function ProspectStage() {
  const { lockStage, navigateTo } = usePipeline();
  const [mode, setMode] = useState<ProspectMode>("generate");

  return (
    <div className="prospect-stage">
      {/* Sub-tab bar */}
      <div className="prospect-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`prospect-tab${mode === tab.id ? " active" : ""}`}
            onClick={() => setMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="prospect-content">
        {mode === "generate" && (
          <Prospecting
            tinkerMode={true}
            onLock={(data) => lockStage("prospect", data)}
            onJumpTo={(stage) => navigateTo(stage as "smelt" | "forge")}
          />
        )}

        {mode === "board" && (
          <div style={{ padding: 20 }}>
            <VisionBoard />
          </div>
        )}

        {mode === "sequence" && (
          <div style={{ padding: 20 }}>
            <VisionSequence />
          </div>
        )}

        {mode === "sketch" && (
          <div className="anvil-stage">
            <div className="anvil-stage__canvas">
              <AnvilWorkspace embedded />
            </div>
            <div className="anvil-stage__sidebar">
              <AnvilLayers />
              <AnvilAITools />
              <div className="anvil-stage__actions">
                <button
                  className="anvil-stage__send-btn"
                  onClick={() => navigateTo("smelt")}
                >
                  Send to Smelt
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
