// Automatic layout of a canvas diagram with ELK (layered algorithm, hierarchical, so
// packages/nodes/components/partitions/composite states are laid out with their children).
//
// What it aims for:
//  - flow follows the relationships: clients above (or left of) what they use, superclasses and
//    implemented interfaces above their specializations, base use cases before their extensions,
//    initial nodes first and final nodes last;
//  - edges are drawn straight (or with Modern's right angles), so nodes are placed to keep edges short
//    and straight, with few crossings, and with room between layers for the edge labels;
//  - containers fit their children below their own name / keyword / property header;
//  - orthogonal regions stack inside their state; ports stay where they were on their component;
//  - unconnected parts are packed into rows instead of one long line;
//  - a line that would run straight through a shape follows ELK's route around it instead (bend points),
//    leaving and entering its ends through their border;
//  - a label that still covers a shape or another label, or that another line runs through, is moved
//    next to its line;
//  - running it again gives the same result: nodes keep their current order as a tie-breaker.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { CanvasDiagram, CanvasDiagramType, Model, Relationship } from '../model/schema';
import { containerInset, displayModel, labelBox, layoutNodes, minSize, relationshipLabel, type Box } from '../render/canvasLayout';
import { drawnEdges, endsCrossed, leaderCrosses, overlaps, segmentCrossesBox, shapesAlong, shapesCrossed } from '../render/layoutLint';
import { textWidth } from '../render/scene';

export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';

const elk = new ELK();

/** Use case diagrams read left to right (actors, then the system with its use cases); the rest top down. */
export function defaultDirection(type: CanvasDiagramType): LayoutDirection {
  return type === 'context' ? 'RIGHT' : 'DOWN';
}

/** Relationships laid out against their arrow: the general / providing / base end comes first. */
function reversed(rel: Relationship): boolean {
  if (rel.kind === 'generalization' || rel.kind === 'realization' || rel.kind === 'deploy') return true;
  return rel.kind === 'dependency' && /(^|,)\s*extend\s*(,|$)/.test(rel.stereotype ?? '');
}

