import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import "../../styles/anvil.css";

type Tool =
  | "brush"
  | "pen"
  | "eraser"
  | "line"
  | "curve"
  | "rectangle"
  | "filledRectangle"
  | "ellipse"
  | "filledEllipse"
  | "text"
  | "textbox"
  | "sticker";

type ShapeTool = Extract<
  Tool,
  "line" | "curve" | "rectangle" | "filledRectangle" | "ellipse" | "filledEllipse"
>;

type StickerPreset = "arrow" | "star" | "crosshair" | "tag";

interface Props {
  onClose?: () => void;
  embedded?: boolean;
}

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 900;
const SWATCHES = ["#f5f1e6", "#ffca6a", "#d6852b", "#c94f1a", "#7ec8ff", "#69d29f", "#171b26", "#ffffff"];
const SHAPE_TOOLS: ShapeTool[] = ["line", "curve", "rectangle", "filledRectangle", "ellipse", "filledEllipse"];
const STICKER_PRESETS: Array<{ id: StickerPreset; label: string }> = [
  { id: "arrow", label: "Arrow" },
  { id: "star", label: "Star" },
  { id: "crosshair", label: "Target" },
  { id: "tag", label: "Tag" },
];
const TOOL_GROUPS: Array<{ title: string; tools: Tool[] }> = [
  { title: "Sketch", tools: ["brush", "pen", "eraser"] },
  { title: "Lines & Shapes", tools: ["line", "curve", "rectangle", "filledRectangle", "ellipse", "filledEllipse"] },
  { title: "Notes", tools: ["text", "textbox", "sticker"] },
];

