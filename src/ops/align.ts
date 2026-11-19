// Align and distribute boxes (the canvas editor's Arrange actions and the align_nodes tool).

export type AlignMode = 'left' | 'centerH' | 'right' | 'top' | 'middle' | 'bottom' | 'distributeH' | 'distributeV';
export const ALIGN_MODES: readonly AlignMode[] = ['left', 'centerH', 'right', 'top', 'middle', 'bottom', 'distributeH', 'distributeV'];

export interface AlignBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * New top-left corners. Align: edges or centers on one line (centerH: a vertical line, middle: a
 * horizontal one). Distribute: equal gaps between the boxes, the outer two stay. Not snapped to a grid:
 * that could undo the alignment of boxes whose sizes are not grid multiples.
 */
export function alignBoxes(boxes: AlignBox[], mode: AlignMode): { id: string; x: number; y: number }[] {
  if (boxes.length < 2) return boxes.map((b) => ({ id: b.id, x: b.x, y: b.y }));
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxR = Math.max(...boxes.map((b) => b.x + b.w));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxB = Math.max(...boxes.map((b) => b.y + b.h));
  const cx = (minX + maxR) / 2;
  const cy = (minY + maxB) / 2;
  let moves: { id: string; x: number; y: number }[];
  if (mode === 'distributeH' || mode === 'distributeV') {
    const h = mode === 'distributeH';
    const sorted = [...boxes].sort((a, b) => (h ? a.x - b.x : a.y - b.y));
    const total = sorted.reduce((s, b) => s + (h ? b.w : b.h), 0);
    const gap = ((h ? maxR - minX : maxB - minY) - total) / Math.max(1, sorted.length - 1);
    let pos = h ? minX : minY;
    moves = sorted.map((b) => {
      const m = h ? { id: b.id, x: pos, y: b.y } : { id: b.id, x: b.x, y: pos };
      pos += (h ? b.w : b.h) + gap;
      return m;
    });
  } else {
    moves = boxes.map((b) => ({
      id: b.id,
      x: mode === 'left' ? minX : mode === 'right' ? maxR - b.w : mode === 'centerH' ? cx - b.w / 2 : b.x,
      y: mode === 'top' ? minY : mode === 'bottom' ? maxB - b.h : mode === 'middle' ? cy - b.h / 2 : b.y,
    }));
  }
  return moves.map((m) => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) }));
}
