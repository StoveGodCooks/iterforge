import { useState } from 'react';

export default function PreviewArea({ currentImage, history, onSelect, onDelete }) {
  const [zoom, setZoom] = useState(false);

  async function handleDownload(entry) {
    if (!entry?.filename) return;
    const url = `/api/generate/image/${entry.filename}`;
    const a   = document.createElement('a');
    a.href     = url;
    a.download = entry.filename;
    a.click();
  }

  async function handleDelete(entry) {
    if (!entry?.id) return;
    if (!window.confirm(`Delete ${entry.filename}?`)) return;
    await fetch(`/api/history/${entry.id}`, { method: 'DELETE' });
    onDelete(entry.id);
  }

  return (
    <div className="flex h-full">
      {/* Main preview */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden relative">
        {currentImage ? (
          <>
            <div className={`relative ${zoom ? 'fixed inset-4 z-50 flex items-center justify-center bg-black/90' : 'max-w-2xl w-full'}`}>
              <img
                src={`/api/generate/image/${currentImage.filename}`}
                alt={currentImage.prompt}
                onClick={() => setZoom(v => !v)}
                className={`rounded-lg shadow-2xl cursor-zoom-in object-contain ${zoom ? 'max-h-full max-w-full' : 'w-full'}`}
              />
              {zoom && (
                <button onClick={() => setZoom(false)}
                  className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg hover:bg-black">✕</button>
              )}
            </div>

            {/* Image metadata */}
            {!zoom && (
              <div className="mt-4 w-full max-w-2xl flex items-start justify-between gap-4">
                <div className="text-xs text-slate-400 flex-1 min-w-0">
                  <p className="text-slate-300 truncate">{currentImage.prompt}</p>
                  <p className="mt-0.5">
                    Seed: <span className="text-brand-400">{currentImage.seed}</span>
                    {' · '}Backend: <span className="text-slate-300">{currentImage.backend}</span>
                    {currentImage.params?.steps && ` · ${currentImage.params.steps} steps`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleDownload(currentImage)}
                    className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 rounded text-xs text-white transition-colors">
                    ↓ Download
                  </button>
                  <button onClick={() => handleDelete(currentImage)}
                    className="px-3 py-1.5 bg-surface-600 hover:bg-red-900 rounded text-xs text-slate-400 hover:text-red-300 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-slate-600">
            <div className="text-5xl mb-4">🎨</div>
            <p className="text-sm">Enter a prompt and click Generate</p>
          </div>
        )}
      </div>

      {/* History strip */}
      {history.length > 0 && (
        <aside className="w-36 shrink-0 border-l border-surface-600 bg-surface-800 overflow-y-auto p-2 flex flex-col gap-2">
          <p className="text-xs text-slate-500 px-1">History</p>
          {history.map(entry => (
            <button key={entry.id} onClick={() => onSelect(entry)}
              className={`w-full rounded overflow-hidden aspect-square transition-all hover:ring-2 hover:ring-brand-500 ${currentImage?.id === entry.id ? 'ring-2 ring-brand-400' : ''}`}>
              <img
                src={`/api/generate/image/${entry.filename}`}
                alt={entry.prompt}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </aside>
      )}
    </div>
  );
}
