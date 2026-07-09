/**
 * VisionBoard — Grid of reference cards for mood board.
 *
 * Cards can be added, pinned, tagged, and removed.
 * Pinned cards auto-feed into Prospect as style references.
 */
import { useState } from "react";
import type { VisionCard } from "../../types/pipeline";
import { usePipeline } from "../../contexts/PipelineContext";
import { useContextMenu } from "../../shell/ContextMenu";
import type { ContextMenuEntry } from "../../shell/ContextMenu";

let nextId = 1;

function createCard(partial: Partial<VisionCard> = {}): VisionCard {
  return {
    id: `vc-${nextId++}`,
    imageSrc: null,
    label: partial.label ?? "New reference",
    note: partial.note ?? "",
    tags: partial.tags ?? [],
    pinned: partial.pinned ?? false,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

export default function VisionBoard() {
  const { navigateTo } = usePipeline();
  const ctxMenu = useContextMenu();
  const [cards, setCards] = useState<VisionCard[]>([
    createCard({ label: "Orc warrior reference", note: "Green skin, heavy plate armor, battle-scarred", tags: ["character", "style ref"], pinned: true }),
    createCard({ label: "Color palette", note: "Forest green, rust brown, bone white accents", tags: ["palette"] }),
    createCard({ label: "Shoulderpad spikes", note: "Bone spikes through rusted iron — key silhouette feature", tags: ["detail", "armor"] }),
    createCard({ label: "Idle stance reference", note: "Wide stance, weapon lowered — used for T-pose base", tags: ["pose"], pinned: true }),
    createCard({ label: "Swamp battlefield", note: "Murky lighting, fog, broken siege equipment", tags: ["environment"] }),
  ]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editNote, setEditNote] = useState("");

  function addCard() {
    setCards((prev) => [...prev, createCard()]);
  }

  function togglePin(id: string) {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
    );
  }

  function removeCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  function handleCardContext(e: React.MouseEvent, card: VisionCard) {
    const items: ContextMenuEntry[] = [
      { label: "Edit in Sketch", icon: "🖌", action: () => navigateTo("prospect") },
      { label: "Send to Prospect", icon: "🔷", hint: "as ref", action: () => navigateTo("prospect") },
      { separator: true },
      { label: card.pinned ? "Unpin" : "Pin as style ref", icon: "⭐", action: () => togglePin(card.id) },
      { label: "Delete", icon: "🗑", action: () => removeCard(card.id) },
    ];
    ctxMenu.show(e, items);
  }

  function startEdit(card: VisionCard) {
    setEditingId(card.id);
    setEditLabel(card.label);
    setEditNote(card.note);
  }

  function saveEdit() {
    if (!editingId) return;
    setCards((prev) =>
      prev.map((c) =>
        c.id === editingId ? { ...c, label: editLabel, note: editNote } : c,
      ),
    );
    setEditingId(null);
  }

  return (
    <div className="board">
      {cards.map((card) => (
        <div key={card.id} className="board__card" onDoubleClick={() => startEdit(card)} onContextMenu={(e) => handleCardContext(e, card)}>
          {card.pinned && (
            <div className="board__pin" onClick={() => togglePin(card.id)} title="Unpin">
              &#9733;
            </div>
          )}
          <div
            className={`board__img ph ${card.pinned ? "ph--amber" : "ph--ember"}`}
            style={{ aspectRatio: "4/3" }}
          >
            {card.imageSrc ? (
              <img src={card.imageSrc} alt={card.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              card.label.toUpperCase().slice(0, 16)
            )}
          </div>
          <div className="board__body">
            {editingId === card.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <input
                  className="board__edit-input"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                  autoFocus
                />
                <textarea
                  className="board__edit-input"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  rows={2}
                />
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="board__edit-btn" onClick={saveEdit}>Save</button>
                  <button className="board__edit-btn board__edit-btn--danger" onClick={() => removeCard(card.id)}>Delete</button>
                </div>
              </div>
            ) : (
              <>
                <div className="board__label">{card.label}</div>
                <div className="board__note">{card.note}</div>
                <div>
                  {card.tags.map((tag) => (
                    <span key={tag} className="board__tag">{tag}</span>
                  ))}
                  {!card.pinned && (
                    <span
                      className="board__tag board__tag--pin"
                      onClick={() => togglePin(card.id)}
                      title="Pin as style reference"
                    >
                      pin
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="board__card board__card--add" onClick={addCard}>
        + Add Reference
      </div>
    </div>
  );
}
