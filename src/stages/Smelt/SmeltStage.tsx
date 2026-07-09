/**
 * SmeltStage — Wrapper bridging PipelineContext to the Smelting component.
 */
import { usePipeline } from "../../contexts/PipelineContext";
import Smelting from "../../tabs/Smelting/Smelting";

export default function SmeltStage() {
  const { prospectData, lockStage } = usePipeline();

  return (
    <Smelting
      prospectingData={prospectData.data}
      onLock={(data) => lockStage("smelt", data)}
    />
  );
}
