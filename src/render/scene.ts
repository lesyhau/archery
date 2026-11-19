// Drawing primitives produced by the diagram layouts. The webview renders them as SVG
// (webview/render/SceneSvg.tsx); SVG/PNG export can serialize the same scene later.

/** Paint roles; the renderer maps them to theme colors. */
/** node: the light fill of element bodies in the Modern style. */
export type Paint = 'none' | 'surface' | 'alt' | 'node' | 'ink' | 'muted' | 'error';

export type Prim =
  /** sharp: keeps square corners in the Modern style (UML tells the shape apart by them, e.g. object nodes). */
  /** link: a hit area that opens or jumps to that diagram (the drill-down marker of an element detailed elsewhere). */
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx?: number; fill?: Paint; stroke?: Paint; dashed?: boolean; sharp?: boolean; link?: string }
  /** dotted: the leader that ties a moved label to its line or shape. */
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: Paint; dashed?: boolean; dotted?: boolean }
  /** round: a closed polygon (M/L/Z) whose corners the Modern style rounds like boxes. */
  | { t: 'path'; d: string; fill?: Paint; stroke?: Paint; dashed?: boolean; round?: boolean }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: Paint; stroke?: Paint }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: Paint; stroke?: Paint; dashed?: boolean }
  | {
      t: 'text';
      x: number;
      y: number;
      text: string;
      anchor?: 'start' | 'middle' | 'end';
      size?: number;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      fill?: Paint;
      /** Draw a background box behind the text (labels on lines). */
      halo?: boolean;
      /** A label the editor lets you drag (its offset is stored on the edge or node). */
      movable?: boolean;
    };

export interface Scene {
  width: number;
  height: number;
  prims: Prim[];
  /** How the renderers draw the outlines (stroke width, caps). Default: classic. */
  style?: DiagramStyle;
}

/**
 * Diagram styles. Classic: the original look. Modern: the same diagram with rounded corners,
 * rounded right-angle lines, smaller rounded arrowheads, muted line labels, solid activation
 * bars and thinner outlines. The UML notation is the same in both.
 */
export type DiagramStyle = 'classic' | 'modern';
export const DIAGRAM_STYLES: readonly DiagramStyle[] = ['classic', 'modern'];

/** Outline width of a style. */
export const strokeWidthOf = (style?: DiagramStyle): number => (style === 'modern' ? 1 : 1.2);

/** Corner radius of the Modern style (smaller on small shapes). */
export const MODERN_CORNER = 6;

/**
 * Modern: one corner radius everywhere. Boxes get MODERN_CORNER (a quarter of the short side on
 * small shapes) whatever radius the classic shape had; polygons marked `round` get the same.
 */
export function roundCorners(prims: Prim[], style?: DiagramStyle): Prim[] {
  if (style !== 'modern') return prims;
  return prims.map((p) => {
    if (p.t === 'rect' && !p.sharp) return { ...p, rx: Math.min(MODERN_CORNER, Math.min(p.w, p.h) / 4) };
    if (p.t === 'path' && p.round) return { ...p, d: roundedPolygonD(p.d, MODERN_CORNER) };
    return p;
  });
}

/** A closed polygon path (M/L/Z) with its corners rounded; other paths are returned unchanged. */
export function roundedPolygonD(d: string, radius: number): string {
  if (!/^\s*M[\d\s.,L-]*Z\s*$/i.test(d)) return d;
  const nums = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  if (pts.length < 3) return d;
  const n = pts.length;
  const corners = pts.map((c, i) => {
    const p = pts[(i + n - 1) % n]!;
    const q = pts[(i + 1) % n]!;
    const l1 = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1;
    const l2 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    const rr = Math.min(radius, l1 / 4, l2 / 4);
    const a: [number, number] = [c[0] + ((p[0] - c[0]) / l1) * rr, c[1] + ((p[1] - c[1]) / l1) * rr];
    const b: [number, number] = [c[0] + ((q[0] - c[0]) / l2) * rr, c[1] + ((q[1] - c[1]) / l2) * rr];
    return { a, c, b };
  });
  const f = (p: [number, number]) => `${r(p[0])} ${r(p[1])}`;
  let out = `M${f(corners[0]!.b)}`;
  for (let i = 1; i <= n; i++) {
    const k = corners[i % n]!;
    out += ` L${f(k.a)} Q${f(k.c)} ${f(k.b)}`;
  }
  return `${out} Z`;
}

/**
 * Modern: element bodies get a light neutral fill so they read as solid objects over lines and
 * swimlanes. Containers stay open (their contents stand out); external systems, grey in Classic,
 * stay open instead, as the things outside the system. Hollow heads, notes and solid shapes keep
 * their fills.
 */
export function fillShapes(prims: Prim[], style?: DiagramStyle, opts: { container?: boolean; external?: boolean } = {}): Prim[] {
  if (style !== 'modern' || opts.container) return prims;
  return prims.map((p) => {
    if (p.t === 'text' || p.t === 'line') return p;
    if (opts.external) return p.fill === 'alt' ? { ...p, fill: 'surface' } : p;
    return p.fill === 'surface' ? { ...p, fill: 'node' } : p;
  });
}

/** Marks a finished scene with its style (corners are rounded by the layouts before normalizing). */
export function withStyle(scene: Scene, style?: DiagramStyle): Scene {
  return style === 'modern' ? { ...scene, style } : scene;
}