export default function AnvilWorkspace({ onClose, embedded = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDrawingRef = useRef(false);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const snapshotBeforeShapeRef = useRef<ImageData | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);

  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#ffca6a");
  const [size, setSize] = useState(10);
  const [textValue, setTextValue] = useState("Callout");
  const [stickerPreset, setStickerPreset] = useState<StickerPreset>("arrow");
  const [status, setStatus] = useState("Ready to block silhouettes, add callouts, or pull in a reference.");
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    historyRef.current = [ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)];
    redoRef.current = [];
    setHistoryTick((version) => version + 1);
  }, []);

  const toolLabels: Record<Tool, string> = {
    brush: "Brush",
    pen: "Pen",
    eraser: "Eraser",
    line: "Line",
    curve: "Curve",
    rectangle: "Rect",
    filledRectangle: "Solid Rect",
    ellipse: "Ellipse",
    filledEllipse: "Solid Ellipse",
    text: "Text",
    textbox: "Text Box",
    sticker: "Sticker",
  };

  const toolCaptions: Record<Tool, string> = {
    brush: "Broad paintover",
    pen: "Tight sketch line",
    eraser: "Trim and clean",
    line: "Hard guide",
    curve: "Sweeping guide",
    rectangle: "Wire block",
    filledRectangle: "Mass block",
    ellipse: "Round guide",
    filledEllipse: "Solid round",
    text: "Single label",
    textbox: "Framed note",
    sticker: "Quick marker",
  };

  const toolGuidance: Record<Tool, string> = {
    brush: "Use the brush for silhouette mass, paintovers, and big directional passes.",
    pen: "Use the pen when the gesture is set and you need a cleaner line read.",
    eraser: "Cut noise, refine edge rhythm, and keep the board readable.",
    line: "Drop clean structural lines for perspective, framing, and axis breaks.",
    curve: "Pull sweeping guides for motion arcs, blade edges, horns, and contour flow.",
    rectangle: "Block hard-surface forms, framing zones, and panel boundaries fast.",
    filledRectangle: "Use solid rectangles to map weight, value grouping, and large planes.",
    ellipse: "Mark sockets, wheels, joints, and rounded guide volumes.",
    filledEllipse: "Use solid ellipses for dense mass reads, lights, and circular callouts.",
    text: "Place a short note exactly where the decision matters.",
    textbox: "Drop a labeled note box when the callout needs more separation from the drawing.",
    sticker: "Stamp quick visual markers without redrawing the same helper shape each time.",
  };

  const canUndo = historyTick >= 0 && historyRef.current.length > 1;
  const canRedo = historyTick >= 0 && redoRef.current.length > 0;
  const actionCount = Math.max(0, historyRef.current.length - 1);

  function isShapeTool(value: Tool): value is ShapeTool {
    return SHAPE_TOOLS.includes(value as ShapeTool);
  }

  function getContext() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function syncHistory() {
    setHistoryTick((version) => version + 1);
  }

  function pushSnapshot() {
    const ctx = getContext();
    if (!ctx) return;

    historyRef.current.push(ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT));
    if (historyRef.current.length > 40) {
      historyRef.current.shift();
    }
    redoRef.current = [];
    syncHistory();
  }

  function restoreSnapshot(snapshot: ImageData | null) {
    const ctx = getContext();
    if (!ctx || !snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
  }

  function getStrokeWidth(activeTool: Tool) {
    if (activeTool === "pen") return Math.max(1, Math.round(size * 0.45));
    if (activeTool === "line" || activeTool === "curve") return Math.max(2, Math.round(size * 0.7));
    return size;
  }

  function applyStrokeStyle(ctx: CanvasRenderingContext2D, activeTool: Tool) {
    ctx.strokeStyle = color;
    ctx.lineWidth = getStrokeWidth(activeTool);
    ctx.globalCompositeOperation = activeTool === "eraser" ? "destination-out" : "source-over";
  }

  function getCurveControl(start: { x: number; y: number }, end: { x: number; y: number }) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const offset = Math.max(32, Math.min(distance * 0.24, 180));
    const normalX = -dy / distance;
    const normalY = dx / distance;

    return {
      x: (start.x + end.x) / 2 + normalX * offset,
      y: (start.y + end.y) / 2 + normalY * offset,
    };
  }

  function drawShape(
    ctx: CanvasRenderingContext2D,
    activeTool: ShapeTool,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    ctx.save();
    ctx.beginPath();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}33`;
    ctx.lineWidth = getStrokeWidth(activeTool);

    if (activeTool === "line") {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (activeTool === "curve") {
      const control = getCurveControl(start, end);
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (activeTool === "rectangle" || activeTool === "filledRectangle") {
      ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y);
    }

    if (activeTool === "ellipse" || activeTool === "filledEllipse") {
      const centerX = (start.x + end.x) / 2;
      const centerY = (start.y + end.y) / 2;
      const radiusX = Math.max(Math.abs(end.x - start.x) / 2, 1);
      const radiusY = Math.max(Math.abs(end.y - start.y) / 2, 1);
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    }

    if (activeTool === "filledRectangle" || activeTool === "filledEllipse") {
      ctx.fill();
    }

    ctx.stroke();
    ctx.restore();
  }

  function drawTextLabel(ctx: CanvasRenderingContext2D, point: { x: number; y: number }, value: string) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.max(16, size * 1.9)}px "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(value, point.x, point.y);
    ctx.restore();
  }

  function drawTextBox(ctx: CanvasRenderingContext2D, point: { x: number; y: number }, value: string) {
    const lines = value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);

    const content = lines.length > 0 ? lines : ["Callout"];
    const fontSize = Math.max(15, Math.round(size * 1.45));
    const lineHeight = Math.round(fontSize * 1.4);
    const width = Math.max(180, Math.min(420, Math.max(...content.map((line) => line.length), 10) * fontSize * 0.72));
    const height = content.length * lineHeight + 28;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(9, 14, 24, 0.88)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(point.x, point.y, width, height, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
    ctx.textBaseline = "top";
    content.forEach((line, index) => {
      ctx.fillText(line, point.x + 16, point.y + 14 + index * lineHeight);
    });
    ctx.restore();
  }

  function drawSticker(ctx: CanvasRenderingContext2D, point: { x: number; y: number }, preset: StickerPreset) {
    const stickerSize = Math.max(28, size * 3.4);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}33`;
    ctx.lineWidth = Math.max(2, Math.round(size * 0.35));

    if (preset === "arrow") {
      ctx.beginPath();
      ctx.moveTo(point.x - stickerSize * 0.7, point.y);
      ctx.lineTo(point.x + stickerSize * 0.4, point.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(point.x + stickerSize * 0.4, point.y);
      ctx.lineTo(point.x + stickerSize * 0.05, point.y - stickerSize * 0.28);
      ctx.lineTo(point.x + stickerSize * 0.05, point.y + stickerSize * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    if (preset === "star") {
      ctx.beginPath();
      for (let index = 0; index < 10; index += 1) {
        const radius = index % 2 === 0 ? stickerSize * 0.55 : stickerSize * 0.24;
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;
        const x = point.x + Math.cos(angle) * radius;
        const y = point.y + Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    if (preset === "crosshair") {
      ctx.beginPath();
      ctx.arc(point.x, point.y, stickerSize * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(point.x - stickerSize * 0.7, point.y);
      ctx.lineTo(point.x + stickerSize * 0.7, point.y);
      ctx.moveTo(point.x, point.y - stickerSize * 0.7);
      ctx.lineTo(point.x, point.y + stickerSize * 0.7);
      ctx.stroke();
    }

    if (preset === "tag") {
      ctx.beginPath();
      ctx.roundRect(point.x - stickerSize * 0.65, point.y - stickerSize * 0.38, stickerSize * 1.15, stickerSize * 0.76, 10);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x - stickerSize * 0.42, point.y, stickerSize * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    ctx.restore();
  }

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const point = getPoint(event);
    if (!canvas || !ctx || !point) return;

    if (tool === "text") {
      const label = textValue.trim();
      if (!label) {
        setStatus("Type a text label before placing it.");
        return;
      }
      drawTextLabel(ctx, point, label);
      pushSnapshot();
      setStatus("Text label placed.");
      return;
    }

    if (tool === "textbox") {
      drawTextBox(ctx, point, textValue.trim());
      pushSnapshot();
      setStatus("Text box placed.");
      return;
    }

    if (tool === "sticker") {
      drawSticker(ctx, point, stickerPreset);
      pushSnapshot();
      setStatus(`${STICKER_PRESETS.find((preset) => preset.id === stickerPreset)?.label ?? "Sticker"} placed.`);
      return;
    }

    isDrawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);

    if (isShapeTool(tool)) {
      shapeStartRef.current = point;
      snapshotBeforeShapeRef.current = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      setStatus(`Blocking a ${toolLabels[tool].toLowerCase()}.`);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    applyStrokeStyle(ctx, tool);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setStatus(tool === "eraser" ? "Erasing." : `Drawing with ${toolLabels[tool].toLowerCase()}.`);
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;

    const ctx = getContext();
    const point = getPoint(event);
    if (!ctx || !point) return;

    if (isShapeTool(tool)) {
      const start = shapeStartRef.current;
      if (!start) return;
      restoreSnapshot(snapshotBeforeShapeRef.current);
      drawShape(ctx, tool, start, point);
      return;
    }

    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;

    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const point = getPoint(event);
    if (!canvas || !ctx) return;

    if (isShapeTool(tool)) {
      const start = shapeStartRef.current;
      restoreSnapshot(snapshotBeforeShapeRef.current);
      if (start && point) {
        drawShape(ctx, tool, start, point);
        pushSnapshot();
        setStatus(`${toolLabels[tool]} saved to the board.`);
      }
      shapeStartRef.current = null;
      snapshotBeforeShapeRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }

    ctx.closePath();
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pushSnapshot();
    setStatus("Stroke saved to the board.");
  }

  function undo() {
    const ctx = getContext();
    if (!ctx || historyRef.current.length <= 1) return;

    const current = historyRef.current.pop();
    if (current) {
      redoRef.current.push(current);
    }
    const previous = historyRef.current[historyRef.current.length - 1];
    ctx.putImageData(previous, 0, 0);
    syncHistory();
    setStatus("Undid the last action.");
  }

  function redo() {
    const ctx = getContext();
    if (!ctx || redoRef.current.length === 0) return;

    const snapshot = redoRef.current.pop() ?? null;
    if (!snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    historyRef.current.push(snapshot);
    syncHistory();
    setStatus("Restored the last undone action.");
  }

  function clearBoard() {
    const ctx = getContext();
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    pushSnapshot();
    setStatus("Board cleared.");
  }

  function openImportDialog() {
    fileInputRef.current?.click();
  }

  function handleImportReference(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return;

      const image = new Image();
      image.onload = () => {
        const ctx = getContext();
        if (!ctx) return;

        const margin = 80;
        const scale = Math.min(
          (CANVAS_WIDTH - margin * 2) / image.width,
          (CANVAS_HEIGHT - margin * 2) / image.height,
          1,
        );
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const x = (CANVAS_WIDTH - drawWidth) / 2;
        const y = (CANVAS_HEIGHT - drawHeight) / 2;

        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(image, x, y, drawWidth, drawHeight);
        ctx.restore();
        pushSnapshot();
        setStatus(`Imported reference: ${file.name}`);
      };
      image.src = result;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  async function exportPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const targetPath = await save({
      title: "Export Anvil Board",
      defaultPath: "anvil-board.png",
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    });

    if (!targetPath) return;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      setStatus("Export failed.");
      return;
    }

    await writeFile(targetPath, new Uint8Array(await blob.arrayBuffer()));
    setStatus("Board exported as PNG.");
  }

  return (
    <div className={`anvil-shell ${embedded ? "anvil-shell--embedded" : ""}`}>
      {!embedded && <div className="anvil-shell__scrim" onClick={onClose} />}
      <div className="anvil-shell__panel">
        <div className="anvil-shell__header">
          <div className="anvil-shell__header-copy">
            <span className="anvil-shell__eyebrow">{embedded ? "Prospecting Visual Helper" : "Forge Drafting Helper"}</span>
            <h2 className="anvil-shell__title">Anvil</h2>
            <p className="anvil-shell__subtitle">
              A cleaner drafting pad for silhouettes, notes, layout guides, and fast visual decisions before generation.
            </p>
          </div>

          <div className="anvil-shell__header-meta">
            <div className="anvil-shell__meta-chip">
              <span className="anvil-shell__meta-label">Active Tool</span>
              <strong>{toolLabels[tool]}</strong>
            </div>
            <div className="anvil-shell__meta-chip">
              <span className="anvil-shell__meta-label">Board Actions</span>
              <strong>{actionCount}</strong>
            </div>
            <div className="anvil-shell__meta-chip">
              <span className="anvil-shell__meta-label">Canvas Fit</span>
              <strong>Auto</strong>
            </div>
          </div>

          <div className="anvil-shell__header-actions">
            <button className="anvil-shell__action" onClick={undo} disabled={!canUndo}>Undo</button>
            <button className="anvil-shell__action" onClick={redo} disabled={!canRedo}>Redo</button>
            <button className="anvil-shell__action" onClick={openImportDialog}>Import Ref</button>
            <button className="anvil-shell__action" onClick={clearBoard}>Clear</button>
            <button className="anvil-shell__action anvil-shell__action--primary" onClick={exportPng}>Export PNG</button>
            {onClose && (
              <button className="anvil-shell__close" onClick={onClose}>{embedded ? "Back" : "Close"}</button>
            )}
          </div>
        </div>

        <div className="anvil-shell__workspace">
          <aside className="anvil-shell__tools panel panel--forge">
            <div className="anvil-shell__section">
              <span className="anvil-shell__label">Helper Read</span>
              <p className="anvil-shell__helper-copy">{toolGuidance[tool]}</p>
            </div>

            {TOOL_GROUPS.map((group) => (
              <div className="anvil-shell__section" key={group.title}>
                <span className="anvil-shell__label">{group.title}</span>
                <div className="anvil-shell__tool-grid">
                  {group.tools.map((groupTool) => (
                    <button
                      key={groupTool}
                      className={`anvil-shell__tool-btn ${tool === groupTool ? "anvil-shell__tool-btn--active" : ""}`}
                      onClick={() => setTool(groupTool)}
                    >
                      <strong>{toolLabels[groupTool]}</strong>
                      <span>{toolCaptions[groupTool]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="anvil-shell__section">
              <span className="anvil-shell__label">{tool === "pen" ? "Pen Weight" : "Brush Size"}</span>
              <div className="anvil-shell__slider-row">
                <input
                  className="anvil-shell__slider"
                  type="range"
                  min={2}
                  max={48}
                  step={1}
                  value={size}
                  onChange={(event) => setSize(Number(event.target.value))}
                />
                <span className="anvil-shell__value">{size}px</span>
              </div>
            </div>

            <div className="anvil-shell__section">
              <span className="anvil-shell__label">Palette</span>
              <div className="anvil-shell__swatches">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    className={`anvil-shell__swatch ${color === swatch ? "anvil-shell__swatch--active" : ""}`}
                    style={{ background: swatch }}
                    onClick={() => setColor(swatch)}
                    title={swatch}
                  />
                ))}
              </div>
            </div>

            <div className="anvil-shell__section">
              <span className="anvil-shell__label">{tool === "sticker" ? "Sticker Preset" : "Text / Box Copy"}</span>
              {tool === "sticker" ? (
                <div className="anvil-shell__chip-row">
                  {STICKER_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={`anvil-shell__chip ${stickerPreset === preset.id ? "anvil-shell__chip--active" : ""}`}
                      onClick={() => setStickerPreset(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  className="anvil-shell__text-input anvil-shell__text-input--multi"
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value)}
                  placeholder="Add callout text"
                  rows={3}
                />
              )}
            </div>

            <div className="anvil-shell__section">
              <span className="anvil-shell__label">Board State</span>
              <div className="anvil-shell__status-card">
                <p className="anvil-shell__status">{status}</p>
                <p className="anvil-shell__status anvil-shell__status--meta">
                  History: {actionCount} action{actionCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </aside>

          <div className="anvil-shell__canvas-wrap panel panel--forge">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImportReference}
              style={{ display: "none" }}
            />

            <div className="anvil-shell__canvas-toolbar">
              <div>
                <span className="anvil-shell__canvas-label">Draft Surface</span>
                <p className="anvil-shell__canvas-copy">
                  The frame scales to the available space so the board stays visible instead of spilling off-screen.
                </p>
              </div>
              <div className="anvil-shell__canvas-badges">
                <span className="anvil-shell__canvas-badge">Resolution Safe</span>
                <span className="anvil-shell__canvas-badge">Callout Ready</span>
                <span className="anvil-shell__canvas-badge">Exportable</span>
              </div>
            </div>

            <div className="anvil-shell__canvas-stage">
              <div className="anvil-shell__canvas-frame">
                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="anvil-shell__canvas"
                  onPointerDown={beginStroke}
                  onPointerMove={continueStroke}
                  onPointerUp={endStroke}
                  onPointerLeave={endStroke}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
