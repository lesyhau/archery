// Automatic layout of a sequence diagram (*.seq.json): lifelines in columns, one row per
// message, activation bars, combined fragments (all UML operators), interaction uses (ref),
// notes, constraints, created/destroyed participants and lost/found messages.
import type { Message, Model, SequenceDiagram, SequenceStep } from '../model/schema';
import { headPath, normalizeWithOffset, polylineD, roundCorners, textWidth, withStyle, type DiagramStyle, type Prim, type Scene } from './scene';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where things are in a laid-out sequence diagram (scene coordinates), for an interactive editor. */
export interface SequenceHits {
  lifelines: { ref: string; x: number; head: Box; y1: number; y2: number }[];
  /** `path`: indices into steps / branches, e.g. [2] or [3, 0, 1] (step 3, operand 0, step 1). */
  steps: { path: number[]; kind: 'msg' | 'fragment' | 'ref' | 'note' | 'constraint'; box: Box; y: number; label?: { x: number; y: number; anchor: 'start' | 'middle' } }[];
  /** Operands of combined fragments: path = [...fragment path, operand index]. */
  operands: { path: number[]; box: Box }[];
  /** Below the last step. */
  bottom: number;
}

const HEADER_H = 40;
const ROW = 34;
const SELF_ROW = 46;
const MIN_GAP = 150;
const ACT_W_CLASSIC = 10;
const LOST_LEN = 70;

interface Column {
  ref: string;
  name: string;
  actor: boolean;
  width: number;
  x: number;
}

function messageLabel(m: Message): string {
  if (m.kind === 'create' && !m.label) return '«create»';
  if (m.kind === 'destroy' && !m.label) return '«destroy»';
  return m.label;
}

/** All messages, in order. */
export function flattenMessages(steps: SequenceStep[], out: Message[] = []): Message[] {
  for (const s of steps) {
    if ('msg' in s) out.push(s.msg);
    else if ('branches' in s) s.branches.forEach((b) => flattenMessages(b.steps, out));
  }
  return out;
}

function involved(steps: SequenceStep[], acc = new Set<string>()): Set<string> {
  for (const s of steps) {
    if ('msg' in s) {
      if (s.msg.from) acc.add(s.msg.from);
      if (s.msg.to) acc.add(s.msg.to);
    } else if ('branches' in s) s.branches.forEach((b) => involved(b.steps, acc));
    else s.over.forEach((id) => acc.add(id));
  }
  return acc;
}

export function layoutSequence(diagram: SequenceDiagram, model: Model, ds: DiagramStyle = 'classic'): Scene {
  return layoutSequenceWithHits(diagram, model, ds).scene;
}

