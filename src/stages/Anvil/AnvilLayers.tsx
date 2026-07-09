/**
 * AnvilLayers — Static layers panel (visual stub).
 *
 * Shows a mock layer list matching the mockup design.
 * Not yet wired to the canvas layer model.
 */
export default function AnvilLayers() {
  return (
    <div className="anvil-panel">
      <div className="anvil-panel__title">Layers</div>
      <div className="anvil-layer active">
        <span className="anvil-layer__eye">&#128065;</span>
        <span className="anvil-layer__preview" style={{ background: "var(--bg-raised)" }} />
        Concept
      </div>
      <div className="anvil-layer">
        <span className="anvil-layer__eye">&#128065;</span>
        <span className="anvil-layer__preview" style={{ background: "#2a1f10" }} />
        Paint Over
      </div>
      <div className="anvil-layer">
        <span className="anvil-layer__eye">&#128065;</span>
        <span className="anvil-layer__preview" style={{ background: "var(--bg-surface, #16161a)" }} />
        Sketch
      </div>
    </div>
  );
}
