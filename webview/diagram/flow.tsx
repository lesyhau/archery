// React Flow node and edge components that draw the shared UML shapes (src/render/canvasLayout.ts),
// so the editor looks exactly like the document and the exports.
import {
  Handle,
  NodeResizer,
  Position,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import type { Element, LocalEdge, LocalNode, Relationship } from '../../src/model/schema';
import { detailMarker, edgePoints, elementPrims, lineShapeOf, localEdgePrims, localNodePrims, midpoint, clipTo, moveSegment, relationshipPrims, segmentAxis, type EdgeDraw, type Outline, type Shape } from '../../src/render/canvasLayout';
import { drawPrim } from '../render/SceneSvg';
import { fillShapes, roundCorners, strokeWidthOf, textBox, type DiagramStyle, type Prim } from '../../src/render/scene';

type Point = { x: number; y: number };

export interface UmlNodeData extends Record<string, unknown> {
  /** Element ref (model) or local node id. */
  ref: string;
  source: 'model' | 'local';
  element?: Element;
  local?: LocalNode;
  outline: Outline;
  lollipop: boolean;
  container: boolean;
  subject?: boolean;
  separator?: boolean;
  side?: 'left' | 'right' | 'top' | 'bottom';
  style?: DiagramStyle;
  /** The type of an instance, part or collaboration use. */
  classifier?: Element;
  minW: number;
  minH: number;
  editable: boolean;
  /** Set by the editor: start renaming this node. */
  renaming?: boolean;
  onRename(ref: string, source: 'model' | 'local', name: string | null): void;
  onResize(ref: string, box: { x: number; y: number; w: number; h: number }): void;
  /** Stores a moved label (null: back to its default place). */
  onLabelOffset(ref: string, offset: Point | null): void;
  /** The diagram that shows this element in detail (drawn as the drill-down marker). */
  detail?: string;
  /** Opens a diagram (clicking the drill-down marker). */
  onOpenDiagram(file: string): void;
}

export type UmlFlowNode = Node<UmlNodeData, 'uml'>;

export interface UmlEdgeData extends Record<string, unknown> {
  rel?: Relationship;
  local?: LocalEdge;
  waypoints: { x: number; y: number }[];
  editable: boolean;
  snap(p: { x: number; y: number }): { x: number; y: number };
  onWaypoints(edgeId: string, points: { x: number; y: number }[]): void;
  labelOffset?: Point;
  onLabelOffset(ref: string, offset: Point | null): void;
  style?: DiagramStyle;
  /** Its line shape, sideways shift and label place (edgeLayouts), as in the exports. */
  draw?: EdgeDraw;
}

export type UmlFlowEdge = Edge<UmlEdgeData, 'uml'>;

const NAMELESS = new Set(['initial', 'final', 'activityFinal', 'flowFinal', 'junction', 'fork', 'join', 'history', 'deepHistory', 'terminate']);

/** The text that inline renaming edits. */
function editableText(d: UmlNodeData): string | undefined {
  if (d.element) return d.element.name;
  if (!d.local || NAMELESS.has(d.local.kind)) return undefined;
  return d.local.kind === 'note' ? d.local.text ?? d.local.name ?? '' : d.local.name ?? '';
}

export function UmlNode({ data, selected, width, height }: NodeProps<UmlFlowNode>) {
  const w = width ?? 160;
  const h = height ?? 70;
  const box = { x: 0, y: 0, w, h };
  const label = useLabelDrag(data.local?.labelOffset, (o) => data.onLabelOffset(data.ref, o));
  const local = data.local && { ...data.local, labelOffset: label.offset };
  const raw = data.source === 'model' ? elementPrims(data.element, data.ref, box, { container: data.container, lollipop: data.lollipop, subject: data.subject, classifier: data.classifier }) : localNodePrims(local!, box, data.container, { separator: data.separator, side: data.side });
  const prims = [...fillShapes(roundCorners(raw, data.style), data.style, { container: data.container, external: data.element?.kind === 'externalSystem' }), ...(data.detail ? detailMarker(box, data.detail) : [])];
  const [editing, setEditing] = useState(false);
  const text = editableText(data);
  useEffect(() => {
    if (data.renaming && text !== undefined) setEditing(true);
  }, [data.renaming, text]);

  const commit = (value: string | null) => {
    setEditing(false);
    data.onRename(data.ref, data.source, value);
  };
  const multiline = data.local?.kind === 'note';

  return (
    <div className={`uml-node${selected ? ' selected' : ''}${data.container ? ' container' : ''}`} onDoubleClick={() => data.editable && text !== undefined && setEditing(true)}>
      {data.editable && (
        <NodeResizer
          isVisible={selected}
          minWidth={data.minW}
          minHeight={data.minH}
          keepAspectRatio={data.outline === 'ellipse' && data.local !== undefined}
          onResizeEnd={(_, p) => data.onResize(data.ref, { x: p.x, y: p.y, w: p.width, h: p.height })}
          color="var(--vscode-focusBorder)"
        />
      )}
      <svg className="uml-shape" width={w} height={h} overflow="visible" strokeWidth={strokeWidthOf(data.style)}>
        {prims.map((p, i) => drawPrim(p, i, data.style, data.onOpenDiagram))}
        {data.editable && <LabelHit prims={prims} onPointerDown={label.start} />}
      </svg>
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Handle key={side} id={side} type="source" position={Position[(side.charAt(0).toUpperCase() + side.slice(1)) as 'Top']} className="uml-handle" isConnectable={data.editable} />
      ))}
      {editing && text !== undefined && (
        <RenameBox initial={text} multiline={multiline} onDone={commit} />
      )}
    </div>
  );
}

