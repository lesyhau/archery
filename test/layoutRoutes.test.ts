// Agent report, round 2: auto_layout drew lines through shapes and left labels on top of each other
// (N-7, M-5), and validate said nothing about the lines. Round 3: see below.
import { describe, expect, it } from 'vitest';
import { scaffold } from '../src/template/scaffold';
import { ArcherySession, DELETED } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import type { WorkspaceReader } from '../src/model/load';
import { relationshipLabel } from '../src/render/canvasLayout';
import { drawnEdges, segmentCrossesBox } from '../src/render/layoutLint';

function memoryReader(files: Map<string, string>): WorkspaceReader {
  return {
    readText: async (path) => files.get(path),
    list: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
  };
}

async function workspace() {
  const files = scaffold({ system: 'Bench', includeHelp: false });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const def = TOOLS.find((t) => t.name === name)!;
    const session = await ArcherySession.load(memoryReader(files), 'docs/architecture');
    const result = await def.run(session, def.input.parse(args));
    for (const [path, text] of session.changes) text === DELETED ? files.delete(path) : files.set(path, text);
    return result;
  };
  const warnings = async (pattern: RegExp) =>
    ((await call('validate')).problems as { message: string }[]).map((p) => p.message).filter((m) => pattern.test(m));
  return { files, call, warnings };
}

/** The engine of the report: threads inside their process, one line skipping the thread between. */
async function engine(call: (name: string, args?: Record<string, unknown>) => Promise<any>) {
  await call('add_element', { id: 'engine', name: 'Engine process (x86)', kind: 'component' });
  const parts = [
    ['rxThreads', 'RX threads'],
    ['scheduler', 'TX and scheduler thread'],
    ['busDrivers', 'Bus drivers'],
  ];
  for (const [id, name] of parts) await call('add_element', { id, name, kind: 'component', parent: 'engine' });
  await call('add_relationship', { kind: 'usage', from: 'rxThreads', to: 'scheduler', label: 'queues frames' });
  await call('add_relationship', { kind: 'usage', from: 'scheduler', to: 'busDrivers', label: 'sends' });
  await call('add_relationship', { kind: 'usage', from: 'rxThreads', to: 'busDrivers', label: 'polls' });
  await call('create_diagram', { title: 'Engine', name: 'engine', type: 'component', elements: ['engine', 'rxThreads', 'scheduler', 'busDrivers'] });
}

describe('lines through shapes (N-7)', () => {
  it('are reported by validate with coordinates', async () => {
    const { call, warnings } = await workspace();
    await engine(call);
    // One column: the line from the first to the last thread runs through the one in between.
    await call('move_nodes', {
      diagram: 'engine',
      nodes: [
        { id: 'rxThreads', x: 100, y: 100 },
        { id: 'scheduler', x: 100, y: 260 },
        { id: 'busDrivers', x: 100, y: 420 },
      ],
    });
    expect(await warnings(/runs through (?!the label)/)).toEqual([expect.stringMatching(/^The line of rxThreads-busDrivers runs through scheduler \(100, 260, \d+x\d+\)/)]);
  });

  it('are routed around the shape by auto_layout', async () => {
    const { call, warnings } = await workspace();
    await engine(call);
    for (const direction of ['DOWN', 'RIGHT']) {
      await call('auto_layout', { diagram: 'engine', direction });
      expect(await warnings(/runs through/), direction).toEqual([]);
      const d = await call('get_diagram', { diagram: 'engine' });
      expect(d.edges.find((e: any) => e.ref === 'rxThreads-busDrivers').waypoints?.length, direction).toBeGreaterThan(0);
      // Lines with nothing in the way stay straight.
      expect(d.edges.find((e: any) => e.ref === 'rxThreads-scheduler').waypoints, direction).toBeUndefined();
    }
  });
});

describe('labels after auto_layout (M-5)', () => {
  it('cover no shape and no other label', async () => {
    const { call, warnings } = await workspace();
    await call('add_element', { id: 'service', name: 'Service', kind: 'component' });
    const parts = ['Engine host', 'Seed-key DLL', 'Case store', 'Report writer', 'Bus monitor'];
    for (const name of parts) await call('add_element', { name, kind: 'component' });
    const ids = ['engineHost', 'seedKeyDll', 'caseStore', 'reportWriter', 'busMonitor'];
    const labels = ['seed → key', 'append records', 'load cases and steps', 'write the run report', 'stream bus frames'];
    for (const [i, id] of ids.entries()) {
      await call('add_relationship', { kind: 'usage', from: 'service', to: id, label: labels[i] });
      await call('add_relationship', { kind: 'usage', from: id, to: 'service', label: `${labels[i]} done` });
    }
    await call('create_diagram', { title: 'Hub', name: 'hub', type: 'component', elements: ['service', ...ids] });
    for (const direction of ['DOWN', 'RIGHT']) {
      await call('auto_layout', { diagram: 'hub', direction });
      expect(await warnings(/label/), direction).toEqual([]);
    }
  });
});

