export default function StatusBar({ status, onStartComfy, onSetup }) {
  const comfyOk        = status.comfyui === 'ok';
  const comfyStarting  = status.comfyStarting;
  const comfyInstalled = status.comfyInstalled;
  const setup          = status.setup ?? { state: 'idle' };

  const dot = (ok, color) => (
    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${color ?? (ok ? 'bg-green-400' : 'bg-red-400')}`} />
  );

  const Spinner = () => (
    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
    </svg>
  );

  function ComfyStatus() {
    if (comfyOk) {
      return <span className="flex items-center text-green-400">{dot(true)}ComfyUI</span>;
    }
    if (comfyStarting) {
      return (
        <span className="flex items-center gap-1.5 text-yellow-400">
          <Spinner />ComfyUI starting…
        </span>
      );
    }
    // Setup running
    if (setup.state === 'running') {
      return (
        <span className="flex items-center gap-1.5 text-yellow-400">
          <Spinner />
          <span className="max-w-[200px] truncate" title={setup.message}>
            {setup.message || 'Setting up…'}
          </span>
        </span>
      );
    }
    // Setup error
    if (setup.state === 'error') {
      return (
        <span className="flex items-center gap-1.5 text-red-400" title={setup.error}>
          {dot(false)}Setup failed
          <button onClick={onSetup} className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-red-800 hover:bg-red-700 text-white transition-colors">
            Retry
          </button>
        </span>
      );
    }
    // Not installed
    if (comfyInstalled === false) {
      return (
        <span className="flex items-center gap-1.5">
          {dot(false, 'bg-slate-500')}ComfyUI
          <button
            onClick={onSetup}
            className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-brand-600 hover:bg-brand-500 text-white transition-colors"
          >
            Setup
          </button>
        </span>
      );
    }
    // Installed but stopped
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
