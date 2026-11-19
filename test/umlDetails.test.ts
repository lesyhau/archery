import { describe, expect, it } from 'vitest';
import type { CanvasDiagram, Model, SequenceDiagram, TimingDiagram } from '../src/model/schema';
import { parseTimingDiagram } from '../src/model/load';
import { layoutCanvas, layoutNodes, minSize } from '../src/render/canvasLayout';
import { layoutCommunication } from '../src/render/communicationLayout';
import { layoutSequenceWithHits } from '../src/render/sequenceLayout';
import { layoutTimingWithHits } from '../src/render/timingLayout';

const texts = (scene: { prims: { t: string; text?: string }[] }) => scene.prims.filter((p) => p.t === 'text').map((p) => p.text);
const EMPTY: Model = { elements: [], relationships: [] };
const local = (nodes: CanvasDiagram['local']['nodes'], edges: CanvasDiagram['local']['edges'] = [], type: CanvasDiagram['type'] = 'state'): CanvasDiagram => ({ version: 1, type, title: 'T', nodes: [], edges: [], local: { nodes, edges } });

describe('state machines: regions and entry / exit points', () => {
  it('orthogonal regions fill their state, stacked, with dashed separators after the first', () => {
    const d = local([
      { id: 's', kind: 'state', name: 'S', x: 0, y: 0, w: 300, h: 200 },
      { id: 'r1', kind: 'region', name: 'a', x: 30, y: 40, w: 100, h: 60, parent: 's' },
      { id: 'r2', kind: 'region', x: 30, y: 120, w: 100, h: 60, parent: 's' },
      { id: 'in', kind: 'state', name: 'In', x: 60, y: 140, parent: 'r2' },
      { id: 'e', kind: 'entryPoint', name: 'go', x: 120, y: 90, parent: 's' },
      { id: 'x', kind: 'exitPoint', x: 200, y: 90, parent: 's' },
    ]);
    const nodes = layoutNodes(d, EMPTY);
    const s = nodes.get('s')!.box;
    const r1 = nodes.get('r1')!;
    const r2 = nodes.get('r2')!;
    expect([r1.box.x, r1.box.w, r2.box.x, r2.box.w]).toEqual([s.x, s.w, s.x, s.w]);
    expect(r1.box.y).toBe(s.y + 28);
    expect(r1.box.y + r1.box.h).toBe(r2.box.y);
    expect(r2.box.y + r2.box.h).toBe(s.y + s.h);
    expect([r1.separator, r2.separator]).toEqual([false, true]);
    // The state with "In" stays inside its region.
    const inner = nodes.get('in')!.box;
    expect(inner.y).toBeGreaterThanOrEqual(r2.box.y);
    // Entry / exit points sit on the state's border, not inside it.
    const onBorder = (b: { x: number; y: number; w: number; h: number }) =>
      [b.x + b.w / 2 - s.x, b.x + b.w / 2 - (s.x + s.w), b.y + b.h / 2 - s.y, b.y + b.h / 2 - (s.y + s.h)].some((v) => Math.abs(v) < 0.5);
    expect(onBorder(nodes.get('e')!.box)).toBe(true);
    expect(onBorder(nodes.get('x')!.box)).toBe(true);
    const scene = layoutCanvas(d, EMPTY);
    expect(scene.prims.some((p) => p.t === 'line' && p.dashed)).toBe(true);
    expect(texts(scene)).toEqual(expect.arrayContaining(['S', 'a', 'In', 'go']));
  });
});

describe('activities: pins, time events, interruptible regions', () => {
  it('pins on actions, the hourglass, the dashed region and the lightning-bolt edge', () => {
    const d = local(
      [
        { id: 'ir', kind: 'interruptibleRegion', x: 0, y: 0, w: 300, h: 120 },
        { id: 'a', kind: 'action', name: 'Charge', x: 20, y: 30, parent: 'ir' },
        { id: 'p', kind: 'pin', name: 'amount', x: 15, y: 50, parent: 'a' },
        { id: 't', kind: 'acceptTimeEvent', name: 'after 30 min', x: 220, y: 40, parent: 'ir' },
        { id: 'c', kind: 'action', name: 'Cancel', x: 220, y: 260 },
      ],
      [{ id: 'i', kind: 'interrupt', from: 't', to: 'c', waypoints: [] }],
      'activity',
    );
    const nodes = layoutNodes(d, EMPTY);
    expect(nodes.get('a')!.container).toBe(false); // pins do not make the action a container
    const a = nodes.get('a')!.box;
    const p = nodes.get('p')!.box;
    expect(Math.abs(p.x + p.w / 2 - a.x)).toBeLessThan(0.5);
    const scene = layoutCanvas(d, EMPTY);
    expect(texts(scene)).toEqual(expect.arrayContaining(['amount', 'after 30 min', 'Charge', 'Cancel']));
    expect(scene.prims.some((x) => x.t === 'rect' && x.dashed && x.rx === 10)).toBe(true);
    const paths = scene.prims.filter((x) => x.t === 'path').map((x) => (x as { d: string }).d);
    expect(paths.some((dd) => (dd.match(/L/g) ?? []).length >= 5)).toBe(true);
  });
});

