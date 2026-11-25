// Canvas diagram editor (component, deployment, package, class, context, state machine, activity).
// Every change is an operation run by the extension (atomic across model.yaml and the diagram);
// the view is always re-derived from the document text.
//
// Layout: icon toolbar (layout, view, grid, export) on top; the icon rail (diagram type, add,
// connect tools, model elements) on the left; the canvas; the inspector on the right.
// View: Fit is the default and follows the window size until you zoom or pan; Fill, 100% and
// Center are one click (or Shift+1 / Shift+0 / Shift+2). Scroll pans, Ctrl+scroll zooms, a drag on
// the empty canvas selects an area, Space+drag or the middle button pans.
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { parseCanvasDiagram } from '../../src/model/load';
import { ContainerKinds, type CanvasDiagram, type CanvasDiagramType, type LineShape, type Model, type RelationshipKind } from '../../src/model/schema';
import { DEFAULT_SIZE, detailOf, displayModel, edgeLayouts, layoutCanvas, layoutNodes, lineShapeOf, minSize, type LaidOutNode } from '../../src/render/canvasLayout';
import { eventTarget, rootOf, useHostCtx } from '../shared/host';
import { DockPanels } from '../shared/remote';
import { RailResizer } from '../shared/RailResizer';
import { UmlEdge, UmlNode, type UmlFlowEdge, type UmlFlowNode } from './flow';
import { ALIGN_ACTIONS, Inspector, type AlignMode, type QuickAdd, type Selection } from './Inspector';
import { alignBoxes } from '../../src/ops/align';
import { PALETTE, RELATIONSHIPS, type PaletteItem } from './palette';
import { Rail, type ConnectTool } from './Rail';
import {
  IconActualSize,
  IconCenter,
  IconOpen,
  IconExportPng,
  IconExportSvg,
  IconFill,
  IconFit,
  IconGrid,
  IconLayoutDown,
  IconCheck,
  IconLineCurved,
  IconLineHorizontalFirst,
  IconLineOrthogonal,
  IconLineStraight,
  IconLineVerticalFirst,
  IconReverse,
  IconLayoutRight,
  IconMinimap,
  IconRemove,
  IconRename,
  IconSnap,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
  RELATIONSHIP_ICONS,
  TYPE_ICONS,
  TYPE_LABELS,
} from './umlIcons';

const nodeTypes = { uml: UmlNode };
const edgeTypes = { uml: UmlEdge };
const EMPTY_MODEL: Model = { elements: [], relationships: [] };
const DND_TYPE = 'application/x-archery-palette';
const FIT = { padding: 0.12, maxZoom: 1.25 };
const ANIM = { duration: 220 };

const nodeId = (n: { source: 'model' | 'local'; id: string }) => `${n.source === 'model' ? 'm' : 'l'}:${n.id}`;
const splitId = (id: string) => ({ source: id.startsWith('m:') ? ('model' as const) : ('local' as const), ref: id.slice(2) });

type ViewMode = 'fit' | 'fill' | 'manual';
interface MenuItem {
  /** A divider above this item. */
  sep?: boolean;
  label: string;
  hint?: string;
  icon?: () => JSX.Element;
  danger?: boolean;
  /** Shown with a check mark (the current choice, or an option that is on). */
  checked?: boolean;
  /** A submenu, opened on hover or with the arrow keys. */
  items?: MenuItem[];
  run?(): void;
}

/** The line shapes, as the menus offer them. */
const LINE_CHOICES: { line: LineShape; label: string; icon: () => JSX.Element }[] = [
  { line: 'straight', label: 'Straight', icon: IconLineStraight },
  { line: 'orthogonal', label: 'Right angles', icon: IconLineOrthogonal },
  { line: 'curved', label: 'Curved', icon: IconLineCurved },
  { line: 'horizontalFirst', label: 'One corner, across first', icon: IconLineHorizontalFirst },
  { line: 'verticalFirst', label: 'One corner, up or down first', icon: IconLineVerticalFirst },
];

/** A context menu (and its submenus), kept inside the window. */
function ContextMenu({ x, y, items, onClose, nested }: { x: number; y: number; items: MenuItem[]; onClose(): void; nested?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // A submenu that would leave the window opens to the left of its item instead.
    const nx = r.right > window.innerWidth - 4 ? (nested ? x - r.width - (el.parentElement?.getBoundingClientRect().width ?? 0) : window.innerWidth - r.width - 4) : x;
    const ny = r.bottom > window.innerHeight - 4 ? Math.max(4, window.innerHeight - r.height - 4) : y;
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);
  return (
    <div ref={ref} className={`ctx-menu${nested ? ' nested' : ''}`} role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((m, i) => (
        <div key={m.label} className="menu-row" onMouseEnter={() => setOpen(m.items ? i : null)}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup={m.items ? 'menu' : undefined}
            aria-expanded={m.items ? open === i : undefined}
            className={`menu-item${m.danger ? ' danger' : ''}${m.sep ? ' sep' : ''}${open === i ? ' open' : ''}`}
            onClick={() => {
              if (m.items) return setOpen(open === i ? null : i);
              onClose();
              m.run?.();
            }}
            onKeyDown={(e) => {
              if (m.items && e.key === 'ArrowRight') setOpen(i);
              if (e.key === 'ArrowLeft' && nested) (e.currentTarget.closest('.ctx-menu.nested')?.parentElement?.querySelector('button') as HTMLButtonElement | null)?.focus();
            }}
          >
            <span className="menu-icon">{m.checked ? <IconCheck /> : m.icon && <m.icon />}</span>
            <span>{m.label}</span>
            {m.hint && <span className="menu-hint">{m.hint}</span>}
            {m.items && <span className="menu-more" aria-hidden="true">›</span>}
          </button>
          {m.items && open === i && <SubMenu items={m.items} onClose={onClose} />}
        </div>
      ))}
    </div>
  );
}

/** A submenu next to its item. */
function SubMenu({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const row = anchor.current?.parentElement?.getBoundingClientRect();
    if (row) setAt({ x: row.right - 2, y: row.top - 6 });
  }, []);
  return <span ref={anchor}>{at && <ContextMenu x={at.x} y={at.y} items={items} onClose={onClose} nested />}</span>;
}

