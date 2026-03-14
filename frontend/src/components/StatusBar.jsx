export default function StatusBar({ status }) {
  const dot = (ok) => (
    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${ok ? 'bg-green-400' : 'bg-red-400'}`} />
  );

  return (
    <div className="flex items-center gap-4 text-xs text-slate-400">
      <span>{dot(status.comfyui === 'ok')}ComfyUI</span>
      <span>{dot(status.server  === 'ok')}Server</span>
      {status.tier && (
        <span className="px-1.5 py-0.5 rounded bg-surface-600 text-brand-400 uppercase tracking-wider text-[10px]">
          {status.tier}
        </span>
      )}
    </div>
  );
}
