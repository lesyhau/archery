// Layout problems of a canvas diagram, as data (validate reports them): an agent cannot look at a
// picture, so it gets the coordinates of what overlaps instead.
import type { CanvasDiagram, Model } from '../model/schema';
import { edgeKey, edgeLayouts, edgePoints, labelBox, layoutNodes, relationshipLabel, type Box } from './canvasLayout';
import type { DiagramStyle } from './scene';

const at = (b: Box) => `(${Math.round(b.x)}, ${Math.round(b.y)}, ${Math.round(b.w)}x${Math.round(b.h)})`;
const overlaps = (a: Box, b: Box, margin = 0) => a.x + margin < b.x + b.w && b.x + margin < a.x + a.w && a.y + margin < b.y + b.h && b.y + margin < a.y + a.h;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/**
 * What is drawn on top of something else: shapes with the same parent that overlap, shapes that lie
 * partly over a container they are not in, and line labels that cover a shape or another label.
 */
export function layoutProblems(diagram: CanvasDiagram, model: Model, ds: DiagramStyle = 'classic'): string[] {
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
      if (a.parent === b.parent) {
        out.push(`${a.id} ${at(a.box)} and ${b.id} ${at(b.box)} overlap.`);
        continue;
      }
      // A shape over a container it does not belong to (it looks inside, but does not move with it).
      const [c, n] = a.container && !inside(a.box, b.box) ? [a, b] : b.container && !inside(b.box, a.box) ? [b, a] : [undefined, undefined];
      if (c && n && n.parent !== c.id) out.push(`${n.id} ${at(n.box)} lies ${inside(n.box, c.box) ? 'inside' : 'partly over'} ${c.id} ${at(c.box)} without being part of it.`);
    }
  }

  const draws = edgeLayouts(diagram, model, nodes, ds);
  const relationships = new Map(model.relationships.map((r) => [r.id, r]));
  const keywords = diagram.show?.keywords !== false;
  const labels: { id: string; box: Box }[] = [];
  const shape = (id: string) => {
    const n = nodes.get(id);
    return n && { box: n.box, outline: n.outline, lollipop: n.lollipop };
  };
  const edges = [
    ...diagram.edges.map((e) => {
      const r = relationships.get(e.ref);
      return { id: e.ref, key: edgeKey('model', e.ref), from: r?.from, to: r?.to, waypoints: e.waypoints, label: r ? relationshipLabel(r, keywords) : '', offset: e.labelOffset };
    }),
    ...diagram.local.edges.map((e) => ({ id: e.id, key: edgeKey('local', e.id), from: e.from, to: e.to, waypoints: e.waypoints, label: e.label ?? '', offset: e.labelOffset })),
  ];
  for (const e of edges) {
    const a = e.from && shape(e.from);
    const b = e.to && shape(e.to);
    if (!a || !b || !e.label) continue;
    const draw = draws.get(e.key) ?? {};
    const box = labelBox(edgePoints(a, b, e.waypoints, ds, draw), e.label, ds, draw.labelAt);
    if (e.offset) {
      box.x += e.offset.x;
      box.y += e.offset.y;
    }
    for (const n of all) if (!n.container && overlaps(box, n.box, 2)) out.push(`The label of ${e.id} ${at(box)} covers ${n.id} ${at(n.box)}.`);
    for (const l of labels) if (overlaps(box, l.box, 1)) out.push(`The labels of ${e.id} ${at(box)} and ${l.id} ${at(l.box)} overlap.`);
    labels.push({ id: e.id, box });
  }
  return out;
}