function ToolButton({ title, onClick, children, on, disabled }: { title: string; onClick(): void; children: ReactNode; on?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`tb icon${on ? ' on' : ''}`} title={title} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Which diagram-local nodes can hold which: states hold regions and states, regions and
 *  partitions hold states / actions, actions hold only their pins. */
function canContainLocal(kind: string | undefined, child: string | undefined): boolean {
  if (child === 'pin') return kind === 'action';
  if (child === 'entryPoint' || child === 'exitPoint') return kind === 'state';
  if (child === 'region') return kind === 'state';
  return kind === 'partition' || kind === 'state' || kind === 'region' || kind === 'interruptibleRegion';
}

/** The canvas diagram editor. Needs a HostContext and a ReactFlowProvider around it. */
export function CanvasEditor() {
  const flow = useReactFlow<UmlFlowNode, UmlFlowEdge>();
  const { zoom } = useViewport();
  const host = useHostCtx();
  const sceneRef = host.sceneRef;
  const canvasRef = useRef<HTMLDivElement>(null);
  const { text, model: hostModel, editable, settings, runOp, post } = host;
  const model = hostModel ?? EMPTY_MODEL;
  const parsed = useMemo(() => (text === undefined ? undefined : parseCanvasDiagram(text)), [text]);
  const diagram = parsed?.value;

  const laid = useMemo(() => (diagram ? layoutNodes(diagram, model) : new Map<string, LaidOutNode>()), [diagram, model]);
  /** The model as this diagram shows it (without tagged values unless it shows them). */
  const shown = useMemo(() => (diagram ? displayModel(model, diagram) : model), [diagram, model]);
  /** Line shapes, sideways shifts and label places, as in the exports. */
  const draws = useMemo(() => (diagram ? edgeLayouts(diagram, model, laid, settings.diagramStyle) : new Map()), [diagram, model, laid, settings.diagramStyle]);
  // This diagram's path relative to the root (elements detailed here get no drill-down marker).
  const self = useMemo(() => {
    const f = host.fileName.replace(/\\/g, '/');
    return host.diagrams.find((d) => f === d.file || f.endsWith(`/${d.file}`))?.file;
  }, [host.fileName, host.diagrams]);
  useEffect(() => {
    sceneRef.current = diagram ? { scene: layoutCanvas(diagram, model, settings.diagramStyle, self), title: diagram.title } : null;
  }, [diagram, model, settings.diagramStyle, self]);

  const [renaming, setRenaming] = useState<string | null>(null);
  /** Live view: nodes outlined briefly after an agent changed them. */
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const [connectMenu, setConnectMenu] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
  // The ref is updated synchronously, so a key pressed right after a click acts on the new selection.
  const selectionRef = useRef(selection);
  const [tool, setTool] = useState<ConnectTool | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [minimap, setMinimap] = useState(false);
  const lastPointer = useRef({ x: 200, y: 200 });
  const viewMode = useRef<ViewMode>('fit');

  const op = useCallback((name: string, input: Record<string, unknown> = {}) => runOp(name, input).catch(() => undefined), [runOp]);
  const snap = useCallback(
    (p: { x: number; y: number }) => (settings.snapToGrid ? { x: Math.round(p.x / settings.gridSize) * settings.gridSize, y: Math.round(p.y / settings.gridSize) * settings.gridSize } : { x: Math.round(p.x), y: Math.round(p.y) }),
    [settings.snapToGrid, settings.gridSize],
  );

  // --- nodes -------------------------------------------------------------------------
  const onRename = useCallback(
    (ref: string, source: 'model' | 'local', name: string | null) => {
      setRenaming(null);
      if (name === null) return;
      if (source === 'model') {
        if (name.trim()) void op('update_element', { id: ref, name: name.trim() });
      } else {
        const local = diagram?.local.nodes.find((n) => n.id === ref);
        void op('update_local_node', local?.kind === 'note' ? { id: ref, text: name } : { id: ref, name: name.trim() || null });
      }
    },
    [op, diagram],
  );
  const onLabelOffset = useCallback((ref: string, offset: { x: number; y: number } | null) => void op('set_label_offset', { id: ref, offset }), [op]);
  const onResize = useCallback(
    (ref: string, box: { x: number; y: number; w: number; h: number }) => {
      const p = snap(box);
      const size = snap({ x: box.w, y: box.h });
      void op('move_nodes', { nodes: [{ id: ref, x: p.x, y: p.y, w: Math.max(size.x, 8), h: Math.max(size.y, 8) }] });
    },
    [op, snap],
  );

  const derivedNodes = useMemo<UmlFlowNode[]>(() => {
    if (!diagram) return [];
    const elements = new Map(shown.elements.map((e) => [e.id, e]));
    const locals = new Map(diagram.local.nodes.map((n) => [n.id, n]));
    return [...laid.values()].map((n) => {
      const element = n.source === 'model' ? elements.get(n.id) : undefined;
      const local = n.source === 'local' ? locals.get(n.id) : undefined;
      const classifier = element?.classifier ? elements.get(element.classifier) : undefined;
      const [minW, minH] = n.source === 'model' ? minSize(element, n.lollipop, classifier) : [Math.min(DEFAULT_SIZE[local!.kind]?.[0] ?? 40, 20), Math.min(DEFAULT_SIZE[local!.kind]?.[1] ?? 20, 8)];
      const id = nodeId(n);
      const port = element?.kind === 'port';
      return {
        id,
        type: 'uml',
        position: { x: n.box.x, y: n.box.y },
        width: n.box.w,
        height: n.box.h,
        zIndex: port ? 1000 : n.depth * 10 + (n.container ? 0 : 1),
        selected: selectionRef.current.nodes.includes(id),
        className: [pending === id ? 'pending' : '', flashIds.has(id) ? 'live-change' : ''].filter(Boolean).join(' ') || undefined,
        data: { ref: n.id, source: n.source, element, local, outline: n.outline, lollipop: n.lollipop, container: n.container, subject: n.subject, separator: n.separator, side: n.side, style: settings.diagramStyle, classifier, minW, minH, editable, renaming: renaming === id, onRename, onResize, onLabelOffset, detail: detailOf(element, self, n.lollipop), onOpenDiagram: host.openDiagram },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, shown, diagram, editable, renaming, onRename, onResize, onLabelOffset, pending, self, flashIds, settings.diagramStyle]);

  const [nodes, setNodes] = useState<UmlFlowNode[]>([]);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);

  /** Parent -> children (flow ids), to move containers with their content. */
  const children = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of laid.values()) {
      if (!n.parent) continue;
      const parent = nodeId({ source: n.source, id: n.parent });
      map.set(parent, [...(map.get(parent) ?? []), nodeId(n)]);
    }
    return map;
  }, [laid]);
  const descendants = useCallback(
    (id: string, acc = new Set<string>()): Set<string> => {
      for (const c of children.get(id) ?? []) if (!acc.has(c)) descendants(c, acc.add(c));
      return acc;
    },
    [children],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<UmlFlowNode>[]) =>
      setNodes((current) => {
        // Moving a container moves everything inside it.
        const extra: NodeChange<UmlFlowNode>[] = [];
        const byId = new Map(current.map((n) => [n.id, n]));
        const moving = new Set(changes.filter((c) => c.type === 'position').map((c) => (c as { id: string }).id));
        for (const c of changes) {
          if (c.type !== 'position' || !c.position) continue;
          const before = byId.get(c.id);
          if (!before) continue;
          const dx = c.position.x - before.position.x;
          const dy = c.position.y - before.position.y;
          if (!dx && !dy) continue;
          for (const d of descendants(c.id)) {
            if (moving.has(d)) continue;
            const n = byId.get(d)!;
            extra.push({ type: 'position', id: d, position: { x: n.position.x + dx, y: n.position.y + dy }, dragging: true });
          }
        }
        return applyNodeChanges([...changes.filter((c) => c.type !== 'remove'), ...extra], current);
      }),
    [descendants],
  );

  /** The innermost container (of the right source) under a point, excluding `exclude`. */
  const containerAt = useCallback(
    (p: { x: number; y: number }, source: 'model' | 'local', exclude: Set<string>, childKind?: string) => {
      let best: LaidOutNode | undefined;
      for (const n of laid.values()) {
        if (n.source !== source || exclude.has(nodeId(n))) continue;
        const kind = source === 'model' ? model.elements.find((e) => e.id === n.id)?.kind : diagram?.local.nodes.find((x) => x.id === n.id)?.kind;
        const canContain = source === 'model' ? ContainerKinds.includes(kind as never) : canContainLocal(kind, childKind);
        if (!canContain) continue;
        const b = n.box;
        if (p.x < b.x || p.y < b.y || p.x > b.x + b.w || p.y > b.y + b.h) continue;
        if (!best || n.depth > best.depth) best = n;
      }
      return best?.id;
    },
    [laid, model, diagram],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, __: UmlFlowNode, dragged: UmlFlowNode[]) => {
      if (!editable || !diagram) return;
      const moved = new Set<string>();
      for (const d of dragged) {
        moved.add(d.id);
        descendants(d.id).forEach((x) => moved.add(x));
      }
      const current = new Map(flow.getNodes().map((n) => [n.id, n]));
      const moves = [...moved].map((id) => {
        const n = current.get(id)!;
        const p = snap(n.position);
        return { id: splitId(id).ref, x: p.x, y: p.y };
      });
      void (async () => {
        await runOp('move_nodes', { nodes: moves }).catch(() => undefined);
        // Dropping a single node into (or out of) a container changes its parent.
        if (dragged.length !== 1) return;
        const d = dragged[0]!;
        const { source, ref } = splitId(d.id);
        if (d.data.element?.kind === 'port') return;
        const center = { x: d.position.x + (d.width ?? 0) / 2, y: d.position.y + (d.height ?? 0) / 2 };
        const target = containerAt(center, source, new Set([d.id, ...descendants(d.id)]), d.data.local?.kind);
        const currentParent = laid.get(ref)?.parent;
        if (target === currentParent) return;
        if (source === 'model') await runOp('update_element', { id: ref, parent: target ?? null }).catch(() => undefined);
        else await runOp('update_local_node', { id: ref, parent: target ?? null }).catch(() => undefined);
      })();
    },
    [editable, diagram, descendants, flow, snap, runOp, containerAt, laid],
  );

  // --- edges -------------------------------------------------------------------------
  const onWaypoints = useCallback((edgeId: string, points: { x: number; y: number }[]) => void op('set_edge_waypoints', { id: splitId(edgeId).ref, waypoints: points }), [op]);

  /**
   * A line goes just above the deepest container it lives in (else a composite state hides its own
   * transitions), level with the shapes there, which stay on top so their labels can be grabbed.
   */
  const edgeZ = (a: string, b: string) => Math.max(0, Math.max(laid.get(a)?.depth ?? 0, laid.get(b)?.depth ?? 0) - 1) * 10 + 1;
  const derivedEdges = useMemo<UmlFlowEdge[]>(() => {
    if (!diagram) return [];
    const rels = new Map(model.relationships.map((r) => [r.id, r]));
    const out: UmlFlowEdge[] = [];
    const sel = selectionRef.current.edges;
    for (const e of diagram.edges) {
      const rel = rels.get(e.ref);
      if (!rel || !laid.has(rel.from) || !laid.has(rel.to)) continue;
      const id = `m:${e.ref}`;
      out.push({ id, type: 'uml', source: `m:${rel.from}`, target: `m:${rel.to}`, zIndex: edgeZ(rel.from, rel.to), selected: sel.includes(id), data: { rel, waypoints: e.waypoints, labelOffset: e.labelOffset, editable, snap, onWaypoints, onLabelOffset, style: settings.diagramStyle, draw: draws.get(id) } });
    }
    for (const e of diagram.local.edges) {
      const end = (ref: string) => (diagram.local.nodes.some((n) => n.id === ref) ? `l:${ref}` : `m:${ref}`);
      const id = `l:${e.id}`;
      out.push({ id, type: 'uml', source: end(e.from), target: end(e.to), zIndex: edgeZ(e.from, e.to), selected: sel.includes(id), data: { local: e, waypoints: e.waypoints, labelOffset: e.labelOffset, editable, snap, onWaypoints, onLabelOffset, style: settings.diagramStyle, draw: draws.get(id) } });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram, model, laid, editable, snap, onWaypoints, onLabelOffset, draws, settings.diagramStyle]);
  const [edges, setEdges] = useState<UmlFlowEdge[]>([]);
  useEffect(() => setEdges(derivedEdges), [derivedEdges]);
  const onEdgesChange = useCallback((changes: EdgeChange<UmlFlowEdge>[]) => setEdges((current) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), current)), []);

  /** Connects two nodes with the active tool, or asks which relationship (model to model). */
  const connect = useCallback(
    (sourceId: string, targetId: string, with_: ConnectTool | null, at?: { x: number; y: number }) => {
      if (!diagram || sourceId === targetId) return;
      const a = splitId(sourceId);
      const b = splitId(targetId);
      const isNote = (s: { source: string; ref: string }) => s.source === 'local' && diagram.local.nodes.find((n) => n.id === s.ref)?.kind === 'note';
      if (a.source === 'model' && b.source === 'model' && !(with_ && 'local' in with_)) {
        if (with_ && 'kind' in with_) void op('add_relationship', { kind: with_.kind, from: a.ref, to: b.ref });
        else setConnectMenu({ source: a.ref, target: b.ref, ...(at ?? lastPointer.current) });
        return;
      }
      const kind = with_ && 'local' in with_ ? with_.local : isNote(a) || isNote(b) || a.source !== b.source ? 'anchor' : diagram.type === 'state' ? 'transition' : 'flow';
      void op('add_local_edge', { kind, from: a.ref, to: b.ref });
    },
    [diagram, op],
  );

  const onConnect = useCallback((c: Connection) => c.source && c.target && connect(c.source, c.target, tool), [connect, tool]);

  /** Clicking the canvas commits and leaves any property field being edited (so keys act on the canvas). */
  const blurPanel = useCallback(() => {
    const active = rootOf(canvasRef.current).activeElement as HTMLElement | null;
    if (active?.closest('.inspector, .toolbar, .rail')) active.blur();
  }, []);

  /** Dropping a connection anywhere on a node (not only on its small handles) connects to it. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
      const el = rootOf(canvasRef.current).elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node');
      const target = el?.getAttribute('data-id');
      if (target && target !== state.fromNode.id) connect(state.fromNode.id, target, tool, { x: point.clientX, y: point.clientY });
    },
    [connect, tool],
  );

  // --- view ---------------------------------------------------------------------------
  const contentBounds = useCallback((onlySelected = false) => {
    const all = flow.getNodes();
    const pick = onlySelected ? all.filter((n) => n.selected) : all;
    return pick.length ? flow.getNodesBounds(pick) : null;
  }, [flow]);

  const fit = useCallback(
    (animate = true) => {
      viewMode.current = 'fit';
      void flow.fitView({ ...FIT, ...(animate ? ANIM : {}) });
    },
    [flow],
  );
  const fill = useCallback(
    (animate = true) => {
      viewMode.current = 'fill';
      const b = contentBounds();
      const el = canvasRef.current;
      if (!b || !el) return;
      const z = Math.min(4, Math.max(0.1, Math.max(el.clientWidth / b.width, el.clientHeight / b.height)));
      void flow.setViewport({ zoom: z, x: (el.clientWidth - b.width * z) / 2 - b.x * z, y: (el.clientHeight - b.height * z) / 2 - b.y * z }, animate ? ANIM : undefined);
    },
    [flow, contentBounds],
  );
  const actualSize = useCallback(() => {
    viewMode.current = 'manual';
    const b = contentBounds(true) ?? contentBounds();
    if (b) void flow.setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom: 1, ...ANIM });
    else void flow.zoomTo(1, ANIM);
  }, [flow, contentBounds]);
  const center = useCallback(() => {
    viewMode.current = 'manual';
    const b = contentBounds(true) ?? contentBounds();
    if (b) void flow.setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom: flow.getZoom(), ...ANIM });
  }, [flow, contentBounds]);
  // Quick repeated zoom clicks add up (each starts from the previous target, not the animated value).
  const zoomTarget = useRef<{ zoom: number; at: number } | null>(null);
  const zoomBy = useCallback(
    (factor: number) => {
      viewMode.current = 'manual';
      const now = performance.now();
      const base = zoomTarget.current && now - zoomTarget.current.at < 400 ? zoomTarget.current.zoom : flow.getZoom();
      const next = Math.min(4, Math.max(0.1, base * factor));
      zoomTarget.current = { zoom: next, at: now };
      void flow.zoomTo(next, { duration: 150 });
    },
    [flow],
  );

  // Fit / Fill follow the canvas size (window resize, maximize) until the user zooms or pans.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (viewMode.current === 'fit') fit(false);
        else if (viewMode.current === 'fill') fill(false);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fit, fill, diagram !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = useCallback(
    async (direction: 'DOWN' | 'RIGHT') => {
      await op('auto_layout', { direction });
      setTimeout(() => fit(), 120);
    },
    [op, fit],
  );

  // --- selection & deletion ---------------------------------------------------------
  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    const next = { nodes: ns.map((n) => n.id), edges: es.map((e) => e.id) };
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const setSelected = useCallback((nodeIds: string[], edgeIds: string[] = []) => {
    const ns = new Set(nodeIds);
    const es = new Set(edgeIds);
    selectionRef.current = { nodes: nodeIds, edges: edgeIds };
    setSelection(selectionRef.current);
    setNodes((cur) => cur.map((n) => (n.selected === ns.has(n.id) ? n : { ...n, selected: ns.has(n.id) })));
    setEdges((cur) => cur.map((e) => (e.selected === es.has(e.id) ? e : { ...e, selected: es.has(e.id) })));
  }, []);

  // Live view: select what an agent just changed, bring it into view and outline it briefly.
  useEffect(() => {
    const h = host.highlight;
    if (!h) return;
    const want = new Set(h.refs);
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        const ns = flow.getNodes().filter((n) => want.has(splitId(n.id).ref)).map((n) => n.id);
        const es = flow.getEdges().filter((e) => want.has(splitId(e.id).ref)).map((e) => e.id);
        if (!ns.length && !es.length) return;
        setSelected(ns, es);
        setFlashIds(new Set(ns));
        timers.push(setTimeout(() => center(), 60));
        timers.push(setTimeout(() => setFlashIds(new Set()), 2200));
      }, 150),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.highlight?.seq]);

  /** Selects an element (from the inspector) and brings it into view. */
  const selectRef = useCallback(
    (ref: string) => {
      const id = nodes.some((n) => n.id === `m:${ref}`) ? `m:${ref}` : `l:${ref}`;
      const n = flow.getNode(id);
      if (!n) return;
      setSelected([id]);
      viewMode.current = 'manual';
      void flow.setCenter(n.position.x + (n.width ?? 0) / 2, n.position.y + (n.height ?? 0) / 2, { zoom: Math.max(flow.getZoom(), 0.8), duration: 300 });
    },
    [nodes, flow, setSelected],
  );

  const removeSelected = useCallback(() => {
    const { nodes: ns, edges: es } = selectionRef.current;
    const refs = [...ns, ...es].map((id) => splitId(id).ref);
    if (refs.length) void op('remove_from_diagram', { refs });
  }, [op]);

  const deleteSelectedFromModel = useCallback(() => {
    const all = [...selectionRef.current.nodes, ...selectionRef.current.edges];
    const modelRefs = all.filter((id) => id.startsWith('m:')).map((id) => id.slice(2));
    const localRefs = all.filter((id) => id.startsWith('l:')).map((id) => id.slice(2));
    if (localRefs.length) void op('remove_from_diagram', { refs: localRefs });
    if (modelRefs.length) post({ type: 'deleteFromModel', refs: modelRefs });
  }, [op, post]);

  // Nudging with the arrow keys: moves at once, saves when the keys rest.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>();
  const nudge = useCallback(
    (dx: number, dy: number) => {
      const ids = new Set<string>();
      for (const id of selectionRef.current.nodes) {
        ids.add(id);
        descendants(id).forEach((d) => ids.add(d));
      }
      if (!ids.size) return;
      setNodes((cur) => cur.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)));
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => {
        const moves = flow
          .getNodes()
          .filter((n) => ids.has(n.id))
          .map((n) => ({ id: splitId(n.id).ref, x: Math.round(n.position.x), y: Math.round(n.position.y) }));
        if (moves.length) void op('move_nodes', { nodes: moves });
      }, 400);
    },
    [descendants, flow, op],
  );

  /** Ports, pins and entry / exit points sit on their parent's edge: aligning leaves them there. */
  const onBorder = useCallback((id: string) => laid.get(splitId(id).ref)?.side !== undefined, [laid]);
  /** Selected shapes that can be aligned. */
  const alignable = selection.nodes.filter((id) => !onBorder(id)).length;
  const align = useCallback(
    (mode: AlignMode) => {
      const sel = flow.getNodes().filter((n) => selectionRef.current.nodes.includes(n.id) && !onBorder(n.id));
      if (sel.length < 2) return;
      const moves = alignBoxes(sel.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.width ?? 0, h: n.height ?? 0 })), mode);
      void op('move_nodes', { nodes: moves.map((m) => ({ id: splitId(m.id).ref, x: m.x, y: m.y })) });
    },
    [flow, op, onBorder],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = eventTarget(e);
      // Only keys pressed inside this editor (it may share the page with other content).
      if (canvasRef.current && !rootOf(canvasRef.current).contains(target)) return;
      const typing = target.closest('textarea, select, [contenteditable="true"]') || (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type));
      if (typing) return;
      // View keys work everywhere (also read-only).
      if (e.shiftKey && (e.code === 'Digit1' || e.key === '!')) return e.preventDefault(), fit();
      if (e.shiftKey && (e.code === 'Digit2' || e.key === '@')) return e.preventDefault(), center();
      if (e.shiftKey && (e.code === 'Digit0' || e.key === ')')) return e.preventDefault(), actualSize();
      if (!e.ctrlKey && !e.metaKey && (e.key === '+' || e.key === '=')) return e.preventDefault(), zoomBy(1.25);
      if (!e.ctrlKey && !e.metaKey && (e.key === '-' || e.key === '_')) return e.preventDefault(), zoomBy(1 / 1.25);
      if (e.key === 'Escape') {
        setTool(null);
        setPending(null);
        setMenu(null);
        setConnectMenu(null);
        setSelected([]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(flow.getNodes().map((n) => n.id));
        return;
      }
      if (!editable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (e.shiftKey) deleteSelectedFromModel();
        else removeSelected();
        return;
      }
      const current = selectionRef.current;
      if (e.key === 'F2' && current.nodes.length === 1) setRenaming(current.nodes[0]!);
      const step = (settings.snapToGrid ? settings.gridSize : 1) * (e.shiftKey ? 5 : 1);
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = arrows[e.key];
      if (d && current.nodes.length) {
        e.preventDefault();
        nudge(d[0], d[1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, removeSelected, deleteSelectedFromModel, fit, center, actualSize, zoomBy, flow, setSelected, nudge, settings.snapToGrid, settings.gridSize]);

  // --- adding things ----------------------------------------------------------------
  const uniqueName = (base: string) => {
    const names = new Set(model.elements.map((e) => e.name));
    for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  };

  /** The free spot nearest to `center` where a w x h box overlaps no node (searched in rings). */
  const freeSpot = (c: { x: number; y: number }, w: number, h: number) => {
    const boxes = [...laid.values()].map((n) => n.box);
    const free = (x: number, y: number) => boxes.every((b) => x + w + 20 <= b.x || x >= b.x + b.w + 20 || y + h + 20 <= b.y || y >= b.y + b.h + 20);
    const step = Math.max(settings.gridSize, 20);
    for (let ring = 0; ring < 40; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const x = c.x - w / 2 + dx * step;
          const y = c.y - h / 2 + dy * step;
          if (free(x, y)) return { x, y };
        }
      }
    }
    return { x: c.x - w / 2, y: c.y - h / 2 };
  };

  /**
   * Adds a palette item. Dropped items land where they were dropped (and inside the container
   * there); clicked items go to the nearest free spot around the middle of the view.
   */
  const addItem = async (item: PaletteItem, at: { x: number; y: number }, dropped = false) => {
    if (!diagram || !editable) return;
    const [w, h] = DEFAULT_SIZE[item.source === 'model' && item.lollipop ? 'lollipop' : item.kind] ?? [160, 70];
    const pos = snap(dropped ? { x: at.x - w / 2, y: at.y - h / 2 } : freeSpot(at, w, h));
    const parent = dropped ? containerAt(at, item.source, new Set(), item.kind) : undefined;
    try {
      if (item.source === 'model') {
        const name = uniqueName(item.label.replace(/ \(.*\)$/, ''));
        const result = await runOp<{ id: string }>('add_element', { name, kind: item.kind, x: pos.x, y: pos.y, ...(parent ? { parent } : {}) });
        if (item.lollipop) await runOp('set_node_style', { ref: result.id, style: { notation: 'lollipop' } });
        setRenaming(`m:${result.id}`);
        setSelected([`m:${result.id}`]);
      } else {
        const named = ['state', 'action', 'object', 'partition', 'sendSignal', 'acceptEvent', 'interactionUse', 'interaction', 'acceptTimeEvent'].includes(item.kind);
        const result = await runOp<{ id: string }>('add_local_node', {
          kind: item.kind,
          x: pos.x,
          y: pos.y,
          ...(named ? { name: item.label.replace(/ \(.*\)$/, '') } : {}),
          ...(item.kind === 'note' ? { text: 'Note' } : {}),
          ...(parent ? { parent } : {}),
        });
        if (named || item.kind === 'note') setRenaming(`l:${result.id}`);
        setSelected([`l:${result.id}`]);
      }
    } catch {
      // error toast is shown by the host
    }
  };

  const addExisting = async (id: string, at?: { x: number; y: number }) => {
    if (!editable) return;
    try {
      await runOp('add_to_diagram', { elements: [id] });
      const p = snap(at ? { x: at.x - 80, y: at.y - 35 } : freeSpot(viewCenter(), 160, 70));
      await runOp('move_nodes', { nodes: [{ id, x: p.x, y: p.y }] });
      setSelected([`m:${id}`]);
    } catch {
      // toast
    }
  };

  /** Adds an element related to the selected one, next to it (inspector quick-add). */
  const quickAdd = async (spec: QuickAdd) => {
    const sel = selectionRef.current.nodes[0];
    if (!sel || !diagram || !editable) return;
    const ref = splitId(sel).ref;
    const anchor = laid.get(ref)?.box;
    if (!anchor) return;
    const [w, h] = DEFAULT_SIZE[spec.lollipop ? 'lollipop' : spec.kind] ?? [160, 70];
    const pos = spec.child
      ? snap({ x: anchor.x - w / 2, y: anchor.y + anchor.h / 2 - h / 2 })
      : snap(freeSpot({ x: anchor.x + anchor.w + 90 + w / 2, y: anchor.y + anchor.h / 2 }, w, h));
    try {
      const result = await runOp<{ id: string }>('add_element', { name: uniqueName(spec.name), kind: spec.kind, x: pos.x, y: pos.y, ...(spec.child ? { parent: ref } : {}) });
      if (spec.lollipop) await runOp('set_node_style', { ref: result.id, style: { notation: 'lollipop' } });
      if (spec.rel) {
        const out = spec.rel.dir === 'out';
        await runOp('add_relationship', { kind: spec.rel.kind, from: out ? ref : result.id, to: out ? result.id : ref, ...(spec.rel.stereotype ? { stereotype: spec.rel.stereotype } : {}) });
      }
      setRenaming(`m:${result.id}`);
    } catch {
      // toast
    }
  };

  const viewCenter = () => {
    const el = canvasRef.current!.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND_TYPE);
    if (!raw) return;
    const payload = JSON.parse(raw) as { item?: PaletteItem; existing?: string };
    const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (payload.item) void addItem(payload.item, at, true);
    if (payload.existing) void addExisting(payload.existing, at);
  };

  const changeType = (type: CanvasDiagramType) => void op('update_diagram', { type });

  // --- context menus ------------------------------------------------------------------
  /** The line shape of an edge (flow id) as drawn now. */
  const lineOf = (edgeId: string): LineShape => {
    const { source, ref } = splitId(edgeId);
    const style = source === 'model' ? diagram?.edges.find((x) => x.ref === ref)?.style : diagram?.local.edges.find((x) => x.id === ref)?.style;
    return lineShapeOf(style);
  };
  /** "Line" choices for some edges (flow ids; all lines when undefined); checked when they all have it. */
  const lineItems = (edgeIds: string[] | undefined): MenuItem[] => {
    const ids = edgeIds ?? flow.getEdges().map((x) => x.id);
    const own = (id: string) => {
      const { source, ref } = splitId(id);
      return (source === 'model' ? diagram?.edges.find((x) => x.ref === ref)?.style : diagram?.local.edges.find((x) => x.id === ref)?.style)?.line;
    };
    const set = (line: LineShape | 'auto') => void op('set_line_shape', { ...(edgeIds ? { ids: ids.map((id) => splitId(id).ref) } : {}), line });
    const all = (line: LineShape) => ids.length > 0 && ids.every((id) => own(id) === line);
    const auto = ids.length > 0 && ids.every((id) => !own(id));
    return [
      { label: 'Default (straight)', checked: auto, run: () => set('auto') },
      ...LINE_CHOICES.map((c, i) => ({ sep: i === 0, label: c.label, icon: c.icon, checked: all(c.line), run: () => set(c.line) })),
    ];
  };
  /** Elements related to `ref` in the model that are not on the diagram yet. */
  const relatedMissing = (ref: string) => {
    const on = new Set(diagram?.nodes.map((n) => n.ref));
    const ids = model.relationships.flatMap((r) => (r.from === ref ? [r.to] : r.to === ref ? [r.from] : [])).filter((id) => !on.has(id));
    return [...new Set(ids)];
  };

  const nodeMenu = (e: React.MouseEvent, node: UmlFlowNode) => {
    e.preventDefault();
    if (!selectionRef.current.nodes.includes(node.id)) setSelected([node.id]);
    const items: MenuItem[] = [];
    if (editable) {
      items.push({ label: 'Rename', hint: 'F2', icon: IconRename, run: () => setRenaming(node.id) });
      if (node.data.local?.labelOffset) items.push({ label: 'Reset label position', run: () => onLabelOffset(node.data.ref, null) });
      items.push({ label: 'Remove from diagram', hint: 'Del', icon: IconRemove, run: removeSelected });
      if (node.id.startsWith('m:')) items.push({ label: 'Delete from model', hint: 'Shift+Del', icon: IconTrash, danger: true, run: deleteSelectedFromModel });
      const ref = node.data.ref;
      if (node.data.source === 'model') {
        const missing = relatedMissing(ref);
        if (missing.length) items.push({ sep: true, label: `Add related elements (${missing.length})`, run: () => void op('add_to_diagram', { elements: missing }) });
        if (node.data.element?.kind === 'interface') {
          const ball = node.data.lollipop;
          items.push({ sep: !missing.length, label: ball ? 'Show as box' : 'Show as ball', run: () => void op('set_node_style', { ref, style: ball ? null : { notation: 'lollipop' } }) });
        }
      }
      // The lines of the selected shapes.
      const ids = selectionRef.current.nodes.includes(node.id) ? selectionRef.current.nodes : [node.id];
      const attached = flow.getEdges().filter((x) => ids.includes(x.source) || ids.includes(x.target)).map((x) => x.id);
      if (attached.length) items.push({ sep: true, label: 'Lines', items: lineItems(attached) });
    }
    // Several shapes selected: align and distribute them.
    const ids = selectionRef.current.nodes.includes(node.id) ? selectionRef.current.nodes : [node.id];
    const shapes = ids.filter((id) => !onBorder(id)).length;
    if (editable && shapes >= 2)
      ALIGN_ACTIONS.filter((a) => shapes >= a.needs).forEach((a, i) => items.push({ sep: i === 0, label: a.label, icon: a.icon, run: () => align(a.mode) }));
    const linked = node.data.local?.diagram;
    if (linked) items.unshift({ label: 'Open the linked diagram', icon: IconCenter, run: () => host.openDiagram(linked) });
    const detail = node.data.detail;
    if (detail) items.unshift({ label: 'Open the detail diagram', icon: IconOpen, run: () => host.openDiagram(detail) });
    items.push({ label: 'Center in view', hint: 'Shift+2', icon: IconCenter, run: center });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const edgeMenu = (e: React.MouseEvent, edge: UmlFlowEdge) => {
    e.preventDefault();
    // Right-clicking one of several selected lines acts on all of them.
    const ids = selectionRef.current.edges.includes(edge.id) ? selectionRef.current.edges : [edge.id];
    if (!selectionRef.current.edges.includes(edge.id)) setSelected([], [edge.id]);
    if (!editable) return;
    const items: MenuItem[] = [{ label: 'Line', icon: LINE_CHOICES.find((c) => c.line === lineOf(edge.id))?.icon, items: lineItems(ids) }];
    const bent = ids.filter((id) => flow.getEdge(id)?.data?.waypoints.length);
    if (bent.length) items.push({ label: 'Remove bend points', run: () => bent.forEach((id) => void op('set_edge_waypoints', { id: splitId(id).ref, waypoints: [] })) });
    if (edge.data?.labelOffset) items.push({ label: 'Reset label position', run: () => onLabelOffset(splitId(edge.id).ref, null) });
    const rel = edge.data?.rel;
    if (rel && ids.length === 1 && rel.from !== rel.to) items.push({ label: 'Reverse direction', icon: IconReverse, run: () => void op('update_relationship', { id: rel.id, reverse: true }) });
    items.push({ label: 'Remove from diagram', hint: 'Del', icon: IconRemove, run: removeSelected });
    if (edge.id.startsWith('m:')) items.push({ label: 'Delete from model', hint: 'Shift+Del', icon: IconTrash, danger: true, run: deleteSelectedFromModel });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const paneMenu = (e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: 'Fit', hint: 'Shift+1', icon: IconFit, run: () => fit() },
      { label: 'Actual size', hint: 'Shift+0', icon: IconActualSize, run: actualSize },
    ];
    if (editable) {
      items.push({ label: 'Arrange top to bottom', icon: IconLayoutDown, run: () => void layout('DOWN') });
      items.push({ label: 'Arrange left to right', icon: IconLayoutRight, run: () => void layout('RIGHT') });
      if (diagram?.edges.length || diagram?.local.edges.length) items.push({ sep: true, label: 'All lines', items: lineItems(undefined) });
      const show = diagram?.show ?? {};
      items.push({
        sep: !(diagram?.edges.length || diagram?.local.edges.length),
        label: 'Show',
        items: [
          { label: 'Tagged values', checked: !!show.tags, run: () => void op('update_diagram', { show: { tags: !show.tags } }) },
          { sep: true, label: 'Keywords on all lines', checked: show.keywords === true, run: () => void op('update_diagram', { show: { keywords: true } }) },
          { label: '«use» only on lines without a label', checked: (show.keywords ?? 'auto') === 'auto', run: () => void op('update_diagram', { show: { keywords: 'auto' } }) },
          { label: 'No keywords on lines', checked: show.keywords === false, run: () => void op('update_diagram', { show: { keywords: false } }) },
        ],
      });
      const refs = diagram?.nodes.map((n) => n.ref) ?? [];
      if (refs.length > 1) items.push({ label: 'Add missing relationships', run: () => void op('add_to_diagram', { elements: refs }) });
    }
    items.push({ label: 'Select all', hint: 'Ctrl+A', run: () => setSelected(flow.getNodes().map((n) => n.id)) });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  useEffect(() => {
    if (!menu && !connectMenu) return;
    const close = (e: MouseEvent) => {
      const t = e.composedPath()[0] as Element | undefined;
      if (t?.closest?.('.ctx-menu, .connect-menu')) return;
      setMenu(null);
      setConnectMenu(null);
    };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
    };
  }, [menu, connectMenu]);

  // --- selection details --------------------------------------------------------------
  const selected: Selection = useMemo(() => {
    if (!diagram) return { type: 'none' };
    const all = [...selection.nodes, ...selection.edges];
    if (all.length > 1) return { type: 'multi', count: all.length, nodes: selection.nodes.length };
    const one = all[0];
    if (!one) return { type: 'none' };
    const { source, ref } = splitId(one);
    if (selection.nodes.length === 1) {
      if (source === 'model') {
        const element = model.elements.find((e) => e.id === ref);
        return element ? { type: 'element', element, style: diagram.nodes.find((n) => n.ref === ref)?.style } : { type: 'none' };
      }
      const node = diagram.local.nodes.find((n) => n.id === ref);
      return node ? { type: 'local', node } : { type: 'none' };
    }
    if (source === 'model') {
      const rel = model.relationships.find((r) => r.id === ref);
      return rel ? { type: 'relationship', rel, waypoints: diagram.edges.find((e) => e.ref === ref)?.waypoints.length ?? 0 } : { type: 'none' };
    }
    const edge = diagram.local.edges.find((e) => e.id === ref);
    return edge ? { type: 'localEdge', edge } : { type: 'none' };
  }, [diagram, model, selection]);

  if (text === undefined) return <div className="placeholder">Loading…</div>;

  const onDiagram = new Set(diagram?.nodes.map((n) => n.ref));
  // Existing model elements that fit this diagram type (none for state machines and activities).
  const fitting = new Set(diagram ? PALETTE[diagram.type].filter((i) => i.source === 'model').map((i) => i.kind) : []);
  const existing = model.elements.filter((e) => !onDiagram.has(e.id) && e.kind !== 'port' && fitting.has(e.kind));
  const TypeIcon = diagram ? TYPE_ICONS[diagram.type] : null;
  const connecting = tool !== null;
  // The palette and inspector, drawn here or docked in the Archery sidebar (webview/shared/remote.ts).
  const railProps = (d: NonNullable<typeof diagram>): ComponentProps<typeof Rail> => ({
    type: d.type,
    editable,
    palette: PALETTE[d.type],
    existing,
    tool,
    onTool: (t) => {
      setTool(t);
      setPending(null);
    },
    onType: changeType,
    onAdd: (item) => void addItem(item, viewCenter()),
    onAddExisting: (id) => void addExisting(id),
  });
  const inspectorProps = (d: NonNullable<typeof diagram>): ComponentProps<typeof Inspector> => ({
    selection: selected,
    diagram: d,
    model,
    diagrams: host.diagrams,
    editable,
    op: (name, input) => void op(name, input),
    quickAdd: (spec) => void quickAdd(spec),
    select: selectRef,
    canvasRefs: [...laid.keys()],
    self,
    openDiagram: host.openDiagram,
    align,
    removeSelected,
    deleteSelectedFromModel,
  });

  return (
    <div className="editor">
      <div className="toolbar">
        {TypeIcon && (
          <span className="meta" title={diagram ? TYPE_LABELS[diagram.type] : undefined}>
            <TypeIcon />
          </span>
        )}
        <span className="title">{diagram?.title || 'Untitled diagram'}</span>
        <span className="spacer" />
        {editable && diagram && (
          <>
            <ToolButton title="Arrange automatically, top to bottom" onClick={() => void layout('DOWN')}>
              <IconLayoutDown />
            </ToolButton>
            <ToolButton title="Arrange automatically, left to right" onClick={() => void layout('RIGHT')}>
              <IconLayoutRight />
            </ToolButton>
            <span className="tb-sep" />
          </>
        )}
        {editable && diagram && alignable >= 2 && (
          <span className="tb-group align-group" role="group" aria-label="Align and distribute">
            {ALIGN_ACTIONS.map((a) => (
              <ToolButton key={a.mode} title={`${a.title}${alignable < a.needs ? ` (select ${a.needs} or more)` : ''}`} disabled={alignable < a.needs} onClick={() => align(a.mode)}>
                <a.icon />
              </ToolButton>
            ))}
            <span className="tb-sep" />
          </span>
        )}
        <ToolButton title="Zoom out (-)" onClick={() => zoomBy(1 / 1.25)}>
          <IconZoomOut />
        </ToolButton>
        <button type="button" className="tb zoom" title="Actual size (Shift+0)" onClick={actualSize}>
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton title="Zoom in (+)" onClick={() => zoomBy(1.25)}>
          <IconZoomIn />
        </ToolButton>
        <ToolButton title="Fit: show the whole diagram (Shift+1)" onClick={() => fit()}>
          <IconFit />
        </ToolButton>
        <ToolButton title="Fill: cover the view" onClick={() => fill()}>
          <IconFill />
        </ToolButton>
        <ToolButton title="Actual size, 100% (Shift+0)" onClick={actualSize}>
          <IconActualSize />
        </ToolButton>
        <ToolButton title="Center the selection, or the diagram (Shift+2)" onClick={center}>
          <IconCenter />
        </ToolButton>
        <span className="tb-sep" />
        <ToolButton title="Show grid" on={settings.showGrid} onClick={() => post({ type: 'setting', key: 'showGrid', value: !settings.showGrid })}>
          <IconGrid />
        </ToolButton>
        <ToolButton title="Snap to grid" on={settings.snapToGrid} onClick={() => post({ type: 'setting', key: 'snapToGrid', value: !settings.snapToGrid })}>
          <IconSnap />
        </ToolButton>
        <ToolButton title="Overview map" on={minimap} onClick={() => setMinimap(!minimap)}>
          <IconMinimap />
        </ToolButton>
        <span className="tb-sep" />
        <ToolButton title="Export as SVG" onClick={() => post({ type: 'export', format: 'svg' })}>
          <IconExportSvg />
        </ToolButton>
        <ToolButton title="Export as PNG" onClick={() => post({ type: 'export', format: 'png' })}>
          <IconExportPng />
        </ToolButton>
      </div>
      {parsed && parsed.issues.length > 0 && (
        <div className="banner error">
          {'Invalid diagram:\n'}
          {parsed.issues.map((i) => `• ${i.message}`).join('\n')}
        </div>
      )}
      {host.modelIssues.length > 0 && <div className="banner warning">{host.modelIssues.join('\n')}</div>}
      {!editable && diagram && <div className="banner warning">Read-only</div>}
      {diagram && (
        <div className="workspace">
          <DockPanels panels={{ title: diagram.title || 'Untitled diagram', rail: { component: 'canvasRail', props: railProps(diagram) }, inspector: { component: 'canvasInspector', props: inspectorProps(diagram) } }} />
          {!host.docked && <Rail {...railProps(diagram)} dragData={(e, payload) => e.dataTransfer.setData(DND_TYPE, JSON.stringify(payload))} />}
          {!host.docked && <RailResizer />}
          <div
            ref={canvasRef}
            className={`canvas${connecting ? ' connecting-tool' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={onDrop}
            onPointerMove={(e) => (lastPointer.current = { x: e.clientX, y: e.clientY })}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onPaneClick={() => {
                blurPanel();
                setPending(null);
              }}
              onNodeClick={(_, node) => {
                blurPanel();
                if (!tool || !editable) return;
                // Connect tool: click the source, then the target.
                if (!pending) setPending(node.id);
                else {
                  connect(pending, node.id, tool);
                  setPending(null);
                }
              }}
              onEdgeClick={blurPanel}
              onNodeContextMenu={nodeMenu}
              onEdgeContextMenu={edgeMenu}
              onPaneContextMenu={paneMenu}
              onSelectionChange={onSelectionChange}
              onMoveStart={(event) => {
                // A user zoom / pan leaves Fit / Fill; programmatic moves have no event.
                if (event) viewMode.current = 'manual';
              }}
              connectionMode={ConnectionMode.Loose}
              elevateEdgesOnSelect
              connectionRadius={30}
              nodesDraggable={editable && !connecting}
              nodesConnectable={editable}
              deleteKeyCode={null}
              disableKeyboardA11y
              selectionKeyCode={null}
              multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              panOnDrag={[1]}
              panOnScroll
              zoomOnScroll={false}
              zoomOnPinch
              zoomActivationKeyCode={['Control', 'Meta']}
              snapToGrid={settings.snapToGrid}
              snapGrid={[settings.gridSize, settings.gridSize]}
              fitView
              fitViewOptions={FIT}
              minZoom={0.1}
              maxZoom={4}
              proOptions={{ hideAttribution: true }}
            >
              {settings.showGrid && <Background variant={BackgroundVariant.Dots} gap={settings.gridSize} size={1} />}
              {minimap && <MiniMap pannable zoomable ariaLabel="Overview map" />}
            </ReactFlow>
            {nodes.length === 0 && editable && <div className="empty-hint">Empty diagram</div>}
            {connecting && (
              <div className="tool-hint" role="status">
                {pending ? 'Now click the target' : 'Click the source'} · Esc to stop
              </div>
            )}
            {connectMenu && (
              <div className="connect-menu" style={{ left: connectMenu.x, top: connectMenu.y }}>
                {RELATIONSHIPS.map((r) => {
                  const I = RELATIONSHIP_ICONS[r.kind as RelationshipKind];
                  return (
                    <button
                      type="button"
                      key={r.kind}
                      className="menu-item"
                      title={r.hint}
                      onClick={() => {
                        void op('add_relationship', { kind: r.kind, from: connectMenu.source, to: connectMenu.target });
                        setConnectMenu(null);
                      }}
                    >
                      <I />
                      <span>{r.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
          </div>
          {!host.docked && (
            <aside className="properties">
              <Inspector {...inspectorProps(diagram)} />
            </aside>
          )}
        </div>
      )}
      {host.error && (
        <div className="toast" role="alert" onClick={host.clearError}>
          {host.error}
        </div>
      )}
    </div>
  );
}

export type { CanvasDiagram };