describe('use cases: extension points and «extend» conditions', () => {
  it('draws the extension points compartment and the condition note', () => {
    const m: Model = {
      elements: [
        { id: 'u', kind: 'usecase', name: 'Place order', extensionPoints: ['payment failed'] },
        { id: 'r', kind: 'usecase', name: 'Retry payment' },
      ],
      relationships: [{ id: 'x', kind: 'dependency', from: 'r', to: 'u', stereotype: 'extend', condition: 'card declined', extensionPoint: 'payment failed' }],
    };
    const d: CanvasDiagram = { version: 1, type: 'context', title: 'U', nodes: [{ ref: 'u', x: 0, y: 0 }, { ref: 'r', x: 400, y: 0 }], edges: [{ ref: 'x', waypoints: [] }], local: { nodes: [], edges: [] } };
    expect(texts(layoutCanvas(d, m))).toEqual(expect.arrayContaining(['Place order', 'extension points', 'payment failed', '«extend»', 'Condition: {card declined}', 'extension point: payment failed']));
    const [w, h] = minSize(m.elements[0]);
    expect(h).toBeGreaterThan(60);
    expect(w).toBeGreaterThanOrEqual(150);
  });
});

describe('interactions: sd frame, gates, loop(min,max)', () => {
  const m: Model = { elements: [{ id: 'a', kind: 'component', name: 'A' }, { id: 'b', kind: 'component', name: 'B' }], relationships: [] };
  const d: SequenceDiagram = {
    version: 1,
    type: 'sequence',
    title: 'Gates',
    lifelines: [{ ref: 'a' }, { ref: 'b' }],
    steps: [
      { msg: { to: 'a', label: 'request', kind: 'found', gate: true } },
      { fragment: 'loop', min: 1, max: 3, branches: [{ guard: 'retry', steps: [{ msg: { from: 'a', to: 'b', label: 'try()', kind: 'sync' } }] }] },
      { msg: { from: 'b', label: 'event', kind: 'lost', gate: true } },
    ],
  };

  it('sequence: frame, gate messages to its border, loop bounds', () => {
    const { scene, hits } = layoutSequenceWithHits(d, m);
    expect(texts(scene)).toEqual(expect.arrayContaining(['sd Gates', 'loop(1,3)', 'request', 'event']));
    expect(scene.prims.some((p) => p.t === 'circle')).toBe(false); // gates, not lost / found dots
    const frame = scene.prims.find((p) => p.t === 'rect' && p.fill === 'none' && p.x === Math.min(...scene.prims.filter((q) => q.t === 'rect').map((q) => (q as { x: number }).x))) as { x: number; w: number };
    const lines = scene.prims.filter((p) => p.t === 'line') as { x1: number; x2: number }[];
    expect(lines.some((l) => Math.abs(l.x1 - frame.x) < 0.5)).toBe(true);
    expect(lines.some((l) => Math.abs(l.x2 + 1 - (frame.x + frame.w)) < 0.5)).toBe(true);
    expect(hits.steps.find((s) => s.path.join() === '0')!.box.x).toBeLessThan(hits.lifelines[0]!.x - 40);
  });

  it('communication: the same gates and the frame', () => {
    expect(texts(layoutCommunication({ ...d, notation: 'communication' }, m))).toEqual(expect.arrayContaining(['sd Gates', '1: request', '2.1: event']));
  });

  it('timing: self messages loop, missing ends are gates on the frame', () => {
    const t: TimingDiagram = {
      version: 1,
      type: 'timing',
      title: 'T',
      unit: 'ms',
      lifelines: [{ ref: 'a', states: ['Idle', 'Busy'], changes: [{ at: 0, state: 'Idle' }, { at: 10, state: 'Busy' }] }],
      messages: [
        { from: 'a', to: 'a', at: 10, arrive: 20, label: 'tick()', kind: 'sync' },
        { to: 'a', at: 5, label: 'start', kind: 'async' },
        { from: 'a', at: 30, label: 'done', kind: 'async' },
      ],
      constraints: [],
    };
    const { scene, hits } = layoutTimingWithHits(t, m);
    expect(texts(scene)).toEqual(expect.arrayContaining(['tick()', 'start', 'done']));
    expect(hits.messages.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(parseTimingDiagram(JSON.stringify({ version: 1, type: 'timing', messages: [{ at: 1 }] })).issues.length).toBeGreaterThan(0);
  });
});
