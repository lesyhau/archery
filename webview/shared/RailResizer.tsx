// The splitter right of an editor's palette: drag to make it wider (icon and name) or narrower
// (icons only); double-click for the automatic width. The width is remembered in this webview.
import { useEffect, type PointerEvent } from 'react';

const KEY = 'archery.railWidth';
const apply = (w: number | null) => {
  if (w === null) document.documentElement.style.removeProperty('--rail-width');
  else document.documentElement.style.setProperty('--rail-width', `${w}px`);
};

export function RailResizer() {
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved > 0) apply(saved);
    } catch {
      // no storage: the automatic width
    }
  }, []);
  const start = (e: PointerEvent<HTMLDivElement>) => {
    const rail = e.currentTarget.previousElementSibling as HTMLElement | null;
    if (!rail || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = rail.getBoundingClientRect().width;
    let w = w0;
    document.documentElement.classList.add('rail-resizing');
    const move = (ev: globalThis.PointerEvent) => {
      w = Math.round(Math.min(360, Math.max(60, w0 + ev.clientX - x0)));
      apply(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.documentElement.classList.remove('rail-resizing');
      try {
        localStorage.setItem(KEY, String(w));
      } catch {
        // not remembered
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const reset = () => {
    apply(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing stored
    }
  };
  return <div className="rail-resizer" role="separator" aria-orientation="vertical" title="Drag to resize the palette (wide: icons and names). Double-click for the automatic width" onPointerDown={start} onDoubleClick={reset} />;
}