const FIRST_KINDS = new Set(['initial']);
const LAST_KINDS = new Set(['final', 'activityFinal', 'terminate']);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export async function autoLayout(diagram: CanvasDiagram, model: Model, direction: LayoutDirection = defaultDirection(diagram.type)): Promise<CanvasDiagram> {
  model = displayModel(model, diagram);
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const nodes = layoutNodes(diagram, model);
  const localKind = new Map(diagram.local.nodes.map((n) => [n.id, n.kind as string]));
  const localName = new Map(diagram.local.nodes.map((n) => [n.id, n.name]));
  // Ports, pins and entry / exit points are snapped to their parent's border by the renderer; ELK does not place them.
  const isBorder = (id: string) => {
    const kind = elements.get(id)?.kind ?? localKind.get(id);
    return (kind === 'port' || kind === 'pin' || kind === 'entryPoint' || kind === 'exitPoint') && !!nodes.get(id)?.parent;
  };
  const laid = [...nodes.values()].filter((n) => !isBorder(n.id));
  // Current reading order (along the layout direction first): the tie-breaker that keeps re-runs stable.
  const vertical = direction === 'DOWN' || direction === 'UP';
  const order = (a: (typeof laid)[number], b: (typeof laid)[number]) =>
    vertical ? a.box.y - b.box.y || a.box.x - b.box.x : a.box.x - b.box.x || a.box.y - b.box.y;
  const childrenOf = (parent: string | undefined) => laid.filter((n) => n.parent === parent).sort(order);

  // --- edges ------------------------------------------------------------------------
  const relationships = new Map(model.relationships.map((r) => [r.id, r]));
  const edges: ElkExtendedEdge[] = [];
  const endOf = (id: string) => (isBorder(id) ? nodes.get(id)?.parent : nodes.has(id) ? id : undefined);
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  /** Edges laid out against their arrow: ELK's route for them runs backwards. */
  const against = new Set<string>();
  /** Edges that end on a port: ELK routes them to its parent, so its route does not fit. */
  const onPort = new Set<string>();
  let widestLabel = 0;
  const addEdge = (id: string, from: string, to: string, label?: string) => {
    if (from === to) return;
    outgoing.add(from);
    incoming.add(to);
    if (label) widestLabel = Math.max(widestLabel, textWidth(label, 12));
    edges.push({ id, sources: [from], targets: [to] });
  };
  for (const e of diagram.edges) {
    const rel = relationships.get(e.ref);
    const s = rel && endOf(rel.from);
    const t = rel && endOf(rel.to);
    if (!rel || !s || !t) continue;
    if (isBorder(rel.from) || isBorder(rel.to)) onPort.add(e.ref);
    const label = relationshipLabel(rel, diagram.show?.keywords);
    if (reversed(rel)) {
      against.add(e.ref);
      addEdge(e.ref, t, s, label);
    } else addEdge(e.ref, s, t, label);
  }
  for (const e of diagram.local.edges) {
    const s = endOf(e.from);
    const t = endOf(e.to);
    if (isBorder(e.from) || isBorder(e.to)) onPort.add(`local:${e.id}`);
    if (s && t) addEdge(`local:${e.id}`, s, t, e.kind === 'anchor' ? undefined : e.label);
  }

  // --- nodes ------------------------------------------------------------------------
  const toElk = (id: string): ElkNode => {
    const n = nodes.get(id)!;
    const kids = childrenOf(id);
    const kind = localKind.get(id);
    const options: Record<string, string> = {};
    if (FIRST_KINDS.has(kind ?? '') && !incoming.has(id)) options['elk.layered.layering.layerConstraint'] = 'FIRST';
    if (LAST_KINDS.has(kind ?? '') && !outgoing.has(id)) options['elk.layered.layering.layerConstraint'] = 'LAST';
    if (kids.length === 0) return { id, width: n.box.w, height: n.box.h, layoutOptions: options };

    const holdsRegions = kids.some((k) => localKind.get(k.id) === 'region');
    const { pad, header } = containerInset(elements.get(id), kind, localName.get(id), !!n.subject, holdsRegions, n.box.w);
    options['elk.padding'] = `[top=${pad + header},left=${pad},bottom=${pad},right=${pad}]`;
    // At least wide enough for its name and keywords.
    const el = elements.get(id);
    const nameWidth = el ? minSize(el, false, undefined, diagram.nodes.find((d) => d.ref === id)?.w)[0] : textWidth(localName.get(id) ?? '', 13, true) + 32;
    options['elk.nodeSize.constraints'] = 'MINIMUM_SIZE';
    options['elk.nodeSize.minimum'] = `(${Math.ceil(nameWidth)},${header + 2 * pad})`;
    if (holdsRegions) {
      // Orthogonal regions: one column under the state's name, each region laid out on its own.
      Object.assign(options, {
        'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
        'elk.direction': 'RIGHT',
        'elk.separateConnectedComponents': 'false',
        'elk.spacing.nodeNode': '0',
        'elk.layered.spacing.nodeNodeBetweenLayers': '0',
      });
    } else if (kind === 'region') {
      Object.assign(options, { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.direction': direction });
    }
    return { id, layoutOptions: options, children: kids.map((k) => toElk(k.id)) };
  };

  // Labels are drawn at the middle of a line: beside it when it runs top-down, above it when it runs
  // sideways. So top-down layouts keep neighbours apart by the widest label, sideways ones the layers.
  // (ELK's own edge labels would add a layer per label and double the distances.)
  const between = vertical ? 70 : clamp(Math.ceil(widestLabel) + 40, 70, 240);
  const beside = vertical ? clamp(Math.ceil(widestLabel) + 24, 50, 160) : 50;

  const graph: ElkNode = {
    id: '__root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(beside),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(between),
      'elk.spacing.edgeNode': '30',
      'elk.spacing.edgeEdge': '15',
      'elk.spacing.componentComponent': '70',
      // Straight lines are drawn between the boxes: short, straight edges matter more than compact layers.
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.thoroughness': '20',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      // Unconnected parts are packed in rows of roughly this width-to-height ratio.
      'elk.aspectRatio': '1.6',
      'elk.separateConnectedComponents': 'true',
      // Edge routes in the coordinates of the whole diagram, like the nodes after walk() below.
      'elk.json.edgeCoords': 'ROOT',
    },
    children: childrenOf(undefined).map((n) => toElk(n.id)),
    edges,
  };
  const result = await elk.layout(graph);

  // ELK positions are relative to the parent; the diagram stores absolute positions.
  const absolute = new Map<string, { x: number; y: number; w: number; h: number }>();
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      absolute.set(c.id, { x: Math.round(x + 40), y: Math.round(y + 40), w: Math.round(c.width ?? 0), h: Math.round(c.height ?? 0) });
      walk(c, x, y);
    }
  };
  walk(result, 0, 0);

  // ELK's route of every edge (its bend points, in the direction of the relationship).
  const routes = new Map<string, Waypoints>();
  for (const e of (result.edges ?? []) as ElkExtendedEdge[]) {
    const section = e.sections?.length === 1 ? e.sections[0] : undefined;
    if (!section || onPort.has(e.id)) continue;
    const bends = (section.bendPoints ?? []).map((p) => ({ x: Math.round(p.x + 40), y: Math.round(p.y + 40) }));
    routes.set(e.id, against.has(e.id) ? bends.reverse() : bends);
  }

  // Border nodes keep their offset relative to their parent.
  const borderPos = (id: string, x: number, y: number) => {
    const parent = nodes.get(id)?.parent;
    const before = parent && nodes.get(parent)?.box;
    const after = parent && absolute.get(parent);
    if (!before || !after) return { x, y };
    return { x: Math.round(x - before.x + after.x), y: Math.round(y - before.y + after.y) };
  };
  const placed = <T extends { x: number; y: number }>(id: string, n: T): T => {
    if (isBorder(id)) return { ...n, ...borderPos(id, n.x, n.y) };
    const a = absolute.get(id);
    if (!a) return n;
    return { ...n, x: a.x, y: a.y, ...(nodes.get(id)?.container ? { w: a.w, h: a.h } : {}) };
  };

  const laidOut: CanvasDiagram = {
    ...diagram,
    nodes: diagram.nodes.map((n) => placed(n.ref, n)),
    edges: diagram.edges.map((e) => ({ ...e, waypoints: [], labelOffset: undefined })),
    local: {
      nodes: diagram.local.nodes.map((n) => placed(n.id, n)),
      edges: diagram.local.edges.map((e) => ({ ...e, waypoints: [], labelOffset: undefined })),
    },
  };
  return moveLabels(routeAround(laidOut, model, routes), model);
}

