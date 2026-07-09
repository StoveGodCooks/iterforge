/**
 * VisionSequence — Horizontal scrolling storyboard frame strip.
 */
import { useState } from "react";

interface Frame {
  id: string;
  imageSrc: string | null;
  caption: string;
}

let nextId = 1;

export default function VisionSequence() {
  const [frames, setFrames] = useState<Frame[]>([
    { id: `f-${nextId++}`, imageSrc: null, caption: "Orc stands at the edge of the swamp, smoke rising behind him. Establishing shot." },
    { id: `f-${nextId++}`, imageSrc: null, caption: "Close on face — scarred, yellow eyes, tusk cracked. Determination." },
    { id: `f-${nextId++}`, imageSrc: null, caption: "Raises axe overhead. Camera low angle. Armor catches firelight." },
    { id: `f-${nextId++}`, imageSrc: null, caption: "Impact — axe meets shield. Sparks. Dust cloud." },
    { id: `f-${nextId++}`, imageSrc: null, caption: "Victory roar. Silhouette against burning village." },
  ]);

  function addFrame() {
    setFrames((prev) => [
      ...prev,
      { id: `f-${nextId++}`, imageSrc: null, caption: "" },
    ]);
  }

  function updateCaption(id: string, caption: string) {
    setFrames((prev) =>
      prev.map((f) => (f.id === id ? { ...f, caption } : f)),
    );
  }

  return (
    <div className="sequence">
      {frames.map((frame, i) => (
        <div key={frame.id} className="frame">
          <div className="frame__num">
            FRAME {i + 1}
            <span>&#9654; Generate</span>
          </div>
          {frame.imageSrc ? (
            <img className="frame__img" src={frame.imageSrc} alt={`Frame ${i + 1}`} />
          ) : (
            <div className="frame__empty">Drop image or generate</div>
          )}
          <div className="frame__caption">
            <textarea
              className="frame__caption-input"
              value={frame.caption}
              onChange={(e) => updateCaption(frame.id, e.target.value)}
              placeholder="Describe this frame..."
              rows={3}
            />
          </div>
        </div>
      ))}
      <div className="frame frame--add" onClick={addFrame}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", color: "var(--text-muted)", fontSize: 13, fontWeight: 600,
          cursor: "pointer",
        }}>
          + Add Frame
        </div>
      </div>
    </div>
  );
}