export function layoutSequenceWithHits(diagram: SequenceDiagram, model: Model, ds: DiagramStyle = 'classic'): { scene: Scene; hits: SequenceHits } {
  // Modern: narrower solid activation bars.
  const ACT_W = ds === 'modern' ? 6 : ACT_W_CLASSIC;
  const hits: SequenceHits = { lifelines: [], steps: [], operands: [], bottom: 0 };
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const messages = flattenMessages(diagram.steps);
  const refs = [...diagram.lifelines.map((l) => l.ref)];
  for (const m of messages) for (const id of [m.from, m.to]) if (id && !refs.includes(id)) refs.push(id);

  const roles = new Map(diagram.lifelines.map((l) => [l.ref, l.role]));
  const columns: Column[] = refs.map((ref) => {
    const e = elements.get(ref);
    const role = roles.get(ref)?.trim();
    const name = role ? `${role} : ${e?.name ?? ref}` : `:${e?.name ?? ref}`;
    return { ref, name, actor: e?.kind === 'actor', width: Math.max(110, textWidth(name, 13, true) + 28), x: 0 };
  });
  const index = new Map(columns.map((c, i) => [c.ref, i]));

  // Column positions: wide enough for the headers, then widened for message labels.
  columns.forEach((c, i) => {
    c.x = i === 0 ? c.width / 2 + (messages.some((m) => m.kind === 'found' && m.to === c.ref) ? LOST_LEN : 0) : columns[i - 1]!.x + Math.max(MIN_GAP, (columns[i - 1]!.width + c.width) / 2 + 30);
  });
  const shiftFrom = (i: number, dx: number) => columns.slice(i).forEach((c) => (c.x += dx));
  for (const m of messages) {
    const label = textWidth(messageLabel(m), 12) + 36;
    const a = m.from ? index.get(m.from) : undefined;
    const b = m.to ? index.get(m.to) : undefined;
    if (a === undefined || b === undefined || a === b) {
      // Self, lost and found messages stick out to one side of their lifeline.
      const i = a ?? b!;
      const next = columns[i + 1];
      const need = label + (a === b ? 30 : LOST_LEN);
      if (next && next.x - columns[i]!.x < need) shiftFrom(i + 1, need - (next.x - columns[i]!.x));
      continue;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const span = columns[hi]!.x - columns[lo]!.x;
    if (span < label) shiftFrom(hi, label - span);
  }
  const xOf = (ref: string) => columns[index.get(ref)!]!.x;

  // Participants created by a message get their header at that message; destroyed ones end there.
  // A participant created again after its destruction starts a new life: a new header at that create
  // message, and no line between the X and it. `start`: the header's message y (undefined: at the top).
  const firstUse = new Map<string, Message>();
  for (const m of messages) for (const id of [m.from, m.to]) if (id && !firstUse.has(id)) firstUse.set(id, m);
  const lives = new Map<string, { start?: number; end?: number }[]>();
  const lifeOf = (ref: string) => {
    let list = lives.get(ref);
    if (!list) lives.set(ref, (list = [{}]));
    return list.at(-1)!;
  };

  const prims: Prim[] = [];
  const top = 0;
  let y = top + HEADER_H + 30;

  // --- activations ---
  const open = new Map<string, number[]>(); // lifeline -> start y of open activations (stack)
  const activations: { ref: string; y1: number; y2: number; depth: number }[] = [];
  const lastUse = new Map<string, number>();
  const depthOf = (ref: string) => open.get(ref)?.length ?? 0;
  const activate = (ref: string, at: number) => {
    const stack = open.get(ref) ?? [];
    stack.push(at);
    open.set(ref, stack);
  };
  const deactivate = (ref: string, at: number) => {
    const stack = open.get(ref);
    const start = stack?.pop();
    if (start !== undefined) activations.push({ ref, y1: start, y2: at, depth: stack!.length });
  };
  /** Where an arrow meets a lifeline: the edge of its activation bar, if any. */
  const edgeX = (ref: string, towards: number) => {
    const x = xOf(ref);
    const d = depthOf(ref);
    if (d === 0) return x;
    const half = ACT_W / 2 + (d - 1) * (ACT_W / 2);
    return towards > x ? x + half : x - half;
  };

  let lastLabel: { x: number; y: number; anchor: 'start' | 'middle' } | undefined;
  /** Messages to / from gates on the frame: drawn once the frame is known. `hit`: index in hits.steps. */
  const gates: { y: number; x: number; side: 'left' | 'right'; m: Message; head: 'filled' | 'open'; hit: number }[] = [];
  const arrow = (x1: number, x2: number, at: number, m: Message, dashed: boolean, head: 'filled' | 'open') => {
    lastLabel = { x: (x1 + x2) / 2, y: at - 6, anchor: 'middle' };
    const dir = x2 > x1 ? 1 : -1;
    const tip = x2 - dir * 1;
    prims.push({ t: 'line', x1, y1: at, x2: tip, y2: at, stroke: 'ink', dashed });
    prims.push({ t: 'path', d: headPath(head, tip, at, dir, 0, ds), fill: head === 'filled' ? 'ink' : 'none', stroke: 'ink' });
    const label = messageLabel(m);
    if (label) prims.push({ t: 'text', x: (x1 + x2) / 2, y: at - 6, text: label, anchor: 'middle', size: 12 });
  };

  /** Draws a message and returns its hit box (y = the arrow's y). */
  const drawMessage = (m: Message): { box: Box; y: number; label?: { x: number; y: number; anchor: 'start' | 'middle' } } => {
    const y0 = y;
    const span = (a: number, b: number, h = 26, top = y0 - 18) => ({ box: { x: Math.min(a, b) - 4, y: top, w: Math.abs(b - a) + 8, h }, y: y0, label: lastLabel });
    lastLabel = undefined;
    const dashed = m.kind === 'reply' || m.kind === 'create';
    const head = m.kind === 'sync' || ((m.kind === 'self' || m.kind === 'found' || m.kind === 'lost') && !m.async) ? 'filled' : 'open';
    for (const id of [m.from, m.to]) if (id) lastUse.set(id, y);

    if (m.kind === 'found' && m.to) {
      const xt = xOf(m.to);
      const x0 = xt - LOST_LEN - 30;
      activate(m.to, y);
      if (m.gate) {
        gates.push({ y, x: edgeX(m.to, x0), side: 'left', m, head, hit: hits.steps.length });
        y += ROW;
        return span(x0 - 6, xt);
      }
      prims.push({ t: 'circle', cx: x0, cy: y, r: 5, fill: 'ink', stroke: 'ink' });
      arrow(x0 + 5, edgeX(m.to, x0), y, m, false, head);
      y += ROW;
      return span(x0 - 6, xt);
    }
    if (m.kind === 'lost' && m.from) {
      const xs = edgeX(m.from, Infinity);
      const x1 = xOf(m.from) + LOST_LEN + 30;
      if (m.gate) {
        gates.push({ y, x: xs, side: 'right', m, head, hit: hits.steps.length });
        y += ROW;
        return span(xs, x1 + 6);
      }
      arrow(xs, x1 - 5, y, m, false, head);
      prims.push({ t: 'circle', cx: x1, cy: y, r: 5, fill: 'ink', stroke: 'ink' });
      y += ROW;
      return span(xs, x1 + 6);
    }
    const from = m.from!;
    const to = m.to!;
    if (from === to) {
      const x1 = edgeX(from, Infinity);
      const w = 34;
      activate(to, y + 22);
      const x2 = edgeX(to, Infinity);
      prims.push({ t: 'path', d: polylineD([[x1, y], [x1 + w, y], [x1 + w, y + 22], [x2 + 2, y + 22]], ds === 'modern' ? 6 : 0), fill: 'none', stroke: 'ink', dashed });
      prims.push({ t: 'path', d: headPath(head, x2 + 1, y + 22, -1, 0, ds), fill: head === 'filled' ? 'ink' : 'none', stroke: 'ink' });
      const label = messageLabel(m);
      if (label) prims.push({ t: 'text', x: x1 + w + 6, y: y + 14, text: label, size: 12 });
      lastLabel = { x: x1 + w + 6, y: y + 14, anchor: 'start' };
      deactivate(to, y + 34);
      y += SELF_ROW;
      return span(x1, x1 + w + 10 + textWidth(label || 'message', 12), 34, y0 - 6);
    }
    const xFrom = xOf(from);
    const xTo = xOf(to);
    const recreated = m.kind === 'create' && firstUse.get(to) !== m && lifeOf(to).end !== undefined;
    if (recreated) lives.get(to)!.push({ start: y });
    if ((m.kind === 'create' && firstUse.get(to) === m) || recreated) {
      // The created participant's header sits on the arrow.
      lifeOf(to).start = y;
      const col = columns[index.get(to)!]!;
      arrow(edgeX(from, xTo), xTo - (xTo > xFrom ? col.width / 2 : -col.width / 2), y, m, true, 'open');
      y += ROW + 10;
      return span(xFrom, xTo);
    }
    if (m.kind === 'reply') {
      arrow(edgeX(from, xTo), edgeX(to, xFrom), y, m, true, 'open');
      deactivate(from, y);
    } else {
      arrow(edgeX(from, xTo), xTo + (xTo > xFrom ? -1 : 1) * (depthOf(to) > 0 ? ACT_W / 2 : 0), y, m, dashed, head);
      if (m.kind === 'sync') activate(to, y);
      if (m.kind === 'async') activations.push({ ref: to, y1: y, y2: y + 18, depth: depthOf(to) });
    }
    if (m.kind === 'destroy') {
      prims.push({ t: 'path', d: `M${xTo - 8} ${y + 4} L${xTo + 8} ${y + 20} M${xTo + 8} ${y + 4} L${xTo - 8} ${y + 20}`, fill: 'none', stroke: 'ink' });
      lifeOf(to).end = y + 12;
      open.delete(to);
      y += 8;
    }
    y += ROW;
    return span(xFrom, xTo);
  };

  const extent = (ids: Set<string>, depth: number): [number, number] => {
    const xs = [...ids].filter((id) => index.has(id)).map(xOf);
    const all = xs.length > 0 ? xs : columns.map((c) => c.x);
    const pad = 64 - depth * 10;
    let right = Math.max(...all) + pad;
    for (const id of ids) if (index.has(id)) right = Math.max(right, xOf(id) + 60);
    return [Math.min(...all) - pad, right];
  };

  const walk = (steps: SequenceStep[], depth: number, prefix: number[] = []) => {
    for (const [i, s] of steps.entries()) {
      const path = [...prefix, i];
      if ('msg' in s) {
        const hit = drawMessage(s.msg);
        hits.steps.push({ path, kind: 'msg', ...hit });
        continue;
      }
      if ('note' in s) {
        const [x1, x2] = extent(new Set(s.over), depth + 2);
        const w = Math.max(x2 - x1, textWidth(s.note, 12) + 24);
        const x = (x1 + x2) / 2 - w / 2;
        prims.push({ t: 'path', d: `M${x} ${y - 14} L${x + w - 10} ${y - 14} L${x + w} ${y - 4} L${x + w} ${y + 12} L${x} ${y + 12} Z`, fill: 'alt', stroke: 'ink' });
        prims.push({ t: 'text', x: x + 10, y: y + 3, text: s.note, size: 12 });
        hits.steps.push({ path, kind: 'note', box: { x, y: y - 14, w, h: 26 }, y, label: { x: x + 10, y: y + 3, anchor: 'start' } });
        y += ROW;
        continue;
      }
      if ('constraint' in s) {
        const xs = s.over.filter((id) => index.has(id)).map(xOf);
        const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
        const text = `{${s.constraint}}`;
        const tw = textWidth(text, 12);
        prims.push({ t: 'text', x, y: y - 2, text, size: 12, italic: true, halo: true, anchor: 'middle' });
        hits.steps.push({ path, kind: 'constraint', box: { x: x - tw / 2 - 4, y: y - 16, w: tw + 8, h: 20 }, y, label: { x, y: y - 2, anchor: 'middle' } });
        y += ROW - 8;
        continue;
      }
      if (s.fragment === 'ref') {
        const [x1, x2] = extent(new Set(s.over), depth + 1);
        prims.push({ t: 'rect', x: x1, y: y - 16, w: x2 - x1, h: 30, fill: 'surface', stroke: 'ink' });
        prims.push({ t: 'path', d: `M${x1} ${y - 2} L${x1 + 30} ${y - 2} L${x1 + 36} ${y - 8} L${x1 + 36} ${y - 16}`, fill: 'none', stroke: 'ink' });
        prims.push({ t: 'text', x: x1 + 6, y: y - 4, text: 'ref', size: 11, bold: true });
        prims.push({ t: 'text', x: (x1 + x2) / 2, y: y + 4, text: s.label, anchor: 'middle', size: 12 });
        hits.steps.push({ path, kind: 'ref', box: { x: x1, y: y - 16, w: x2 - x1, h: 30 }, y, label: { x: (x1 + x2) / 2, y: y + 4, anchor: 'middle' } });
        y += ROW + 6;
        continue;
      }
      // Combined fragment: alt, opt, loop, par, break, critical, neg, strict, seq, ignore, consider, assert
      const [x1, x2] = extent(involved([s]), depth);
      const frameTop = y - 18;
      // loop(min,max): the iteration bounds (max "*" = unlimited).
      const operator = s.fragment === 'loop' && (s.min !== undefined || s.max !== undefined) ? `loop(${s.min ?? 0}${s.max !== undefined ? `,${s.max}` : ''})` : s.fragment;
      const tabW = textWidth(operator, 11, true) + 22;
      y += 30; // room for the operator tab and the first guard
      const separators: number[] = [];
      s.branches.forEach((branch, b) => {
        if (b > 0) {
          separators.push(y - 20);
          y += 6;
        }
        if (branch.guard) prims.push({ t: 'text', x: x1 + (b === 0 ? tabW + 8 : 8), y: b === 0 ? frameTop + 15 : y - 6, text: `[${branch.guard}]`, size: 12, italic: true });
        if (b > 0 && branch.guard) y += 8;
        walk(branch.steps, depth + 1, [...path, b]);
        if (branch.steps.length === 0) y += 10;
      });
      const frameBottom = y - 12;
      hits.steps.push({ path, kind: 'fragment', box: { x: x1, y: frameTop, w: x2 - x1, h: frameBottom - frameTop }, y: frameTop, label: { x: x1 + 6, y: frameTop + 15, anchor: 'start' } });
      s.branches.forEach((_, b) => {
        const top = b === 0 ? frameTop + 20 : separators[b - 1]!;
        const end = separators[b] ?? frameBottom;
        hits.operands.push({ path: [...path, b], box: { x: x1, y: top, w: x2 - x1, h: end - top } });
      });
      prims.unshift({ t: 'rect', x: x1, y: frameTop, w: x2 - x1, h: frameBottom - frameTop, fill: 'none', stroke: 'ink' });
      prims.push({ t: 'path', d: `M${x1} ${frameTop + 20} L${x1 + tabW - 6} ${frameTop + 20} L${x1 + tabW} ${frameTop + 14} L${x1 + tabW} ${frameTop}`, fill: 'none', stroke: 'ink' });
      prims.push({ t: 'text', x: x1 + 6, y: frameTop + 15, text: operator, size: 11, bold: true });
      for (const sy of separators) prims.push({ t: 'line', x1, y1: sy, x2, y2: sy, stroke: 'ink', dashed: true });
      y += 16;
    }
  };
  walk(diagram.steps, 0);
  const bottom = y;

  // Close activations that never got a reply at the lifeline's last use.
  for (const [ref, stack] of open) {
    while (stack.length > 0) deactivate(ref, Math.max((lastUse.get(ref) ?? y) + 14, stack.at(-1)! + 20));
  }

  // Lifelines and activation bars go underneath messages.
  const under: Prim[] = [];
  hits.bottom = bottom;
  const headTopOf = (life: { start?: number }) => (life.start !== undefined ? life.start - (HEADER_H - 6) / 2 : top);
  for (const c of columns) {
    const all = lives.get(c.ref) ?? [{}];
    // One hit per participant: the first header, the line down to the end of its last life.
    const firstTop = headTopOf(all[0]!);
    hits.lifelines.push({
      ref: c.ref,
      x: c.x,
      head: c.actor ? { x: c.x - Math.max(24, textWidth(c.name, 12, true) / 2 + 4), y: firstTop - 2, w: Math.max(48, textWidth(c.name, 12, true) + 8), h: 44 } : { x: c.x - c.width / 2, y: firstTop, w: c.width, h: HEADER_H - 6 },
      y1: firstTop + HEADER_H - 6,
      y2: all.at(-1)!.end ?? bottom,
    });
    for (const life of all) drawLife(c, headTopOf(life), life.end ?? bottom);
  }
  function drawLife(c: Column, headTop: number, end: number) {
    under.push({ t: 'line', x1: c.x, y1: headTop + HEADER_H - (c.actor ? 0 : 6), x2: c.x, y2: end, stroke: 'muted', dashed: true });
    if (c.actor) {
      const s = 26;
      const hy = headTop;
      under.push({ t: 'circle', cx: c.x, cy: hy + 4, r: 4.5, fill: 'surface', stroke: 'ink' });
      under.push({ t: 'line', x1: c.x, y1: hy + 8.5, x2: c.x, y2: hy + 18 });
      under.push({ t: 'line', x1: c.x - 7, y1: hy + 12, x2: c.x + 7, y2: hy + 12 });
      under.push({ t: 'line', x1: c.x, y1: hy + 18, x2: c.x - 6, y2: hy + s });
      under.push({ t: 'line', x1: c.x, y1: hy + 18, x2: c.x + 6, y2: hy + s });
      under.push({ t: 'text', x: c.x, y: hy + s + 12, text: c.name, anchor: 'middle', bold: true, size: 12 });
    } else {
      under.push({ t: 'rect', x: c.x - c.width / 2, y: headTop, w: c.width, h: HEADER_H - 6, rx: 2, fill: ds === 'modern' ? 'node' : 'surface', stroke: 'ink' });
      under.push({ t: 'text', x: c.x, y: headTop + HEADER_H / 2 + 1, text: c.name, anchor: 'middle', bold: true, fill: elements.has(c.ref) ? 'ink' : 'error' });
    }
  }
  for (const a of activations.sort((p, q) => p.depth - q.depth)) {
    const x = xOf(a.ref) - ACT_W / 2 + a.depth * (ACT_W / 2);
    under.push({ t: 'rect', x, y: a.y1, w: ACT_W, h: Math.max(8, a.y2 - a.y1), fill: ds === 'modern' ? 'ink' : 'surface', stroke: 'ink' });
  }
  // The interaction's frame ("sd name") around everything, and the gate messages to its border.
  const inner = normalizeWithOffset([...under, ...prims], 0);
  const minX = -inner.dx;
  const minY = -inner.dy;
  const fx1 = minX - 24;
  const fx2 = minX + inner.scene.width + 24;
  const fy1 = minY - 34;
  const fy2 = minY + inner.scene.height + 16;
  const tag = diagram.title ? `sd ${diagram.title}` : 'sd';
  const tagW = textWidth(tag, 12, true) + 18;
  under.unshift(
    { t: 'rect', x: fx1, y: fy1, w: fx2 - fx1, h: fy2 - fy1, fill: 'none', stroke: 'ink' },
    { t: 'path', d: `M${fx1} ${fy1 + 22} L${fx1 + tagW - 6} ${fy1 + 22} L${fx1 + tagW} ${fy1 + 16} L${fx1 + tagW} ${fy1}`, fill: 'none', stroke: 'ink' },
    { t: 'text', x: fx1 + 8, y: fy1 + 15, text: tag, size: 12, bold: true },
  );
  for (const g of gates) {
    const [x1, x2] = g.side === 'left' ? [fx1, g.x] : [g.x, fx2];
    // Both point right: from the left gate in, or out to the right gate.
    const tip = x2 - 1;
    prims.push({ t: 'line', x1, y1: g.y, x2: tip, y2: g.y, stroke: 'ink' });
    prims.push({ t: 'path', d: headPath(g.head, tip, g.y, 1, 0, ds), fill: g.head === 'filled' ? 'ink' : 'none', stroke: 'ink' });
    const label = messageLabel(g.m);
    if (label) prims.push({ t: 'text', x: (x1 + x2) / 2, y: g.y - 6, text: label, anchor: 'middle', size: 12 });
    const hit = hits.steps[g.hit];
    if (hit) {
      hit.box = { x: Math.min(x1, x2) - 4, y: g.y - 18, w: Math.abs(x2 - x1) + 8, h: 26 };
      hit.label = { x: (x1 + x2) / 2, y: g.y - 6, anchor: 'middle' };
    }
  }

  const { scene, dx, dy } = normalizeWithOffset(roundCorners([...under, ...prims], ds));
  const mv = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy });
  return {
    scene: withStyle(scene, ds),
    hits: {
      lifelines: hits.lifelines.map((l) => ({ ...l, x: l.x + dx, head: mv(l.head), y1: l.y1 + dy, y2: l.y2 + dy })),
      steps: hits.steps.map((h) => ({ ...h, box: mv(h.box), y: h.y + dy, label: h.label && { ...h.label, x: h.label.x + dx, y: h.label.y + dy } })),
      operands: hits.operands.map((o) => ({ ...o, box: mv(o.box) })),
      bottom: hits.bottom + dy,
    },
  };
}