/** The key of an edge in ELK's graph: the relationship ref, or local:<id>. */
const elkId = (e: { id: string; local: boolean }) => (e.local ? `local:${e.id}` : e.id);

/** Sets the bend points of the given edges (keyed like ELK's graph); the others keep theirs. */
function withWaypoints(diagram: CanvasDiagram, waypoints: (id: string) => { x: number; y: number }[] | undefined): CanvasDiagram {
  return {
    ...diagram,
    edges: diagram.edges.map((e) => {
      const w = waypoints(e.ref);
      return w ? { ...e, waypoints: w } : e;
    }),
    local: {
      ...diagram.local,
      edges: diagram.local.edges.map((e) => {
        const w = waypoints(`local:${e.id}`);
        return w ? { ...e, waypoints: w } : e;
      }),
    },
  };
}

type Waypoints = { x: number; y: number }[];

/** Room between a detour and the shape it goes around. */
const DETOUR_GAP = 16;
/** How far inside a container's border a detour has to stay. */
const WALL = 8;

const swap = (b: Box): Box => ({ x: b.y, y: b.x, w: b.h, h: b.w });
const flip = (w: Waypoints): Waypoints => w.map((p) => ({ x: p.y, y: p.x }));

/**
 * Routes from box a to box b along a vertical lane at `x` beside the shape s in the way. Each end is
 * left or entered from its side when the lane passes beside it, or through the side facing the lane's
 * other end with a short step to the lane (a bend point inside an end would make the line cross its
 * own box: N-8 of the agent report). Every combination is offered; the caller keeps the best.
 */