// Round 3 of the report: a routed line started inside its own box (N-8), a line through another
// line's label went unreported (N-9), and «use» was on every usage line (L-7).
describe('routed lines and their ends (N-8)', () => {
  it('are reported when a bend point lies inside an end', async () => {
    const { call, warnings } = await workspace();
    await engine(call);
    await call('move_nodes', {
      diagram: 'engine',
      nodes: [
        { id: 'rxThreads', x: 100, y: 100 },
        { id: 'scheduler', x: 100, y: 260 },
        { id: 'busDrivers', x: 100, y: 420 },
      ],
    });
    // A lane left of the scheduler that starts in the middle of the RX threads box.
    await call('set_edge_waypoints', { diagram: 'engine', id: 'rxThreads-busDrivers', waypoints: [{ x: 150, y: 130 }, { x: 60, y: 130 }, { x: 60, y: 450 }] });
    expect(await warnings(/own end/)).toEqual([expect.stringMatching(/^The line of rxThreads-busDrivers runs back across its own end rxThreads \(100, 100, /)]);
  });

  it('leave and enter their ends through the border after auto_layout', async () => {
    const { call, warnings } = await workspace();
    await engine(call);
    // A source wider than the shape in the way: a lane beside that shape passes under the source.
    await call('update_element', { id: 'rxThreads', technology: 'TIME_CRITICAL priority, pinned to core 2, lock-free ring buffers' });
    for (const direction of ['DOWN', 'RIGHT']) {
      await call('auto_layout', { diagram: 'engine', direction });
      expect(await warnings(/runs through (?!the label)|own end/), direction).toEqual([]);
      const d = await call('get_diagram', { diagram: 'engine' });
      const box = d.nodes.find((n: any) => n.ref === 'rxThreads');
      const inside = (p: { x: number; y: number }) => p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h;
      expect(d.edges.find((e: any) => e.ref === 'rxThreads-busDrivers').waypoints.filter(inside), direction).toEqual([]);
    }
  });
});

describe('lines through labels (N-9)', () => {
  /** Two lines crossing in the middle: the label of one sits on the other. */
  async function cross(call: (name: string, args?: Record<string, unknown>) => Promise<any>) {
    for (const id of ['left', 'right', 'top', 'bottom']) await call('add_element', { id, name: id, kind: 'component' });
    await call('add_relationship', { kind: 'usage', from: 'left', to: 'right', label: 'sends the frames' });
    await call('add_relationship', { kind: 'usage', from: 'top', to: 'bottom', label: 'reads' });
    await call('create_diagram', { title: 'Cross', name: 'cross', type: 'component', elements: ['left', 'right', 'top', 'bottom'] });
    await call('move_nodes', {
      diagram: 'cross',
      nodes: [
        { id: 'left', x: 40, y: 200, w: 120, h: 60 },
        { id: 'right', x: 440, y: 200, w: 120, h: 60 },
        { id: 'top', x: 240, y: 40, w: 120, h: 60 },
        { id: 'bottom', x: 240, y: 360, w: 120, h: 60 },
      ],
    });
  }

  it('are reported by validate', async () => {
    const { call, warnings } = await workspace();
    await cross(call);
    // The label is placed off the crossing where it can be; pin it there to see the warning.
    await call('set_label_offset', { diagram: 'cross', id: 'left-right', offset: { x: 1, y: 0 } });
    const found = await warnings(/the label of/);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatch(/^The line of top-bottom runs through the label of left-right \(\d+, \d+, \d+x\d+\)/);
  });

  it('are avoided when labels are placed, and by auto_layout', async () => {
    const { files, call, warnings } = await workspace();
    await cross(call);
    // Measured, not only validated: no label has another line through it.
    const session = await ArcherySession.load(memoryReader(files), 'docs/architecture');
    const edges = drawnEdges(session.canvasDiagram('diagrams/cross.uml.json'), session.model());
    for (const e of edges) {
      for (const o of edges) {
        if (o === e) continue;
        expect(o.points.slice(1).some((q, i) => segmentCrossesBox(o.points[i]!, q, e.labelBox!, 1)), `${o.id} through the label of ${e.id}`).toBe(false);
      }
    }
    expect(await warnings(/the label of/)).toEqual([]);
    for (const direction of ['DOWN', 'RIGHT']) {
      await call('auto_layout', { diagram: 'cross', direction });
      expect(await warnings(/label/), direction).toEqual([]);
    }
  });
});

describe('relationship keywords (L-7)', () => {
  const rel = (kind: string, label?: string) => ({ id: 'r', kind, from: 'a', to: 'b', label }) as any;
  it('show «use» only on a line without a label by default', () => {
    expect(relationshipLabel(rel('usage', 'calls'))).toBe('calls');
    expect(relationshipLabel(rel('usage'))).toBe('«use»');
    expect(relationshipLabel(rel('deploy', 'on boot'))).toBe('«deploy» on boot');
    expect(relationshipLabel({ ...rel('usage', 'calls'), stereotype: 'async' })).toBe('«async» calls');
    expect(relationshipLabel(rel('usage', 'calls'), true)).toBe('«use» calls');
    expect(relationshipLabel(rel('usage'), false)).toBe('');
  });
});
