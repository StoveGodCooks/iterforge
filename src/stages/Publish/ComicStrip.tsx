/**
 * ComicStrip — Panel layout with speech bubbles.
 *
 * Interactive stub — panels accept images from Asset Tray in the future.
 */
export default function ComicStrip() {
  return (
    <div className="comic-layout">
      <div className="comic-panel">
        <div className="comic-panel__empty ph ph--amber" style={{ width: "100%", height: "100%" }}>
          WIDE ESTABLISHING
        </div>
        <div className="comic-bubble" style={{ top: 16, right: 24 }}>
          The swamp remembers...
        </div>
      </div>
      <div className="comic-panel">
        <div className="comic-panel__empty ph ph--ember" style={{ width: "100%", height: "100%" }}>
          CLOSE-UP
        </div>
        <div className="comic-bubble" style={{ bottom: 24, left: 16 }}>
          Today we fight.
        </div>
      </div>
      <div className="comic-panel">
        <div className="comic-panel__empty ph ph--teal" style={{ width: "100%", height: "100%" }}>
          ACTION
        </div>
      </div>
    </div>
  );
}