function laneRoutes(a: Box, b: Box, s: Box, x: number): Waypoints[] {
  const p = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const q = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const down = q.y >= p.y;
  // The step stays clear of the shape in the way: half the room between them when that is less.
  const room = (gap: number) => (gap > 0 ? Math.min(DETOUR_GAP, gap / 2) : DETOUR_GAP);
  const ya = down ? a.y + a.h + room(s.y - (a.y + a.h)) : a.y - room(a.y - (s.y + s.h));
  const yb = down ? b.y - room(b.y - (s.y + s.h)) : b.y + b.h + room(s.y - (b.y + b.h));
  const starts: Waypoints[] = [[{ x, y: p.y }], [{ x: p.x, y: ya }, { x, y: ya }]];
  const ends: Waypoints[] = [[{ x, y: q.y }], [{ x, y: yb }, { x: q.x, y: yb }]];
  return starts.flatMap((st) => ends.map((en) => [...st, ...en]));
}

/**
 * Lines drawn straight (Classic) or with right angles (Modern) between their shapes may run through a
 * shape in between (N-7 of the agent report). Such a line gets the route that runs through the fewest
 * shapes (its own ends included), then runs along the border of the fewest (N-10), then has the fewest
 * bends: ELK's route, one corner, or a lane beside a shape in the way. (ELK has no usable route for a
 * line that ends on a port: it routes it to the port's parent.)
 */
function routeAround(diagram: CanvasDiagram, model: Model, routes: Map<string, Waypoints>): CanvasDiagram {
  const nodes = layoutNodes(diagram, model);
  /** How many shapes the line `id` runs through, and along, in the worse of the two styles. */
  const fit = (d: CanvasDiagram, id: string) => {
    let n = 0;
    let along = 0;
    for (const ds of ['classic', 'modern'] as const) {
      const e = drawnEdges(d, model, ds, nodes).find((x) => elkId(x) === id);
      if (!e || e.from === e.to) continue;
      n = Math.max(n, shapesCrossed(e, nodes).length + endsCrossed(e, nodes).length);
      along = Math.max(along, shapesAlong(e, nodes).length);
    }
    return { n, along };
  };
  const crossings = (d: CanvasDiagram, id: string) => fit(d, id).n;
  let d = diagram;
  for (const e of drawnEdges(diagram, model, 'classic', nodes)) {
    const id = elkId(e);
    if (e.from === e.to || !crossings(d, id)) continue;
    const a = nodes.get(e.from)!.box;
    const b = nodes.get(e.to)!.box;
    const [p, q] = [{ x: a.x + a.w / 2, y: a.y + a.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h / 2 }];
    // The containers that hold both ends: a detour on or outside their border would run along the
    // wall (or out of the box); each one it leaves counts like a shape in the way.
    const holders: Box[] = [];
    for (let c = nodes.get(e.from)!.parent; c; c = nodes.get(c)?.parent) {
      let t = nodes.get(e.to)!.parent;
      while (t && t !== c) t = nodes.get(t)?.parent;
      if (t === c) holders.push(nodes.get(c)!.box);
    }
    const walls = (w: Waypoints) => holders.filter((h) => w.some((pt) => pt.x < h.x + WALL || pt.x > h.x + h.w - WALL || pt.y < h.y + WALL || pt.y > h.y + h.h - WALL)).length;
    const options: Waypoints[] = [routes.get(id) ?? [], [{ x: p.x, y: q.y }], [{ x: q.x, y: p.y }]];
    for (const s of shapesCrossed(e, nodes)) {
      for (const x of [s.box.x - DETOUR_GAP, s.box.x + s.box.w + DETOUR_GAP]) options.push(...laneRoutes(a, b, s.box, x));
      for (const y of [s.box.y - DETOUR_GAP, s.box.y + s.box.h + DETOUR_GAP]) options.push(...laneRoutes(swap(a), swap(b), swap(s.box), y).map(flip));
    }
    let best: { waypoints: Waypoints; n: number; along: number } | undefined;
    for (const option of options) {
      if (!option.length) continue;
      const waypoints = option.map((w) => ({ x: Math.round(w.x), y: Math.round(w.y) }));
      const f = fit(withWaypoints(d, (x) => (x === id ? waypoints : undefined)), id);
      const n = f.n + walls(waypoints);
      const better = !best || n < best.n || (n === best.n && (f.along < best.along || (f.along === best.along && waypoints.length < best.waypoints.length)));
      if (better) best = { waypoints, n, along: f.along };
    }
    if (best && best.n < crossings(d, id)) d = withWaypoints(d, (x) => (x === id ? best!.waypoints : undefined));
  }
  return d;
}

