import { useState } from 'react';

export default function PreviewArea({ currentImage, history, onSelect, onDelete }) {
  const [zoom, setZoom] = useState(false);

  async function handleDownload(entry) {
    if (!entry?.filename) return;
    const a   = document.createElement('a');
    a.href     = `/api/generate/image/${entry.filename}`;
    a.download = entry.filename;
    a.click();
  }

  async function handleDelete(entry) {
    if (!entry?.id) return;
    if (!window.confirm('Delete this image?')) return;
    await fetch(`/api/history/${entry.id}`, { method: 'DELETE' });
    onDelete(entry.id);
  }

  return (
    <div className="flex h-full">
      {/* Main preview */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden">
        {currentImage ? (
          <>
            <div className={`relative ${zoom ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6' : 'max-w-2xl w-full'}`}>
              <img
                src={`/api/generate/image/${currentImage.filename}`}
                alt={currentImage.prompt}
                onClick={() => setZoom(v => !v)}
                className={`rounded-xl shadow-2xl cursor-zoom-in object-contain ${zoom ? 'max-h-full max-w-full' : 'w-full'}`}
              />
              {zoom && (
                <button onClick={() => setZoom(false)}
                  className="absolute top-4 right-4 bg-surface-800/90 backdrop-blur-sm text-slate-300 rounded-full w-9 h-9 flex items-center justify-center text-lg hover:bg-surface-700 hover:text-white transition-all">
                  ✕
                </button>
              )}
            </div>

            {!zoom && (
              <div className="mt-4 w-full max-w-2xl">
                <div className="flex items-start gap-3 bg-surface-800/60 rounded-xl px-4 py-3 border border-surface-700/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate leading-snug">{currentImage.prompt}</p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <Pill label="Seed" value={currentImage.seed} />
                      <Pill label="Backend" value={currentImage.backend} />
                      {currentImage.params?.steps && <Pill label="Steps" value={currentImage.params.steps} />}
                      {currentImage.params?.width && (
                        <Pill label="Size" value={`${currentImage.params.width}×${currentImage.params.height}`} />
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleDownload(currentImage)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 rounded-lg text-xs text-white font-medium transition-colors">
                      ↓ Save
                    </button>
                    <button onClick={() => handleDelete(currentImage)}
                      className="px-3 py-1.5 bg-surface-700 hover:bg-red-900/40 rounded-lg text-xs text-slate-400 hover:text-red-400 font-medium transition-colors border border-surface-600 hover:border-red-800/50">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </div>

      {/* History strip */}
      {history.length > 0 && (
        <aside className="w-32 shrink-0 border-l border-surface-700 bg-surface-800/50 overflow-y-auto p-2 flex flex-col gap-2">
          <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wider px-1">History</p>
          {history.map(entry => (
            <button key={entry.id} onClick={() => onSelect(entry)}
              className={`w-full rounded-lg overflow-hidden aspect-square transition-all hover:ring-2 hover:ring-brand-500/70 ${
                currentImage?.id === entry.id ? 'ring-2 ring-brand-400' : ''
              }`}>
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

function Pill({ label, value }) {
  return (
    <span className="text-[11px] text-slate-500">
      {label}: <span className="text-slate-300">{value}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <div className="w-20 h-20 rounded-2xl bg-surface-700/40 border border-surface-600/40 flex items-center justify-center text-3xl">
        🎨
      </div>
      <div className="text-center">
        <p className="text-sm text-slate-400 font-medium">No image yet</p>
        <p className="text-xs text-slate-600 mt-1">Enter a prompt and click Generate</p>
      </div>
    </div>
  );
}
