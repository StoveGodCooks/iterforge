/**
 * TilesPreview — 3x3 tiling preview (stub).
 */
export default function TilesPreview() {
  return (
    <div style={{ textAlign: "center", padding: 40 }}>
      <div className="tiles-grid">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="tiles-cell ph ph--green">
            TILE
          </div>
        ))}
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 16 }}>
        Drop a tileable image to preview seamless tiling.
      </p>
    </div>
  );
}
