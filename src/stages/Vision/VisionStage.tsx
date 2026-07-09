/**
 * VisionStage — Mood board + storyboard workspace.
 *
 * Two modes: Board (grid of reference cards) and Sequence (horizontal frame strip).
 */
import { useState } from "react";
import VisionBoard from "./VisionBoard";
import VisionSequence from "./VisionSequence";
import "../../styles/vision.css";

type VisionMode = "board" | "sequence";

export default function VisionStage() {
  const [mode, setMode] = useState<VisionMode>("board");

  return (
    <div style={{ padding: 20 }}>
      <div className="vision-tabs">
        <button
          className={`vision-tab${mode === "board" ? " active" : ""}`}
          onClick={() => setMode("board")}
        >
          Board
        </button>
        <button
          className={`vision-tab${mode === "sequence" ? " active" : ""}`}
          onClick={() => setMode("sequence")}
        >
          Sequence
        </button>
      </div>

      {mode === "board" && <VisionBoard />}
      {mode === "sequence" && <VisionSequence />}
    </div>
  );
}