function RenameBox({ initial, multiline, onDone }: { initial: string; multiline: boolean; onDone(v: string | null): void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = (v: string | null) => onDone(v === null || v.trim() === initial.trim() ? null : v);
  const props = {
    ref,
    className: 'rename nodrag nopan',
    value,
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onBlur: () => done(value),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) {
        e.preventDefault();
        done(value);
      }
    },
  };
  return multiline ? <textarea {...props} rows={3} /> : <input {...props} />;
}

/** Dragging a movable label: the live offset while dragging; stored on release. */
function useLabelDrag(stored: Point | undefined, onDone: (offset: Point | null) => void) {
  const { screenToFlowPosition } = useReactFlow();
  const [live, setLive] = useState<Point | null>(null);
  // Keep the dragged position until the stored one arrives (no jump back in between).
  useEffect(() => setLive(null), [stored?.x, stored?.y]);
  const start = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const from = stored ?? { x: 0, y: 0 };
    const s = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    let current: Point | null = null;
    const move = (ev: PointerEvent) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      if (!current && Math.hypot(p.x - s.x, p.y - s.y) < 2) return;
      current = { x: Math.round(from.x + p.x - s.x), y: Math.round(from.y + p.y - s.y) };
      setLive(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (current) onDone(current.x || current.y ? current : null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { offset: live ?? stored, start };
}

/** A transparent grip over the movable label of a shape or line. */
function LabelHit({ prims, onPointerDown }: { prims: Prim[]; onPointerDown(e: React.PointerEvent): void }) {
  const text = prims.find((p) => p.t === 'text' && p.movable) as Extract<Prim, { t: 'text' }> | undefined;
  if (!text) return null;
  const b = textBox(text);
  return (
    <rect className="label-grip nodrag nopan" x={b.x - 4} y={b.y - 1} width={b.w + 8} height={b.h + 2} rx={3} onPointerDown={onPointerDown}>
      <title>Drag to move the label</title>
    </rect>
  );
}

function shapeOf(node: ReturnType<typeof useInternalNode<UmlFlowNode>>): Shape | undefined {
  if (!node) return undefined;
  const pos = node.internals.positionAbsolute;
  const w = node.width ?? node.measured.width ?? 160;
  const h = node.height ?? node.measured.height ?? 70;
  return { box: { x: pos.x, y: pos.y, w, h }, outline: node.data.outline, lollipop: node.data.lollipop };
}

export function UmlEdge({ id, source, target, data, selected }: EdgeProps<UmlFlowEdge>) {
  const s = shapeOf(useInternalNode<UmlFlowNode>(source));
  const t = shapeOf(useInternalNode<UmlFlowNode>(target));
  const assoc = shapeOf(useInternalNode<UmlFlowNode>(data?.rel?.associationClass ? `m:${data.rel.associationClass}` : ''));
  const { screenToFlowPosition } = useReactFlow();
  const [live, setLive] = useState<{ x: number; y: number }[] | null>(null);
  const label = useLabelDrag(data?.labelOffset, (o) => data?.onLabelOffset(data.rel?.id ?? data.local!.id, o));
  if (!s || !t || !data) return null;
  const waypoints = live ?? data.waypoints;
  const draw: EdgeDraw = { ...data.draw, line: data.draw?.line ?? lineShapeOf((data.rel ? undefined : data.local?.style) ?? undefined, data.style) };
  const prims = data.rel ? relationshipPrims(data.rel, s, t, waypoints, data.style, label.offset, draw) : localEdgePrims({ ...data.local!, waypoints, labelOffset: label.offset }, s, t, data.style, draw);
  // Right-angled lines are edited by dragging their segments; the others by their bend points.
  const rightAngled = draw.line === 'orthogonal' || draw.line === 'horizontalFirst' || draw.line === 'verticalFirst';
  const curved = draw.line === 'curved';
  const points = edgePoints(s, t, waypoints, data.style, draw);
  // A curve is drawn as many short pieces; its handles sit on the line through its bend points.
  const handlePoints: [number, number][] = curved ? [points[0]!, ...waypoints.map((p) => [p.x, p.y] as [number, number]), points.at(-1)!] : points;
  const hit = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  if (assoc) {
    const [mx, my] = midpoint(points);
    const [ex, ey] = clipTo(assoc.box, assoc.outline, mx, my);
    prims.push({ t: 'line', x1: mx, y1: my, x2: ex, y2: ey, stroke: 'ink', dashed: true });
  }

  /** Drags waypoint `index` (inserting a new one first when `insert`). */
  const drag = (e: React.PointerEvent, index: number, insert: boolean) => {
    e.stopPropagation();
    e.preventDefault();
    // An automatic right-angled route keeps its corners: they become the first bend points.
    let current = data.waypoints.length || curved ? [...data.waypoints] : points.slice(1, -1).map(([x, y]) => ({ x, y }));
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    if (insert) current.splice(index, 0, data.snap(screenToFlowPosition(start)));
    const move = (ev: PointerEvent) => {
      // A plain click on a handle does nothing; only a real drag adds or moves a bend point.
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      current = current.map((p, i) => (i === index ? data.snap(screenToFlowPosition({ x: ev.clientX, y: ev.clientY })) : p));
      setLive([...current]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLive(null);
      if (moved) data.onWaypoints(id, current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Modern: drags segment `k` across its direction; the route keeps its right angles. */
  const dragSegment = (e: React.PointerEvent, k: number) => {
    e.stopPropagation();
    e.preventDefault();
    const axis = segmentAxis(points, k);
    const base = points;
    const start = { x: e.clientX, y: e.clientY };
    let current: { x: number; y: number }[] | null = null;
    const move = (ev: PointerEvent) => {
      if (!current && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      const p = data.snap(screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
      current = moveSegment(base, k, axis === 'h' ? p.y : p.x);
      setLive(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLive(null);
      if (current) data.onWaypoints(id, current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** Modern grips: one on each straight segment long enough to grab, dragged across its direction. */
  const segmentGrips = points.slice(0, -1).flatMap(([x1, y1], k) => {
    const [x2, y2] = points[k + 1]!;
    const axis = segmentAxis(points, k);
    if (!axis || Math.hypot(x2 - x1, y2 - y1) < 14) return [];
    const [cx, cy] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const [w, h] = axis === 'h' ? [16, 6] : [6, 16];
    return [
      <rect
        key={`s${k}`}
        className={`segment-grip ${axis}`}
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={3}
        onPointerDown={(ev) => dragSegment(ev, k)}
        onDoubleClick={(ev) => {
          ev.stopPropagation();
          data.onWaypoints(id, []);
        }}
      />,
    ];
  });

  return (
    <g className={`uml-edge${selected ? ' selected' : ''}`}>
      <path d={hit} className="react-flow__edge-interaction" fill="none" stroke="transparent" strokeWidth={14} />
      {selected && <path d={hit} fill="none" className="uml-edge-highlight" strokeWidth={5} />}
      <g strokeWidth={strokeWidthOf(data.style)}>{prims.map((p, i) => drawPrim(p, i, data.style))}</g>
      {data.editable && <LabelHit prims={prims} onPointerDown={label.start} />}
      {selected && data.editable && rightAngled && <g className="nodrag nopan">{segmentGrips}</g>}
      {selected && data.editable && !rightAngled && (
        <g className="nodrag nopan">
          {waypoints.map((p, i) => (
            <circle
              key={`w${i}`}
              className="waypoint"
              cx={p.x}
              cy={p.y}
              r={5}
              onPointerDown={(e) => drag(e, i, false)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                data.onWaypoints(id, data.waypoints.filter((_, j) => j !== i));
              }}
            />
          ))}
          {handlePoints.slice(0, -1).map(([x1, y1], i) => {
            const [x2, y2] = handlePoints[i + 1]!;
            return (
              <circle key={`a${i}`} className="waypoint-add" cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r={4} onPointerDown={(e) => drag(e, i, true)}>
                <title>Drag to add a bend point</title>
              </circle>
            );
          })}
        </g>
      )}
    </g>
  );
}
