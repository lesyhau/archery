// Immutable edits of a sequence diagram's step tree, addressed by paths:
// [i] = top-level step i; [i, b, j] = step j in operand b of the fragment at step i.
// A container path is [] (the top level) or [...fragmentPath, operandIndex].
import type { FragmentOperator, SequenceStep } from '../../src/model/schema';

export type Path = number[];
type Fragment = Extract<SequenceStep, { branches: unknown }>;

const isFragment = (s: SequenceStep | undefined): s is Fragment => !!s && 'branches' in s;

export const samePath = (a: Path, b: Path) => a.length === b.length && a.every((x, i) => x === b[i]);
export const parentOf = (p: Path): Path => p.slice(0, -1);

/** The list a container path points to. */
export function listAt(steps: SequenceStep[], container: Path): SequenceStep[] {
  let list = steps;
  for (let i = 0; i < container.length; i += 2) {
    const f = list[container[i]!];
    if (!isFragment(f)) return [];
    list = f.branches[container[i + 1]!]?.steps ?? [];
  }
  return list;
}

export function stepAt(steps: SequenceStep[], path: Path): SequenceStep | undefined {
  return listAt(steps, parentOf(path))[path.at(-1)!];
}

/** Replaces the list at a container path. */
function withList(steps: SequenceStep[], container: Path, fn: (list: SequenceStep[]) => SequenceStep[]): SequenceStep[] {
  if (container.length === 0) return fn(steps);
  const [i, b, ...rest] = container as [number, number, ...number[]];
  return steps.map((s, k) => {
    if (k !== i || !isFragment(s)) return s;
    return { ...s, branches: s.branches.map((br, j) => (j === b ? { ...br, steps: withList(br.steps, rest, fn) } : br)) };
  });
}

export const insertAt = (steps: SequenceStep[], container: Path, index: number, step: SequenceStep) =>
  withList(steps, container, (list) => [...list.slice(0, index), step, ...list.slice(index)]);

export const replaceAt = (steps: SequenceStep[], path: Path, step: SequenceStep) => withList(steps, parentOf(path), (list) => list.map((s, i) => (i === path.at(-1) ? step : s)));

export const removeAt = (steps: SequenceStep[], path: Path) => withList(steps, parentOf(path), (list) => list.filter((_, i) => i !== path.at(-1)));

/** Removes several steps (deepest and last first, so earlier paths stay valid). */
export function removeMany(steps: SequenceStep[], paths: Path[]): SequenceStep[] {
  const sorted = [...paths].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
    return b.length - a.length;
  });
  return sorted.reduce((acc, p) => removeAt(acc, p), steps);
}

/** Moves a step up (-1) or down (+1) among its siblings; returns the new path. */
export function moveWithin(steps: SequenceStep[], path: Path, delta: number): { steps: SequenceStep[]; path: Path } {
  const container = parentOf(path);
  const list = listAt(steps, container);
  const i = path.at(-1)!;
  const j = i + delta;
  if (j < 0 || j >= list.length) return { steps, path };
  const next = withList(steps, container, (l) => {
    const copy = [...l];
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    return copy;
  });
  return { steps: next, path: [...container, j] };
}

/** Wraps sibling steps (contiguous, same container) into a combined fragment; returns its path. */
export function wrap(steps: SequenceStep[], paths: Path[], operator: FragmentOperator = 'opt'): { steps: SequenceStep[]; path: Path } | null {
  if (paths.length === 0) return null;
  const container = parentOf(paths[0]!);
  if (!paths.every((p) => samePath(parentOf(p), container))) return null;
  const idx = paths.map((p) => p.at(-1)!).sort((a, b) => a - b);
  const from = idx[0]!;
  const to = idx.at(-1)!;
  const list = listAt(steps, container);
  const inner = list.slice(from, to + 1);
  const fragment: SequenceStep = { fragment: operator, branches: [{ guard: '', steps: inner }] } as SequenceStep;
  return { steps: withList(steps, container, (l) => [...l.slice(0, from), fragment, ...l.slice(to + 1)]), path: [...container, from] };
}

/** Replaces a fragment by the steps of its operands. */
export function unwrap(steps: SequenceStep[], path: Path): SequenceStep[] {
  const f = stepAt(steps, path);
  if (!isFragment(f)) return steps;
  const inner = f.branches.flatMap((b) => b.steps);
  const i = path.at(-1)!;
  return withList(steps, parentOf(path), (l) => [...l.slice(0, i), ...inner, ...l.slice(i + 1)]);
}

/** Every step path in reading order. */
export function allPaths(steps: SequenceStep[], prefix: Path = []): Path[] {
  const out: Path[] = [];
  steps.forEach((s, i) => {
    const p = [...prefix, i];
    out.push(p);
    if (isFragment(s)) s.branches.forEach((b, j) => out.push(...allPaths(b.steps, [...p, j])));
  });
  return out;
}
