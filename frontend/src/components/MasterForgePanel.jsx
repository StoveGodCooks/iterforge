import { useState, useEffect, useRef } from 'react';
import MasterForgeOutputPanel from './MasterForgeOutputPanel.jsx';

/**
 * MasterForgePanel — Container for the final stage of the pipeline.
 * Standardized to use the three-tab flow: FORGE -> SMELTING -> MASTERFORGE.
 */
export default function MasterForgePanel({ 
  sourceImage, 
  smeltedViews, 
  outputChoice, 
  onOutputChoiceChange, 
  onGenerated 
}) {
  const [pipelineOk, setPipelineOk] = useState(null);

  useEffect(() => {
    fetch('/api/masterforge/status')
      .then(r => r.json())
      .then(d => setPipelineOk(d.available))
      .catch(() => setPipelineOk(false));
  }, []);

  if (!sourceImage) return (
    <div className="flex-1 flex items-center justify-center bg-surface-900 text-slate-500">
      Select an asset and complete smelting to proceed.
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      <MasterForgeOutputPanel 
        sourceImage={sourceImage}
        smeltedViews={smeltedViews}
        outputChoice={outputChoice}
        onOutputChoiceChange={onOutputChoiceChange}
        onGenerated={onGenerated}
      />
    </div>
  );
}
