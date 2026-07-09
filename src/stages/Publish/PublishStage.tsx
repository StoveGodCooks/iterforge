/**
 * PublishStage — Output workspace with 4 sub-modes.
 *
 * Comic Strip, Sprite Sheet, Tiles, Export Hub.
 */
import { useState } from "react";
import ComicStrip from "./ComicStrip";
import SpriteSheet from "./SpriteSheet";
import TilesPreview from "./TilesPreview";
import ExportHub from "./ExportHub";
import "../../styles/publish.css";

type PublishMode = "comic" | "sprite" | "tiles" | "export";

const MODES: { id: PublishMode; label: string }[] = [
  { id: "comic",  label: "Comic Strip" },
  { id: "sprite", label: "Sprite Sheet" },
  { id: "tiles",  label: "Tiles" },
  { id: "export", label: "Export Hub" },
];

export default function PublishStage() {
  const [mode, setMode] = useState<PublishMode>("comic");

  return (
    <div style={{ padding: 20 }}>
      <div className="publish-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`publish-mode${mode === m.id ? " active" : ""}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "comic"  && <ComicStrip />}
      {mode === "sprite" && <SpriteSheet />}
      {mode === "tiles"  && <TilesPreview />}
      {mode === "export" && <ExportHub />}
    </div>
  );
}
