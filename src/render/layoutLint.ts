// Layout problems of a canvas diagram, as data (validate reports them): an agent cannot look at a
// picture, so it gets the coordinates of what overlaps instead. auto_layout uses the same checks to
// route lines around shapes and to move labels out of the way.
import type { CanvasDiagram, Model } from '../model/schema';
import { edgeKey, edgeLayouts, edgePoints, labelBox, layoutNodes, leaderLine, nearestOnPolyline, relationshipLabel, segmentCrossesBox, type Box, type LaidOutNode } from './canvasLayout';

export { segmentCrossesBox };
import type { DiagramStyle } from './scene';

type Pt = [number, number];

const at = (b: Box) => `(${Math.round(b.x)}, ${Math.round(b.y)}, ${Math.round(b.w)}x${Math.round(b.h)})`;
/** Whether two boxes overlap by more than `margin` (a negative margin: come closer than that). */
export const overlaps = (a: Box, b: Box, margin = 0) => a.x + margin < b.x + b.w && b.x + margin < a.x + a.w && a.y + margin < b.y + b.h && b.y + margin < a.y + a.h;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** One drawn line: what it connects, its polyline, and its label's box. */
export interface DrawnEdge {
  /** Relationship ref, or the local edge id. */
  id: string;
  local: boolean;
  from: string;
  to: string;
  points: Pt[];
  label: string;
  /** Where the label is drawn (moved by its offset); undefined without a label. */
  labelBox?: Box;
  moved: boolean;
}

/** The shapes of a diagram and its lines as they are drawn (same routes and label places as the renderer). */
export function drawnEdges(diagram: CanvasDiagram, model: Model, ds: DiagramStyle = 'classic', nodes = layoutNodes(diagram, model)): DrawnEdge[] {
  const draws = edgeLayouts(diagram, model, nodes, ds);
  const relationships = new Map(model.relationships.map((r) => [r.id, r]));
  const keywords = diagram.show?.keywords;
  const shape = (id: string) => {
    const n = nodes.get(id);
    return n && { box: n.box, outline: n.outline, lollipop: n.lollipop };
  };
  const edges = [
    ...diagram.edges.map((e) => {
      const r = relationships.get(e.ref);
      return { id: e.ref, local: false, key: edgeKey('model', e.ref), from: r?.from, to: r?.to, waypoints: e.waypoints, label: r ? relationshipLabel(r, keywords) : '', offset: e.labelOffset };
    }),
    ...diagram.local.edges.map((e) => ({ id: e.id, local: true, key: edgeKey('local', e.id), from: e.from, to: e.to, waypoints: e.waypoints, label: e.label ?? '', offset: e.labelOffset })),
  ];
  const out: DrawnEdge[] = [];
  for (const e of edges) {
    const a = e.from && shape(e.from);
    const b = e.to && shape(e.to);
    if (!a || !b) continue;
    const draw = draws.get(e.key) ?? {};
    const points = edgePoints(a, b, e.waypoints, ds, draw);
    let box: Box | undefined;
    if (e.label) {
      box = labelBox(points, e.label, ds, draw.labelAt);
      if (e.offset) box = { ...box, x: box.x + e.offset.x, y: box.y + e.offset.y };
    }
    out.push({ id: e.id, local: e.local, from: e.from!, to: e.to!, points, label: e.label, labelBox: box, moved: !!e.offset });
  }
  return out;
}

/** The shapes a line may not run through: not containers, not swimlanes or ports, not its own ends or what holds or is held by them. */
export function shapesCrossed(edge: Pick<DrawnEdge, 'from' | 'to' | 'points'>, nodes: Map<string, LaidOutNode>): LaidOutNode[] {
  const within = (id: string, ancestor: string) => {
    for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) if (p === ancestor) return true;
    return false;
  };
  const related = (id: string) =>
    [edge.from, edge.to].some((end) => end === id || within(end, id) || within(id, end));
  const out: LaidOutNode[] = [];
  for (const n of nodes.values()) {
    if (n.container || n.side || related(n.id)) continue;
    if (edge.points.slice(1).some((q, i) => segmentCrossesBox(edge.points[i]!, q, n.box))) out.push(n);
  }
  return out;
}

