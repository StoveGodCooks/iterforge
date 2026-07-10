/**
 * ProspectStage — the Generate workspace (Prospecting).
 *
 * Board + Sketch have been folded into the full-screen Anvil Sketch Board,
 * opened from the top-nav "Anvil" button or the glowing anvil in the output zone.
 */
import { usePipeline } from "../../contexts/PipelineContext";
import Prospecting from "../../tabs/Prospecting/Prospecting";

export default function ProspectStage() {
  const { lockStage, navigateTo } = usePipeline();

  return (
    <Prospecting
      tinkerMode={true}
      onLock={(data) => lockStage("prospect", data)}
      onJumpTo={(stage) => navigateTo(stage as "smelt" | "forge")}
    />
  );
}
