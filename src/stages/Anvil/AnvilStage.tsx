/**
 * AnvilStage — Full stage wrapper for the Anvil image editor.
 *
 * Layout: toolbar (left) | canvas (center) | sidebar (right)
 * The sidebar has Layers panel (stub) + AI Tools panel (stub) +
 * "Send to" buttons for cross-stage flow.
 */
import { usePipeline } from "../../contexts/PipelineContext";
import AnvilWorkspace from "../../components/Anvil/AnvilWorkspace";
import AnvilLayers from "./AnvilLayers";
import AnvilAITools from "./AnvilAITools";
import "../../styles/anvil-stage.css";

export default function AnvilStage() {
  const { navigateTo } = usePipeline();

  return (
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
          <button
            className="anvil-stage__send-btn anvil-stage__send-btn--secondary"
            onClick={() => navigateTo("prospect")}
          >
            Save to Board
          </button>
        </div>
      </div>
    </div>
  );
}
