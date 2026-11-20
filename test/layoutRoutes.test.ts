// Agent report, round 2: auto_layout drew lines through shapes and left labels on top of each other
// (N-7, M-5), and validate said nothing about the lines.
import { describe, expect, it } from 'vitest';
import { scaffold } from '../src/template/scaffold';
import { ArcherySession, DELETED } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import type { WorkspaceReader } from '../src/model/load';

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
    expect(await warnings(/runs through/)).toEqual([expect.stringMatching(/^The line of rxThreads-busDrivers runs through scheduler \(100, 260, \d+x\d+\)/)]);
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
