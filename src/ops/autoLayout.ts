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
//  - running it again gives the same result: nodes keep their current order as a tie-breaker.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { CanvasDiagram, CanvasDiagramType, Model, Relationship } from '../model/schema';
import { containerInset, displayModel, layoutNodes, minSize, relationshipLabel } from '../render/canvasLayout';
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
    const label = relationshipLabel(rel, diagram.show?.keywords !== false);
    if (reversed(rel)) addEdge(e.ref, t, s, label);
    else addEdge(e.ref, s, t, label);
  }
  for (const e of diagram.local.edges) {
    const s = endOf(e.from);
    const t = endOf(e.to);
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

  return {
    ...diagram,
    nodes: diagram.nodes.map((n) => placed(n.ref, n)),
    edges: diagram.edges.map((e) => ({ ...e, waypoints: [], labelOffset: undefined })),
    local: {
      nodes: diagram.local.nodes.map((n) => placed(n.id, n)),
      edges: diagram.local.edges.map((e) => ({ ...e, waypoints: [], labelOffset: undefined })),
    },
  };
}
