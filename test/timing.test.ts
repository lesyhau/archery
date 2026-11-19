import { describe, expect, it } from 'vitest';
import { parseTimingDiagram } from '../src/model/load';
import type { Model, TimingDiagram } from '../src/model/schema';
import { constraintText, layoutTimingWithHits, niceStep, stateAt, statesOf, timeScale } from '../src/render/timingLayout';
import { scaffold } from '../src/template/scaffold';
import { ArcherySession } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import { validateWorkspace } from '../src/model/validate';
import { diagramUsage } from '../src/model/usage';
import { renameState, withoutLifeline } from '../webview/timing/TimingEditor';
import type { WorkspaceReader } from '../src/model/load';

function memoryReader(files: Map<string, string>): WorkspaceReader {
  return {
    readText: async (path) => files.get(path),
    list: async (dir) =>
      [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
  };
}

const model: Model = {
  elements: [
    { id: 'ui', kind: 'component', name: 'UI' },
    { id: 'svc', kind: 'component', name: 'Service' },
  ],
  relationships: [],
};

const diagram: TimingDiagram = {
  version: 1,
  type: 'timing',
  title: 'Request',
  unit: 'ms',
  lifelines: [
    { ref: 'ui', role: 'page', form: 'value', states: [], changes: [{ at: 0, state: 'Form' }, { at: 40, state: 'Busy' }, { at: 160, state: 'Done' }] },
    { ref: 'svc', states: ['Idle', 'Working'], changes: [{ at: 50, state: 'Working' }, { at: 0, state: 'Idle' }, { at: 150, state: 'Idle' }, { at: 120, state: 'Waiting' }] },
  ],
  messages: [
    { from: 'ui', to: 'svc', at: 40, arrive: 50, label: 'submit()', kind: 'async' },
    { from: 'svc', to: 'ui', at: 150, arrive: 160, label: 'result', kind: 'reply' },
  ],
  constraints: [
    { on: 'svc', from: 50, to: 150, label: '0..100' },
    { on: 'ui', from: 40, label: 't = now' },
  ],
};

describe('timing diagrams', () => {
  it('parses with defaults', () => {
    const p = parseTimingDiagram(JSON.stringify({ version: 1, type: 'timing', lifelines: [{ ref: 'a' }], messages: [{ from: 'a', to: 'a', at: 1 }] }));
    expect(p.value?.lifelines[0]).toEqual({ ref: 'a', states: [], changes: [] });
    expect(p.value?.messages[0]?.kind).toBe('async');
    expect(parseTimingDiagram('{"version":1,"type":"timing","lifelines":[{"ref":"a","changes":[{"at":-1,"state":"x"}]}]}').issues.length).toBeGreaterThan(0);
  });

  it('derives states, the state at a time and the time scale', () => {
    expect(statesOf(diagram.lifelines[1]!)).toEqual(['Idle', 'Working', 'Waiting']);
    expect(stateAt(diagram.lifelines[1]!, 49)).toBe('Idle');
    expect(stateAt(diagram.lifelines[1]!, 50)).toBe('Working');
    expect(stateAt(diagram.lifelines[1]!, -1)).toBeUndefined();
    expect(niceStep(18)).toBe(20);
    expect(niceStep(0.3)).toBe(0.5);
    expect(timeScale(diagram)).toEqual({ end: 180, tick: 20 });
    expect(timeScale({ ...diagram, end: 400, tick: 100 })).toEqual({ end: 400, tick: 100 });
    expect(constraintText({ on: 'x', from: 0, to: 1, label: '0..100' })).toBe('{0..100}');
    expect(constraintText({ on: 'x', from: 0, label: 't = now' })).toBe('t = now');
  });

  it('lays out the frame, lifelines, states, values, messages, constraints and the axis', () => {
    const { scene, hits } = layoutTimingWithHits(diagram, model);
    const texts = scene.prims.filter((p) => p.t === 'text').map((p) => (p as { text: string }).text);
    expect(texts).toEqual(expect.arrayContaining(['sd Request', 'page : UI', ':Service', 'Idle', 'Working', 'Waiting', 'Form', 'Busy', 'Done', 'submit()', 'result', '{0..100}', 't = now', '0', '180', 'ms']));
    expect(hits.lifelines.map((l) => l.ref)).toEqual(['ui', 'svc']);
    expect(hits.lifelines[1]!.rows.map((r) => r.state)).toEqual(['Idle', 'Working', 'Waiting']);
    expect(hits.lifelines[0]!.rows).toEqual([]);
    // Changes are hit in time order; their x follows the axis.
    const svc = hits.changes.filter((c) => c.ref === 'svc');
    expect(svc.map((c) => c.index)).toEqual([1, 0, 3, 2]);
    const x = (t: number) => hits.axis.x0 + (t / hits.axis.end) * (hits.axis.x1 - hits.axis.x0);
    expect(svc[1]!.x).toBeCloseTo(x(50));
    // "Working" is drawn on its row.
    expect(svc[1]!.y).toBeCloseTo(hits.lifelines[1]!.rows[1]!.y);
    expect(hits.messages.map((m) => m.index)).toEqual([0, 1]);
    expect(hits.constraints.map((c) => c.index)).toEqual([0, 1]);
    // Lifelines stack without overlap, inside the scene.
    expect(hits.lifelines[1]!.box.y).toBeCloseTo(hits.lifelines[0]!.box.y + hits.lifelines[0]!.box.h);
    expect(hits.axis.bottom).toBeLessThan(scene.height);
  });

  it('marks lifelines of unknown elements and skips messages to missing lifelines', () => {
    const { scene, hits } = layoutTimingWithHits({ ...diagram, lifelines: [diagram.lifelines[1]!, { ref: 'ghost', states: [], changes: [] }] }, model);
    expect(scene.prims.some((p) => p.t === 'text' && p.text === ':ghost' && p.fill === 'error')).toBe(true);
    expect(hits.messages).toEqual([]);
  });

  it('editor helpers: remove a lifeline with its messages, rename a state', () => {
    const d = withoutLifeline(diagram, 'ui');
    expect(d.lifelines.map((l) => l.ref)).toEqual(['svc']);
    expect(d.messages).toEqual([]);
    expect(d.constraints.map((c) => c.on)).toEqual(['svc']);
    const r = renameState(diagram, 'svc', 'Working', 'Busy');
    expect(r.lifelines[1]!.states).toEqual(['Idle', 'Busy', 'Waiting']);
    expect(r.lifelines[1]!.changes.map((c) => c.state)).toEqual(['Busy', 'Idle', 'Idle', 'Waiting']);
  });
});

describe('timing diagrams: operations', () => {
  async function workspace() {
    const files = scaffold({ system: 'Webshop', includeHelp: false });
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
      const def = TOOLS.find((t) => t.name === name)!;
      const session = await ArcherySession.load(memoryReader(files), '');
      const result = await def.run(session, def.input.parse(args));
      for (const [path, text] of session.changes) files.set(path, text);
      return result;
    };
    return { files, call };
  }

  it('writes, reads, extends, retitles and validates a timing diagram; deleting an element cascades', async () => {
    const { files, call } = await workspace();
    await call('add_element', { name: 'UI', kind: 'component' });
    await call('add_element', { name: 'Service', kind: 'component' });
    const r = await call('write_timing_diagram', {
      title: 'Request timing',
      unit: 'ms',
      lifelines: [{ ref: 'ui', form: 'value', changes: [{ at: 0, state: 'Form' }] }, { ref: 'service', states: ['Idle'], changes: [{ at: 0, state: 'Idle' }] }],
      messages: [{ from: 'ui', to: 'service', at: 10, label: 'go' }],
      constraints: [{ on: 'service', from: 10, to: 20, label: '0..10' }],
    });
    expect(r.file).toContain('request-timing.timing.json');
    const path = 'diagrams/request-timing.timing.json';
    expect(JSON.parse(files.get(path)!).lifelines[0]).toEqual({ ref: 'ui', form: 'value', states: [], changes: [{ at: 0, state: 'Form' }] });
    await expect(call('write_timing_diagram', { title: 'Request timing', lifelines: [] })).rejects.toThrow(/already exists/);
    await expect(call('write_timing_diagram', { title: 'Bad', lifelines: [{ ref: 'ui' }], messages: [{ from: 'ui', to: 'service', at: 0 }] })).rejects.toThrow(/not a lifeline/);

    const got = await call('get_diagram', { diagram: 'request-timing' });
    expect(got.lifelines.map((l: { name: string }) => l.name)).toEqual(['UI', 'Service']);

    await call('add_element', { name: 'Database', kind: 'component', diagram: 'request-timing' });
    expect(JSON.parse(files.get(path)!).lifelines.map((l: { ref: string }) => l.ref)).toEqual(['ui', 'service', 'database']);

    await call('update_diagram', { diagram: 'request-timing', title: 'Renamed' });
    expect(JSON.parse(files.get(path)!).title).toBe('Renamed');
    await expect(call('update_diagram', { diagram: 'request-timing', type: 'class' })).rejects.toThrow(/canvas/);

    expect(diagramUsage(path, files.get(path)!)).toMatchObject({ type: 'timing', refs: ['ui', 'service', 'database'] });
    const { workspace: ws, issues } = await validateWorkspace(memoryReader(files));
    expect(ws.diagrams.find((d) => d.file === path)?.type).toBe('timing');
    expect(issues.filter((i) => i.file === path)).toEqual([]);

    await expect(call('delete_element', { id: 'service' })).rejects.toThrow(/request-timing/);
    await call('delete_element', { id: 'service', cascade: true });
    const after = JSON.parse(files.get(path)!);
    expect(after.lifelines.map((l: { ref: string }) => l.ref)).toEqual(['ui', 'database']);
    expect(after.messages).toEqual([]);
    expect(after.constraints).toEqual([]);
  });
});
