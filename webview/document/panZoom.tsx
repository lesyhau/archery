// Pan / zoom view of a rendered diagram, shared by the document frames and the maximized view.
//  - Fit: the whole diagram is visible (frames never enlarge past 100% when fitting)
//  - Fill: the diagram covers the whole frame (may crop; drag to pan)
//  - 1:1: actual size, centered
// The view follows the frame size while it is in Fit or Fill mode.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Scene } from '../../src/render/scene';
import { IconActualSize, IconCenter, IconFill, IconFit, IconMinus, IconPlus } from './icons';

export interface View {
  x: number;
  y: number;
  k: number;
}
type Mode = 'fit' | 'fill' | 'manual';

/** `wheel`: 'always' zooms on every wheel turn; 'ctrl' only with Ctrl/Cmd held (plain wheel scrolls the page). */
/** Attach `bind` as the stage element's ref (it may come and go, e.g. when a frame is minimized). */
/** `panOnWheel`: with wheel 'ctrl', a plain wheel turn pans (like the canvas editor). */
export function usePanZoom(scene: Scene | null, opts: { maxFit: number; margin: number; wheel: 'always' | 'ctrl'; panOnWheel?: boolean }) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const stage = useRef<HTMLElement | null>(null);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const bind = useCallback((el: HTMLElement | null) => {
    stage.current = el;
    setNode(el);
  }, []);
  const mode = useRef<Mode>('fit');

  const place = useCallback(
    (k: number) => {
      const el = stage.current;
      if (!el || !scene) return;
      setView({ k, x: (el.clientWidth - scene.width * k) / 2, y: (el.clientHeight - scene.height * k) / 2 });
    },
    [scene],
  );

  const apply = useCallback(
    (m: Mode) => {
      const el = stage.current;
      if (!el || !scene || scene.width <= 0 || scene.height <= 0) return;
      const w = Math.max(1, el.clientWidth - 2 * opts.margin);
      const h = Math.max(1, el.clientHeight - 2 * opts.margin);
      if (m === 'fit') place(Math.min(w / scene.width, h / scene.height, opts.maxFit));
      else if (m === 'fill') place(Math.max(el.clientWidth / scene.width, el.clientHeight / scene.height));
    },
    [scene, place, opts.margin, opts.maxFit],
  );

  const fit = () => {
    mode.current = 'fit';
    apply('fit');
  };
  const fill = () => {
    mode.current = 'fill';
    apply('fill');
  };
  const actualSize = () => {
    mode.current = 'manual';
    place(1);
  };

  useLayoutEffect(() => apply(mode.current), [apply, node]);

  // Keep fitting / filling when the frame is resized.
  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver(() => mode.current !== 'manual' && apply(mode.current));
    ro.observe(node);
    return () => ro.disconnect();
  }, [apply, node]);

  const zoomAt = (factor: number, cx: number, cy: number) => {
    mode.current = 'manual';
    setView((v) => {
      const k = Math.min(8, Math.max(0.05, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };
  /** Centers the diagram at the current zoom. */
  const center = () => {
    mode.current = 'manual';
    setView((v) => {
      const el = stage.current;
      if (!el || !scene) return v;
      return { k: v.k, x: (el.clientWidth - scene.width * v.k) / 2, y: (el.clientHeight - scene.height * v.k) / 2 };
    });
  };
  const zoomCenter = (factor: number) => {
    const el = stage.current;
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  // Native, non-passive listener so the page (or webview) does not zoom or scroll instead.
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const el = node;
    if (!el || !scene) return;
    const onWheel = (e: WheelEvent) => {
      if (opts.wheel === 'ctrl' && !(e.ctrlKey || e.metaKey)) {
        if (!opts.panOnWheel) return;
        e.preventDefault();
        mode.current = 'manual';
        setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }));
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [node, scene, opts.wheel, opts.panOnWheel]);

  const startPan = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, ...view };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.px, ev.clientY - start.py) < 3) return;
      moved = true;
      mode.current = 'manual';
      setView((v) => ({ ...v, x: start.x + ev.clientX - start.px, y: start.y + ev.clientY - start.py }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return { bind, view, fit, fill, actualSize, center, zoomCenter, startPan };
}

/** Zoom out, percentage, zoom in, Fit, Fill, 1:1, Center. */
export function ZoomTools({ pz }: { pz: ReturnType<typeof usePanZoom> }) {
  return (
    <>
      <button type="button" className="icon-btn" title="Zoom out" onClick={() => pz.zoomCenter(1 / 1.25)}>
        <IconMinus />
      </button>
      <span className="zoom">{Math.round(pz.view.k * 100)}%</span>
      <button type="button" className="icon-btn" title="Zoom in" onClick={() => pz.zoomCenter(1.25)}>
        <IconPlus />
      </button>
      <button type="button" className="icon-btn" title="Fit: show the whole diagram" onClick={pz.fit}>
        <IconFit />
      </button>
      <button type="button" className="icon-btn" title="Fill: cover the whole frame" onClick={pz.fill}>
        <IconFill />
      </button>
      <button type="button" className="icon-btn" title="Reset view: actual size (100%)" onClick={pz.actualSize}>
        <IconActualSize />
      </button>
      <button type="button" className="icon-btn" title="Center" onClick={pz.center}>
        <IconCenter />
      </button>
      <span className="tool-sep" aria-hidden="true" />
    </>
  );
}