/** Label moves, nearest first: up to LABEL_REACH in every direction, in LABEL_STEP steps. */
const LABEL_STEP = 6;
const LABEL_REACH = 120;
const SHIFTS = (() => {
  const out: [number, number][] = [];
  for (let x = -LABEL_REACH; x <= LABEL_REACH; x += LABEL_STEP) for (let y = -LABEL_REACH; y <= LABEL_REACH; y += LABEL_STEP) if (x || y) out.push([x, y]);
  return out.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
})();

const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Labels that still cover a shape or another label, or that another line runs through (every place
 * along their line was taken), are moved beside it: to the nearest free spot, else to the spot where
 * they are least in the way; the renderer ties them to their line with a dotted leader (M-5, N-9).
 */
function moveLabels(diagram: CanvasDiagram, model: Model): CanvasDiagram {
  const lanes = new Set(diagram.local.nodes.filter((n) => n.kind === 'partition').map((n) => n.id));
  const tried = new Set<string>();
  let d = diagram;
  for (let round = 0; round <= d.edges.length + d.local.edges.length; round++) {
    const nodes = layoutNodes(d, model);
    const shapes = [...nodes.values()].filter((n) => !n.container && !n.side && !lanes.has(n.id)).map((n) => n.box);
    const edges = drawnEdges(d, model, 'classic', nodes);
    /** How many other lines run through `box` (the label of edge `i`), within `inset` of it. */
    const lines = (box: Box, i: number, inset: number) =>
      edges.filter((o, j) => j !== i && o.from !== o.to && o.points.slice(1).some((q, k) => segmentCrossesBox(o.points[k]!, q, box, inset))).length;
    // The first label in the way, in the order validate checks them (shapes, the labels before it, lines).
    const clash = edges.findIndex((e, i) => {
      const box = e.labelBox;
      if (!box || tried.has(elkId(e))) return false;
      return shapes.some((s) => overlaps(box, s, 2)) || edges.slice(0, i).some((o) => o.labelBox && overlaps(box, o.labelBox, 1)) || lines(box, i, 1) > 0;
    });
    if (clash < 0) break;
    const e = edges[clash]!;
    tried.add(elkId(e));
    const box = e.labelBox!;
    const blockers: Box[] = [...shapes, ...edges.filter((o, i) => i !== clash && o.labelBox).map((o) => o.labelBox!)];
    const solid = [...nodes.values()].filter((n) => !lanes.has(n.id));
    // What is in the way at a spot: the area it covers, half the label's area for each line through it,
    // and the whole label's area for each shape its dotted leader would run through (N-11).
    const cost = (b: Box, margin: number, inset: number) =>
      blockers.reduce((sum, o) => sum + (overlaps(b, o, margin) ? Math.max(1, overlapArea(b, o)) : 0), 0) +
      (lines(b, clash, inset) * b.w * b.h) / 2 +
      leaderCrosses({ points: e.points, moved: true }, solid, b).length * b.w * b.h;
    const now = cost(box, 1, 1);
    let best: { shift: [number, number]; cost: number } | undefined;
    for (const shift of SHIFTS) {
      const b = { ...box, x: box.x + shift[0], y: box.y + shift[1] };
      // Free with some clearance: take it. Else remember the spot least in the way, if better than staying.
      if (cost(b, -3, -2) === 0) {
        best = { shift, cost: 0 };
        break;
      }
      const c = cost(b, 1, 1);
      if (c < now && (!best || c < best.cost)) best = { shift, cost: c };
    }
    if (!best) continue;
    // An offset counts from the label's default place (the middle of the line's middle segment).
    const base = labelBox(e.points, e.label, 'classic');
    const labelOffset = { x: Math.round(box.x - base.x + best.shift[0]), y: Math.round(box.y - base.y + best.shift[1]) };
    d = e.local
      ? { ...d, local: { ...d.local, edges: d.local.edges.map((x) => (x.id === e.id ? { ...x, labelOffset } : x)) } }
      : { ...d, edges: d.edges.map((x) => (x.ref === e.id ? { ...x, labelOffset } : x)) };
  }
  return d;
}
