export default function StatusBar({ status, onStartComfy }) {
  const comfyOk       = status.comfyui === 'ok';
  const comfyStarting = status.comfyStarting;

  const dot = (ok) => (
    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${ok ? 'bg-green-400' : 'bg-red-400'}`} />
  );

  function ComfyStatus() {
    if (comfyOk) {
      return <span>{dot(true)}ComfyUI</span>;
    }
    if (comfyStarting) {
      return (
        <span className="flex items-center gap-1.5 text-yellow-400">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
          </svg>
          ComfyUI starting…
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5">
        {dot(false)}ComfyUI
        <button
          onClick={onStartComfy}
          className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-brand-600 hover:bg-brand-500 text-white transition-colors"
        >
          Start
        </button>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-4 text-xs text-slate-400">
      <ComfyStatus />
      <span>{dot(status.server === 'ok')}Server</span>
      {status.tier && (
        <span className="px-1.5 py-0.5 rounded bg-surface-600 text-brand-400 uppercase tracking-wider text-[10px]">
          {status.tier}
        </span>
      )}
    </div>
  );
}
