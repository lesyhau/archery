// Automatic layout of a canvas diagram with ELK (layered algorithm, hierarchical, so
// packages/nodes/components/partitions/composite states are laid out with their children).
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { CanvasDiagram, Model } from '../model/schema';
import { layoutNodes } from '../render/canvasLayout';

export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';

const elk = new ELK();

export async function autoLayout(diagram: CanvasDiagram, model: Model, direction: LayoutDirection = 'DOWN'): Promise<CanvasDiagram> {
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const nodes = layoutNodes(diagram, model);
  // Ports are snapped to their component's border by the renderer; ELK does not place them.
  const isPort = (id: string) => elements.get(id)?.kind === 'port';
  const laid = [...nodes.values()].filter((n) => !isPort(n.id));
  const childrenOf = (parent: string | undefined) => laid.filter((n) => n.parent === parent);

  const toElk = (id: string): ElkNode => {
    const n = nodes.get(id)!;
    const kids = childrenOf(id);
    const elkNode: ElkNode = { id, width: n.box.w, height: n.box.h };
    if (kids.length > 0) {
      elkNode.children = kids.map((k) => toElk(k.id));
      elkNode.layoutOptions = { 'elk.padding': '[top=44,left=16,bottom=16,right=16]' };
      delete elkNode.width;
      delete elkNode.height;
    }
    return elkNode;
  };

  const relationships = new Map(model.relationships.map((r) => [r.id, r]));
  const edges: ElkExtendedEdge[] = [];
  const endOf = (id: string) => {
    // Edges to a port attach to the port's component for layout purposes.
    if (isPort(id)) return nodes.get(id)?.parent;
    return nodes.has(id) ? id : undefined;
  };
  for (const e of diagram.edges) {
    const rel = relationships.get(e.ref);
    const s = rel && endOf(rel.from);
    const t = rel && endOf(rel.to);
    if (s && t && s !== t) edges.push({ id: e.ref, sources: [s], targets: [t] });
  }
  for (const e of diagram.local.edges) {
    const s = endOf(e.from);
    const t = endOf(e.to);
    if (s && t && s !== t) edges.push({ id: `local:${e.id}`, sources: [s], targets: [t] });
  }

  const graph: ElkNode = {
    id: '__root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.edgeNode': '30',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
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

  // Ports keep their offset relative to their component.
  const portPos = (id: string, x: number, y: number) => {
    const parent = nodes.get(id)?.parent;
    const before = parent && nodes.get(parent)?.box;
    const after = parent && absolute.get(parent);
    if (!before || !after) return { x, y };
    return { x: Math.round(x - before.x + after.x), y: Math.round(y - before.y + after.y) };
  };

  return {
    ...diagram,
    nodes: diagram.nodes.map((n) => {
      if (isPort(n.ref)) return { ...n, ...portPos(n.ref, n.x, n.y) };
      const a = absolute.get(n.ref);
      if (!a) return n;
      const container = nodes.get(n.ref)?.container;
      return { ...n, x: a.x, y: a.y, ...(container ? { w: a.w, h: a.h } : {}) };
    }),
    edges: diagram.edges.map((e) => ({ ...e, waypoints: [], labelOffset: undefined })),
    local: {
      nodes: diagram.local.nodes.map((n) => {
        const a = absolute.get(n.id);
        if (!a) return n;
        return { ...n, x: a.x, y: a.y, ...(nodes.get(n.id)?.container ? { w: a.w, h: a.h } : {}) };
      }),
      edges: diagram.local.edges.map((e) => ({ ...e, waypoints: [], labelOffset: undefined })),
    },
  };
}