/** Path through the points; corners rounded with `radius` (0: sharp). Only M, L and Q commands. */
export function polylineD(points: [number, number][], radius = 0): string {
  if (points.length === 0) return '';
  let d = `M${r(points[0]![0])} ${r(points[0]![1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]!;
    const c = points[i]!;
    const n = points[i + 1]!;
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const l2 = Math.hypot(n[0] - c[0], n[1] - c[1]);
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    if (rr < 0.5 || !l1 || !l2) {
      d += ` L${r(c[0])} ${r(c[1])}`;
      continue;
    }
    const a: [number, number] = [c[0] - ((c[0] - p[0]) / l1) * rr, c[1] - ((c[1] - p[1]) / l1) * rr];
    const b: [number, number] = [c[0] + ((n[0] - c[0]) / l2) * rr, c[1] + ((n[1] - c[1]) / l2) * rr];
    d += ` L${r(a[0])} ${r(a[1])} Q${r(c[0])} ${r(c[1])} ${r(b[0])} ${r(b[1])}`;
  }
  const last = points.at(-1)!;
  if (points.length > 1) d += ` L${r(last[0])} ${r(last[1])}`;
  return d;
}

export const FONT_SIZE = 13;

/** Approximate text width; the layouts must be deterministic and DOM-free. */
export function textWidth(text: string, size = FONT_SIZE, bold = false): number {
  let units = 0;
  for (const ch of text) {
    if ('iIl.,:;|!\'` '.includes(ch)) units += 0.3;
    else if ('mwMW@'.includes(ch)) units += 0.85;
    else if (ch >= 'A' && ch <= 'Z') units += 0.66;
    else units += 0.55;
  }
  return units * size * (bold ? 1.06 : 1);
}

/** The box a text covers (approximate, like textWidth). */
export function textBox(p: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end'; size?: number; bold?: boolean }): { x: number; y: number; w: number; h: number } {
  const size = p.size ?? FONT_SIZE;
  const w = textWidth(p.text, size, p.bold);
  const left = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
  return { x: left, y: p.y - size, w, h: size + 4 };
}

/** Moves everything so the scene starts at (pad, pad) and computes its size. */
export function normalize(prims: Prim[], pad = 16): Scene {
  return normalizeWithOffset(prims, pad).scene;
}

/** normalize() plus the offset it applied (to move hit areas computed in layout coordinates). */
export function normalizeWithOffset(prims: Prim[], pad = 16): { scene: Scene; dx: number; dy: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const p of prims) {
    switch (p.t) {
      case 'rect':
        add(p.x, p.y);
        add(p.x + p.w, p.y + p.h);
        break;
      case 'line':
        add(p.x1, p.y1);
        add(p.x2, p.y2);
        break;
      case 'circle':
        add(p.cx - p.r, p.cy - p.r);
        add(p.cx + p.r, p.cy + p.r);
        break;
      case 'ellipse':
        add(p.cx - p.rx, p.cy - p.ry);
        add(p.cx + p.rx, p.cy + p.ry);
        break;
      case 'text': {
        const b = textBox(p);
        add(b.x, b.y);
        add(b.x + b.w, b.y + b.h);
        break;
      }
      case 'path':
        // Paths only use M/L/Q/C/Z commands, so every number pair is a point.
        for (const [, x, y] of p.d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)) add(Number(x), Number(y));
        break;
    }
  }
  if (!Number.isFinite(minX)) return { scene: { width: 2 * pad, height: 2 * pad, prims: [] }, dx: 0, dy: 0 };
  const dx = pad - minX;
  const dy = pad - minY;
  const shift = (p: Prim): Prim => {
    switch (p.t) {
      case 'rect':
        return { ...p, x: p.x + dx, y: p.y + dy };
      case 'line':
        return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
      case 'circle':
      case 'ellipse':
        return { ...p, cx: p.cx + dx, cy: p.cy + dy };
      case 'text':
        return { ...p, x: p.x + dx, y: p.y + dy };
      case 'path':
        return { ...p, d: p.d.replace(/(-?[\d.]+)[ ,](-?[\d.]+)/g, (_, x, y) => `${r(Number(x) + dx)} ${r(Number(y) + dy)}`) };
    }
  };
  return { scene: { width: Math.ceil(maxX - minX + 2 * pad), height: Math.ceil(maxY - minY + 2 * pad), prims: prims.map(shift) }, dx, dy };
}

export const r = (n: number) => Math.round(n * 10) / 10;

/** Arrowhead/diamond/triangle path at `tip`, pointing in direction (ux, uy). Modern heads are smaller. */
export function headPath(kind: 'open' | 'filled' | 'triangle' | 'diamond', tipX: number, tipY: number, ux: number, uy: number, style?: DiagramStyle): string {
  const modern = style === 'modern';
  const len = kind === 'diamond' ? (modern ? 7.5 : 9) : modern ? 9 : 11;
  const half = modern ? (kind === 'diamond' ? 4.5 : 4) : 5.5;
  const bx = tipX - ux * len;
  const by = tipY - uy * len;
  const px = -uy * half;
  const py = ux * half;
  if (kind === 'diamond') {
    const ex = tipX - ux * len * 2;
    const ey = tipY - uy * len * 2;
    return `M${r(tipX)} ${r(tipY)} L${r(bx + px)} ${r(by + py)} L${r(ex)} ${r(ey)} L${r(bx - px)} ${r(by - py)} Z`;
  }
  if (kind === 'open') return `M${r(bx + px)} ${r(by + py)} L${r(tipX)} ${r(tipY)} L${r(bx - px)} ${r(by - py)}`;
  return `M${r(bx + px)} ${r(by + py)} L${r(tipX)} ${r(tipY)} L${r(bx - px)} ${r(by - py)} Z`;
}
