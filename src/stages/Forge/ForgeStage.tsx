/**
 * ForgeStage — Bridges PipelineContext into the Forge tab component.
 */
import { usePipeline } from "../../contexts/PipelineContext";
import Forge from "../../tabs/Forge/Forge";
import type { ProspectingOutput, SmeltingOutput, ForgeOutput } from "../../types/pipeline";

export default function ForgeStage() {
  const { smeltData, prospectData, lockStage } = usePipeline();

  return (
    <Forge
      smeltingData={smeltData.data as SmeltingOutput | null}
      prospectingData={prospectData.data as ProspectingOutput | null}
      onLock={(data: ForgeOutput) => lockStage("forge", data)}
    />
  );
}
