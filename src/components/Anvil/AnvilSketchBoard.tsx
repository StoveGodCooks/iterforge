/**
 * AnvilSketchBoard — the full-screen Anvil: a comic-style storyboard
 * (title + story + panels) fused with the sketch canvas. Opened from the
 * glowing anvil button / top-nav via AnvilBoardContext.
 *
 * Each panel holds an image or a sketch + a caption. Sketch a panel (opens the
 * AnvilWorkspace seeded with its current image), import an image, reorder, or
 * send a panel to Prospect as an img2img reference.
 */
import { useState } from "react";
import { writeFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { useAnvilBoard } from "../../contexts/AnvilBoardContext";
import { usePipeline } from "../../contexts/PipelineContext";
import AnvilWorkspace from "./AnvilWorkspace";
import "../../styles/anvil-board.css";

function bytesToDataUrl(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: "image/png" }));
  });
}

export default function AnvilSketchBoard() {
  const anvil = useAnvilBoard();
  const { navigateTo } = usePipeline();
  const [sketchingId, setSketchingId] = useState<string | null>(null);

  if (!anvil.isOpen) return null;
  const { board } = anvil;

  /* Import an image into a panel (HTML file input — works in browser + Tauri). */
  function importInto(panelId: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => anvil.updatePanel(panelId, { imageSrc: reader.result as string, imagePath: null });
      reader.readAsDataURL(file);
    };
    input.click();
  }

  /* Save a sketched panel: data URL for display everywhere; best-effort disk
     write (Tauri only) for a real path the backend can use as an img2img ref. */
  async function saveSketch(panelId: string, bytes: Uint8Array) {
    const dataUrl = await bytesToDataUrl(bytes);
    let imagePath: string | null = null;
    try {
      await mkdir("interforge-projects/_anvil", { baseDir: BaseDirectory.AppData, recursive: true });
      const rel = `interforge-projects/_anvil/${panelId}.png`;
      await writeFile(rel, bytes, { baseDir: BaseDirectory.AppData });
      imagePath = await join(await appDataDir(), rel);
    } catch {
      /* not running under Tauri (browser dev) — no real path, ref stays disabled */
    }
    anvil.updatePanel(panelId, { imageSrc: dataUrl, imagePath });
    setSketchingId(null);
  }

  /* Send a panel to Prospect as the img2img reference. */
  function useAsRef(panelId: string) {
    const panel = board.panels.find((p) => p.id === panelId);
    if (!panel?.imagePath) return;
    anvil.sendToReference(panel.imagePath);
    anvil.close();
    navigateTo("prospect");
  }

  const sketching = sketchingId ? board.panels.find((p) => p.id === sketchingId) : null;

  return (
    <div className="anvil-board">
      <div className="anvil-board__header" data-tauri-drag-region>
        <span className="anvil-board__brand">🛠 Anvil Sketch Board</span>
        <input
          className="anvil-board__title"
          placeholder="Untitled story…"
          value={board.title}
          onChange={(e) => anvil.setTitle(e.target.value)}
        />
        <div className="anvil-board__spacer" />
        <button className="anvil-board__close" onClick={anvil.close} title="Close (Esc)">✕</button>
      </div>

      <div className="anvil-board__body">
        <textarea
          className="anvil-board__story"
          placeholder="Write your story here — the full script, beats, dialogue…"
          value={board.story}
          onChange={(e) => anvil.setStory(e.target.value)}
        />

        <div className="anvil-board__panels-label">Panels</div>
        <div className="anvil-board__grid">
          {board.panels.map((p, i) => (
            <div key={p.id} className="anvil-cpanel">
              <div className="anvil-cpanel__num">{i + 1}</div>
              <div className="anvil-cpanel__img">
                {p.imageSrc
                  ? <img src={p.imageSrc} alt={`panel ${i + 1}`} />
                  : <div className="anvil-cpanel__empty">empty panel</div>}
                <div className="anvil-cpanel__tools">
                  <button onClick={() => setSketchingId(p.id)} title="Sketch this panel">✏</button>
                  <button onClick={() => importInto(p.id)} title="Import image">⬆</button>
                  <button onClick={() => useAsRef(p.id)} disabled={!p.imagePath} title={p.imagePath ? "Use as generation reference" : "Sketch this panel to enable"}>⚡</button>
                  <button onClick={() => anvil.reorder(p.id, -1)} disabled={i === 0} title="Move earlier">←</button>
                  <button onClick={() => anvil.reorder(p.id, +1)} disabled={i === board.panels.length - 1} title="Move later">→</button>
                  <button onClick={() => anvil.removePanel(p.id)} title="Delete panel">🗑</button>
                </div>
              </div>
              <input
                className="anvil-cpanel__caption"
                placeholder="caption / dialogue…"
                value={p.caption}
                onChange={(e) => anvil.updatePanel(p.id, { caption: e.target.value })}
              />
            </div>
          ))}
          <button className="anvil-cpanel anvil-cpanel--add" onClick={() => anvil.addPanel()}>
            <span className="anvil-cpanel--add__plus">＋</span>
            <span>Add panel</span>
          </button>
        </div>
      </div>

      {/* Sketch sub-overlay — the full drawing canvas, seeded with the panel image */}
      {sketching && (
        <div className="anvil-board__sketch">
          <AnvilWorkspace
            embedded
            seedImage={sketching.imageSrc}
            onSave={(bytes) => saveSketch(sketching.id, bytes)}
            onClose={() => setSketchingId(null)}
          />
        </div>
      )}
    </div>
  );
}
