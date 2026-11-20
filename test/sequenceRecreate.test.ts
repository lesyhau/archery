import { describe, expect, it } from 'vitest';
import type { Model, SequenceDiagram } from '../src/model/schema';
import { layoutSequence, layoutSequenceWithHits } from '../src/render/sequenceLayout';

const model: Model = {
  elements: [
    { id: 'host', kind: 'component', name: 'Host' },
    { id: 'engine', kind: 'component', name: 'Engine' },
  ],
  relationships: [],
};

const diagram: SequenceDiagram = {
  version: 1,
  type: 'sequence',
  title: 'Restart',
  lifelines: [{ ref: 'host' }, { ref: 'engine' }],
  steps: [
    { msg: { from: 'host', to: 'engine', kind: 'sync', label: 'run()' } },
    { msg: { from: 'host', to: 'engine', kind: 'destroy', label: 'shutdown' } },
    { msg: { from: 'host', to: 'engine', kind: 'create', label: 'spawn' } },
    { msg: { from: 'host', to: 'engine', kind: 'sync', label: 'run()' } },
  ],
};

/** The header boxes (rect) and dashed lifeline segments drawn at the column of `x`. */
function partsAt(scene: ReturnType<typeof layoutSequence>, x: number) {
  const heads = scene.prims.filter((p) => p.t === 'rect' && Math.abs(p.x + p.w / 2 - x) < 1 && p.h > 20 && p.w > 60) as Extract<(typeof scene.prims)[number], { t: 'rect' }>[];
  const lines = scene.prims.filter((p) => p.t === 'line' && p.dashed && p.stroke === 'muted' && Math.abs(p.x1 - x) < 1 && Math.abs(p.x2 - x) < 1) as Extract<(typeof scene.prims)[number], { t: 'line' }>[];
  return { heads, lines };
}

describe('sequence: a participant created again after its destruction', () => {
  it('gets a new header at the create message, with no lifeline between the X and it', () => {
    const { scene, hits } = layoutSequenceWithHits(diagram, model);
    const engine = hits.lifelines.find((l) => l.ref === 'engine')!;
    const { heads, lines } = partsAt(scene, engine.x);
    expect(heads).toHaveLength(2);
    expect(lines).toHaveLength(2);
    const [first, second] = [...heads].sort((a, b) => a.y - b.y);
    const [l1, l2] = [...lines].sort((a, b) => a.y1 - b.y1);
    // The first life ends at the X, above the new header; the second starts below it.
    expect(l1!.y2).toBeLessThan(second!.y);
    expect(l2!.y1).toBeGreaterThanOrEqual(second!.y + second!.h - 1);
    expect(first!.y).toBeLessThan(l1!.y1);
    // The create message (the 3rd step) points at the new header.
    const create = hits.steps.find((s) => s.path.join() === '2')!;
    expect(create.y).toBeGreaterThan(second!.y);
    expect(create.y).toBeLessThan(second!.y + second!.h);
    // Still one participant for the editor.
    expect(hits.lifelines.map((l) => l.ref)).toEqual(['host', 'engine']);
  });

  it('keeps one lifeline when it is not destroyed before', () => {
    const plain = { ...diagram, steps: [diagram.steps[0]!, diagram.steps[3]!] };
    const { scene, hits } = layoutSequenceWithHits(plain, model);
    const engine = hits.lifelines.find((l) => l.ref === 'engine')!;
    expect(partsAt(scene, engine.x).heads).toHaveLength(1);
  });

  it('still draws messages to a destroyed participant that is not created again', () => {
    const broken = { ...diagram, steps: [diagram.steps[1]!, diagram.steps[3]!] };
    expect(() => layoutSequence(broken, model)).not.toThrow();
  });
});
