import { useEffect, useRef } from 'react';

/**
 * ModelViewer — Babylon.js web component wrapper for GLB rendering.
 * Uses the @babylonjs/viewer package (loaded as a side-effect import).
 * Falls back gracefully if the web component fails to register.
 */

// Load Babylon viewer web component as a side-effect — registers <babylon-viewer>
let babylonLoaded = false;
function ensureBabylon() {
  if (babylonLoaded) return;
  babylonLoaded = true;
  // Dynamic import keeps the 3D library out of the initial bundle —
  // only loaded when a 3D asset is first viewed.
  import('@babylonjs/viewer').catch(err =>
    console.warn('[Inter-Forge] Babylon viewer load failed:', err)
  );
}

export default function ModelViewer({ glbUrl, className = '' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    ensureBabylon();
  }, []);

  // Cache-bust on URL change so the viewer re-renders after live sync
  const bustedUrl = glbUrl.includes('?') ? glbUrl : `${glbUrl}?t=${Date.now()}`;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`} style={{ aspectRatio: '1 / 1' }}>
      {/* Babylon.js web component — renders the GLB */}
      <babylon-viewer
        source={bustedUrl}
        style={{
          width:  '100%',
          height: '100%',
          display: 'block',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      />

      {/* Subtle corner badge */}
      <span className="absolute bottom-2 right-2 text-[9px] text-slate-600 bg-surface-900/60 px-1.5 py-0.5 rounded font-mono pointer-events-none">
        ⬡ 3D · drag to orbit
      </span>
    </div>
  );
}