/**
 * The ends of a line it runs back into: a bend point inside its own box makes the line leave the box
 * and turn back across it (N-8 of the agent report). Not checked for an end that holds the other end
 * (the line starts inside it), ports, and outside the part of a round or diamond shape that is a box.
 */
export function endsCrossed(edge: Pick<DrawnEdge, 'from' | 'to' | 'points'>, nodes: Map<string, LaidOutNode>): LaidOutNode[] {
  const within = (id: string, ancestor: string) => {
    for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) if (p === ancestor) return true;
    return false;
  };
  const out: LaidOutNode[] = [];
  for (const [end, other] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
    const n = nodes.get(end);
    if (!n || n.side || n.lollipop || end === other || within(other, end) || out.includes(n)) continue;
    // The part of the shape inside its outline: the whole box, or the box inside an ellipse / diamond.
    const f = n.outline === 'ellipse' ? (1 - Math.SQRT1_2) / 2 : n.outline === 'diamond' ? 0.25 : 0;
    const core = { x: n.box.x + n.box.w * f, y: n.box.y + n.box.h * f, w: n.box.w * (1 - 2 * f), h: n.box.h * (1 - 2 * f) };
    if (edge.points.slice(1).some((q, i) => segmentCrossesBox(edge.points[i]!, q, core))) out.push(n);
  }
  return out;
}

/** How close a line may run along a box it does not connect. */
export const CLEARANCE = 12;

/**
 * The shapes a line runs along (N-10 of the agent report): a horizontal or vertical stretch of the line
 * closer than CLEARANCE to a side of a shape it does not connect (outside it, or just inside its border),
 * for at least 16 of that side's length, so that it reads as part of the border. The same shapes as
 * shapesCrossed are left out.
 */
export function shapesAlong(edge: Pick<DrawnEdge, 'from' | 'to' | 'points'>, nodes: Map<string, LaidOutNode>): LaidOutNode[] {
  const within = (id: string, ancestor: string) => {
    for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) if (p === ancestor) return true;
    return false;
  };
  const related = (id: string) => [edge.from, edge.to].some((end) => end === id || within(end, id) || within(id, end));
  /** A stretch at `at` from `a` to `b` along one axis, against a side at `side` spanning `lo`..`hi`. */
  const near = (at: number, a: number, b: number, side: number, outward: number, lo: number, hi: number) => {
    const gap = (at - side) * outward; // outside the box when positive
    return gap > -3 && gap < CLEARANCE && Math.min(Math.max(a, b), hi) - Math.max(Math.min(a, b), lo) >= 16;
  };
  const out: LaidOutNode[] = [];
  for (const n of nodes.values()) {
    if (n.container || n.side || related(n.id)) continue;
    const { x, y, w, h } = n.box;
    const along = edge.points.slice(1).some((q, i) => {
      const p = edge.points[i]!;
      if (Math.abs(p[1] - q[1]) < 0.5) return near(p[1], p[0], q[0], y, -1, x, x + w) || near(p[1], p[0], q[0], y + h, 1, x, x + w);
      if (Math.abs(p[0] - q[0]) < 0.5) return near(p[0], p[1], q[1], x, -1, y, y + h) || near(p[0], p[1], q[1], x + w, 1, y, y + h);
      return false;
    });
    if (along) out.push(n);
  }
  return out;
}

/** The shapes the dotted leader of a moved label runs through (N-11). */
export function leaderCrosses(edge: Pick<DrawnEdge, 'points' | 'labelBox' | 'moved'>, nodes: Iterable<LaidOutNode>, box = edge.labelBox): LaidOutNode[] {
  const leader = box && edge.moved !== false ? leaderLine(box, (c) => nearestOnPolyline(edge.points, c)) : undefined;
  if (!leader) return [];
  return [...nodes].filter((n) => !n.container && !n.side && segmentCrossesBox(leader[0], leader[1], n.box));
}

/** The labels of other lines that a line runs through (N-9). */
export function labelsCrossed(edge: Pick<DrawnEdge, 'id' | 'local' | 'points'>, edges: DrawnEdge[]): DrawnEdge[] {
  return edges.filter(
    (o) => o.labelBox && !(o.id === edge.id && o.local === edge.local) && edge.points.slice(1).some((q, i) => segmentCrossesBox(edge.points[i]!, q, o.labelBox!, 1)),
  );
}

