/**
 * AnvilAITools — AI tools panel (stub).
 *
 * Shows Inpaint, Outpaint, Upscale buttons.
 * All are stubs — no backend wiring yet.
 */
import { useState } from "react";

export default function AnvilAITools() {
  const [prompt, setPrompt] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  return (
    <div className="anvil-panel">
      <div className="anvil-panel__title">AI Tools</div>
      <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
        Select a region, then describe the change
      </p>
      <div className="anvil-ai-bar">
        <input
          type="text"
          placeholder="Describe the edit..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button onClick={() => showToast("Inpaint — coming soon")}>
          Inpaint
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          className="anvil-ai-btn"
          onClick={() => showToast("Outpaint — coming soon")}
        >
          Outpaint
        </button>
        <button
          className="anvil-ai-btn"
          onClick={() => showToast("Upscale — coming soon")}
        >
          Upscale
        </button>
      </div>
      {toast && (
        <div style={{
          marginTop: 8, fontSize: 10, color: "var(--yellow-core)",
          fontWeight: 600, textAlign: "center",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
