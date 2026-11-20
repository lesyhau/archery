import { describe, expect, it } from 'vitest';
import type { Model, TimingDiagram } from '../src/model/schema';
import { layoutTimingWithHits } from '../src/render/timingLayout';
import { textWidth } from '../src/render/scene';

const model: Model = { elements: [{ id: 'ecu', kind: 'component', name: 'ECU' }], relationships: [] };

const base: TimingDiagram = {
  version: 1,
  type: 'timing',
  title: 'P2',
  unit: 'ms',
  end: 3200,
  lifelines: [{ ref: 'ecu', states: ['Idle', 'Busy'], changes: [{ at: 0, state: 'Idle' }, { at: 10, state: 'Busy' }, { at: 2035, state: 'Idle' }] }],
  messages: [],
  constraints: [
    { on: 'ecu', from: 10, to: 35, label: 'P2 (ECU model session, e.g. ≤ 50 ms)' },
    { on: 'ecu', from: 35, to: 2035, label: 'P2* (≤ 5000 ms)' },
  ],
};

type TextPrim = { t: 'text'; x: number; y: number; text: string; anchor?: string; size?: number };
const texts = (d: TimingDiagram) => layoutTimingWithHits(d, model).scene.prims.filter((p) => p.t === 'text') as TextPrim[];
const span = (p: TextPrim) => {
  const w = textWidth(p.text, p.size ?? 13);
  const x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
  return { x1: x, x2: x + w, y: p.y };
};

describe('timing: constraint labels', () => {
  it('moves a label that does not fit its window to a row above, never cut, never overlapping', () => {
    const all = texts(base);
    const labels = all.filter((p) => p.text.startsWith('{'));
    expect(labels.map((l) => l.text).sort()).toEqual(['{P2 (ECU model session, e.g. ≤ 50 ms)}', '{P2* (≤ 5000 ms)}'].sort());
    const [a, b] = labels.map(span);
    // On different rows, or apart on the same row.
    expect(a!.y !== b!.y || a!.x2 <= b!.x1 || b!.x2 <= a!.x1).toBe(true);
    // The short window's label is above the long window's (which fits on its interval).
    const short = span(labels.find((l) => l.text.startsWith('{P2 '))!);
    const long = span(labels.find((l) => l.text.startsWith('{P2*'))!);
    expect(short.y).toBeLessThan(long.y);
  });

  it('makes the diagram taller for the extra row', () => {
    const one = { ...base, constraints: [base.constraints[1]!] };
    expect(layoutTimingWithHits(base, model).scene.height).toBeGreaterThan(layoutTimingWithHits(one, model).scene.height);
  });

  it('keeps labels that fit in their window on one row', () => {
    const fitting: TimingDiagram = { ...base, constraints: [{ on: 'ecu', from: 0, to: 1500, label: 'a' }, { on: 'ecu', from: 1600, to: 3000, label: 'b' }] };
    const ys = texts(fitting).filter((p) => p.text.startsWith('{')).map((p) => p.y);
    expect(new Set(ys).size).toBe(1);
    const one = { ...fitting, constraints: [fitting.constraints[0]!] };
    expect(layoutTimingWithHits(fitting, model).scene.height).toBe(layoutTimingWithHits(one, model).scene.height);
  });
});
