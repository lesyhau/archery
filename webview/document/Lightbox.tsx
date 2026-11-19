// A maximized diagram: fills the panel, pan with drag, zoom with the wheel or buttons
// (Fit / Fill / 1:1), Esc closes, 0 fits.
import { useEffect } from 'react';
import type { Scene } from '../../src/render/scene';
import { SceneSvg } from '../render/SceneSvg';
import { IconClose, IconEdit } from './icons';
import { usePanZoom, ZoomTools } from './panZoom';

export function Lightbox({ scene, title, onClose, onEdit, onLink }: { scene: Scene; title: string; onClose(): void; onEdit(): void; onLink?(file: string): void }) {
  const pz = usePanZoom(scene, { maxFit: 4, margin: 24, wheel: 'always' });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '0') pz.fit();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className="lightbox" role="dialog" aria-label={title}>
      <div className="lightbox-bar">
        <span className="frame-title">{title}</span>
        <span className="frame-tools">
          <ZoomTools pz={pz} />
          <button type="button" className="icon-btn" title="Edit in the UML diagram editor" onClick={onEdit}>
            <IconEdit />
          </button>
          <button type="button" className="icon-btn" title="Close (Esc)" onClick={onClose}>
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
          <SceneSvg scene={scene} label={title} onLink={onLink} />
        </div>
      </div>
    </div>
  );
}
