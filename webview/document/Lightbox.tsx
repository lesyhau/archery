// A maximized diagram in a modal over the document: pan with drag, zoom with the wheel or buttons
// (Fit / Fill / 1:1), 0 fits. Esc, the close button or a click on the backdrop closes it; it fades and
// scales in and out.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Scene } from '../../src/render/scene';
import { SceneSvg } from '../render/SceneSvg';
import { IconClose, IconEdit } from './icons';
import { usePanZoom, ZoomTools } from './panZoom';

/** Matches the leave animation in document.css (.lightbox.closing). */
const LEAVE_MS = 160;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function Lightbox({ scene, title, onClose, onEdit, onLink }: { scene: Scene; title: string; onClose(): void; onEdit(): void; onLink?(file: string): void }) {
  const pz = usePanZoom(scene, { maxFit: 4, margin: 24, wheel: 'always' });
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  /** Plays the leave animation, then runs `then` (close, or open the editor / a linked diagram). */
  const leave = useCallback(
    (then: () => void) => {
      if (closing) return;
      if (reducedMotion()) return then();
      setClosing(true);
      window.setTimeout(then, LEAVE_MS);
    },
    [closing],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        leave(onClose);
      } else if (e.key === '0') pz.fit();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  // Focus moves into the dialog and back to where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => before?.focus?.();
  }, []);

  return (
    <div
      className={`lightbox${closing ? ' closing' : ''}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) leave(onClose);
      }}
    >
      <div ref={dialog} className="lightbox-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="lightbox-bar">
          <span className="frame-title">{title}</span>
          <span className="frame-tools">
            <ZoomTools pz={pz} />
            <button type="button" className="icon-btn" title="Edit in the UML diagram editor" onClick={() => leave(onEdit)}>
              <IconEdit />
            </button>
            <button type="button" className="icon-btn" title="Close (Esc)" onClick={() => leave(onClose)}>
              <IconClose />
            </button>
          </span>
        </div>
        <div
          ref={pz.bind}
          className="lightbox-stage"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            pz.startPan(e);
          }}
        >
          <div className="lightbox-canvas" style={{ transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})` }}>
            <SceneSvg scene={scene} label={title} onLink={onLink && ((file) => leave(() => onLink(file)))} />
          </div>
        </div>
      </div>
    </div>
  );
}