/**
 * What is drawn on top of something else: shapes with the same parent that overlap, shapes that lie
 * partly over a container they are not in, lines that run through a shape (or back through their own
 * end) or along its border, line labels that cover a shape, another label, or are crossed by another
 * line, and leader lines of moved labels that run through a shape.
 */
export function layoutProblems(diagram: CanvasDiagram, model: Model, ds: DiagramStyle = 'classic', opts: { afterAutoLayout?: boolean } = {}): string[] {
  // Right after auto_layout, running it again would not help: only the manual fix is named.
  const fix = (manual: string) => (opts.afterAutoLayout ? manual : `run auto_layout, or ${manual}`);
  const nodes = layoutNodes(diagram, model);
  // Swimlanes share their borders, and fork / join bars cross them: they are not checked.
  const lanes = new Set(diagram.local.nodes.filter((n) => n.kind === 'partition').map((n) => n.id));
  const all = [...nodes.values()].filter((n) => !n.side && !lanes.has(n.id));
  const within = (id: string, ancestor: string) => {
    for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) if (p === ancestor) return true;
    return false;
  };
  const out: string[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (within(a.id, b.id) || within(b.id, a.id) || !overlaps(a.box, b.box, 1)) continue;
      // Wholly inside a container: drawn right, but it does not move with the container (auto_layout).
      const [outer, inner] = a.container && inside(b.box, a.box) ? [a, b] : b.container && inside(a.box, b.box) ? [b, a] : [undefined, undefined];
      if (outer && inner) {
        out.push(`${inner.id} ${at(inner.box)} lies inside ${outer.id} ${at(outer.box)} without being part of it, so it does not move with it; make ${outer.id} its parent.`);
        continue;
      }
      if (a.parent === b.parent) {
        out.push(`${a.id} ${at(a.box)} and ${b.id} ${at(b.box)} overlap.`);
        continue;
      }
      // A shape partly over a container it does not belong to.
      const [c, n] = a.container && !inside(a.box, b.box) ? [a, b] : b.container && !inside(b.box, a.box) ? [b, a] : [undefined, undefined];
      if (c && n && n.parent !== c.id) out.push(`${n.id} ${at(n.box)} lies partly over ${c.id} ${at(c.box)} without being part of it.`);
    }
  }

  const edges = drawnEdges(diagram, model, ds, nodes);
  for (const e of edges) {
    if (e.from === e.to) continue;
    for (const n of shapesCrossed(e, nodes)) {
      if (lanes.has(n.id)) continue;
      out.push(`The line of ${e.id} runs through ${n.id} ${at(n.box)}; ${fix('route it around with set_edge_waypoints')}.`);
    }
    for (const n of endsCrossed(e, nodes)) {
      out.push(`The line of ${e.id} runs back across its own end ${n.id} ${at(n.box)}; ${fix(`move the bend points of ${e.id} out of ${n.id} with set_edge_waypoints`)}.`);
    }
    for (const n of shapesAlong(e, nodes)) {
      if (lanes.has(n.id)) continue;
      out.push(`The line of ${e.id} runs along the border of ${n.id} ${at(n.box)}, closer than ${CLEARANCE}; ${fix('move its bend points with set_edge_waypoints')}.`);
    }
    for (const n of leaderCrosses(e, all)) {
      out.push(`The leader line of the label of ${e.id} ${at(e.labelBox!)} runs through ${n.id} ${at(n.box)}; ${fix('move the label with set_label_offset')}.`);
    }
    for (const o of labelsCrossed(e, edges)) {
      out.push(`The line of ${e.id} runs through the label of ${o.id} ${at(o.labelBox!)}; ${fix('move the label with set_label_offset')}.`);
    }
  }
  const labels: { id: string; box: Box }[] = [];
  for (const e of edges) {
    const box = e.labelBox;
    if (!box) continue;
    for (const n of all) if (!n.container && overlaps(box, n.box, 2)) out.push(`The label of ${e.id} ${at(box)} covers ${n.id} ${at(n.box)}.`);
    for (const l of labels) if (overlaps(box, l.box, 1)) out.push(`The labels of ${e.id} ${at(box)} and ${l.id} ${at(l.box)} overlap.`);
    labels.push({ id: e.id, box });
  }
  return out;
}
