// Layout of a timing diagram (*.timing.json, UML 2.0 14.4): an "sd" frame with one compartment
// per lifeline (its name, its states and the state timeline, or the compact value lifeline),
// messages between the timelines at points in time, duration and time constraints, and the
// time axis at the bottom.
import type { Model, TimingConstraint, TimingDiagram, TimingLifeline } from '../model/schema';
import { headPath, normalizeWithOffset, polylineD, roundCorners, textWidth, withStyle, type DiagramStyle, type Prim, type Scene } from './scene';
import type { Box } from './sequenceLayout';

export interface TimingHits {
  lifelines: {
    ref: string;
    /** The whole compartment. */
    box: Box;
    /** The name column (drag to reorder, double-click to rename). */
    name: Box;
    /** State rows (state form) with their label boxes; empty for a value lifeline. */
    rows: { state: string; y: number; label: Box }[];
    /** Middle of the timeline (value form) or of the rows. */
    mid: number;
  }[];
  /** `index`: position in the lifeline's `changes`. */
  changes: { ref: string; index: number; x: number; y: number; box: Box }[];
  messages: { index: number; box: Box; label: { x: number; y: number; anchor: 'start' | 'middle' } }[];
  constraints: { index: number; box: Box; label: { x: number; y: number; anchor: 'start' | 'middle' } }[];
  /** The time axis: x0 is time 0, x1 is `end`. */
  axis: { x0: number; x1: number; end: number; tick: number; top: number; bottom: number };
}

const TAG_H = 22;
const CON = 24; // space for constraints at the top of a compartment
const ROW = 24;
const PAD = 8;
const VALUE_H = 22;
const TICK_W = 56;

/** 1, 2 or 5 times a power of ten, at least `raw`. */
export function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) if (m * p >= raw - 1e-9) return m * p;
  return 10 * p;
}

/** Axis end and tick distance (stored or automatic). */
export function timeScale(d: TimingDiagram): { end: number; tick: number } {
  const times = [
    ...d.lifelines.flatMap((l) => l.changes.map((c) => c.at)),
    ...d.messages.flatMap((m) => [m.at, m.arrive ?? m.at]),
    ...d.constraints.flatMap((c) => [c.from, c.to ?? c.from]),
  ];
  const last = Math.max(0, ...times);
  const tick = d.tick ?? niceStep(Math.max(last, d.end ?? 0, 1) / 8);
  const end = d.end ?? Math.max(tick * 4, (Math.floor(last / tick + 1e-9) + 1) * tick);
  return { end, tick };
}

/** The lifeline's rows: its declared states, then states only its changes use. */
export function statesOf(l: TimingLifeline): string[] {
  const out = [...l.states];
  for (const c of l.changes) if (!out.includes(c.state)) out.push(c.state);
  return out;
}

/** Changes in time order, with their index in `changes`. */
export function sortedChanges(l: TimingLifeline): { at: number; state: string; index: number }[] {
  return l.changes.map((c, index) => ({ ...c, index })).sort((a, b) => a.at - b.at || a.index - b.index);
}

/** The state at time t (undefined before the first change). */
export function stateAt(l: TimingLifeline, t: number): string | undefined {
  let s: string | undefined;
  for (const c of sortedChanges(l)) if (c.at <= t + 1e-9) s = c.state;
  return s;
}

export function timingLifelineLabel(l: { ref: string; role?: string }, model: Model): string {
  const name = model.elements.find((e) => e.id === l.ref)?.name ?? l.ref;
  return l.role ? `${l.role} : ${name}` : `:${name}`;
}

/** "{d..3*d}"; a time observation such as "t = now" keeps its own form. */
export function constraintText(c: TimingConstraint): string {
  const t = c.label.trim();
  if (!t) return c.to === undefined ? '{t}' : '{d}';
  if (/^\{.*\}$/.test(t) || /^\w+\s*=\s*now$/.test(t)) return t;
  return `{${t}}`;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function fitText(text: string, width: number, size: number): string {
  if (textWidth(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, size) > width) t = t.slice(0, -1);
  return t.length > 1 ? `${t}…` : '';
}

export function layoutTimingWithHits(d: TimingDiagram, model: Model, ds: DiagramStyle = 'classic'): { scene: Scene; hits: TimingHits } {
  const radius = ds === 'modern' ? 4 : 0;
  const known = new Set(model.elements.map((e) => e.id));
  const { end, tick } = timeScale(d);
  const nameW = Math.max(110, ...d.lifelines.map((l) => textWidth(timingLifelineLabel(l, model), 13, true) + 28));
  const stateW = Math.max(56, ...d.lifelines.flatMap((l) => (l.form === 'value' ? [] : statesOf(l).map((s) => textWidth(s, 12) + 20))));
  const tl0 = nameW + stateW + 12;
  const ticks = Math.ceil(end / tick - 1e-9);
  const W = Math.max(480, ticks * TICK_W);
  const X = (t: number) => tl0 + (Math.min(Math.max(t, 0), end) / end) * W;
  const right = tl0 + W + 28;

  const prims: Prim[] = [];
  const hits: TimingHits = { lifelines: [], changes: [], messages: [], constraints: [], axis: { x0: tl0, x1: tl0 + W, end, tick, top: 0, bottom: 0 } };

  // --- compartments ------------------------------------------------------------------------
  const top = TAG_H + 6;
  let y = top;
  const comps = new Map<string, { l: TimingLifeline; box: Box; rowY: Map<string, number>; mid: number }>();
  for (const l of d.lifelines) {
    if (comps.has(l.ref)) continue;
    const value = l.form === 'value';
    const states = value ? [] : statesOf(l);
    const h = CON + (value ? VALUE_H + 2 * PAD : Math.max(1, states.length) * ROW + PAD);
    const box = { x: 0, y, w: right, h };
    const rowY = new Map(states.map((s, i) => [s, y + CON + i * ROW + ROW / 2]));
    const mid = value ? y + CON + PAD + VALUE_H / 2 : y + CON + (Math.max(1, states.length) * ROW) / 2;
    comps.set(l.ref, { l, box, rowY, mid });
    hits.lifelines.push({
      ref: l.ref,
      box,
      name: { x: 0, y, w: nameW, h },
      rows: states.map((s) => ({ state: s, y: rowY.get(s)!, label: { x: nameW + 4, y: rowY.get(s)! - ROW / 2, w: tl0 - nameW - 8, h: ROW } })),
      mid,
    });
    y += h;
  }
  const bottom = y;
  hits.axis.top = top;
  hits.axis.bottom = bottom;

  // Grid: faint lines at the ticks, behind everything else.
  for (let k = 1; k <= ticks; k++) {
    const x = X(k * tick);
    if (bottom > top) prims.push({ t: 'line', x1: x, y1: top, x2: x, y2: bottom, stroke: 'alt' });
  }

  for (const { l, box, rowY, mid } of comps.values()) {
    prims.push({ t: 'line', x1: 0, y1: box.y, x2: right, y2: box.y, stroke: 'ink' });
    prims.push({ t: 'text', x: 12, y: box.y + box.h / 2 + 5, text: timingLifelineLabel(l, model), bold: true, fill: known.has(l.ref) ? 'ink' : 'error' });
    const changes = sortedChanges(l);
    if (l.form === 'value') {
      // Compact form: a band per value, crossing over at each change.
      const top = mid - VALUE_H / 2;
      const bot = mid + VALUE_H / 2;
      changes.forEach((c, i) => {
        const xa = X(c.at);
        const xb = X(changes[i + 1]?.at ?? end);
        if (xb - xa < 1) return;
        const s = Math.min(5, (xb - xa) / 2);
        prims.push({ t: 'path', d: `M${xa} ${mid} L${xa + s} ${top} L${xb - s} ${top} L${xb} ${mid} L${xb - s} ${bot} L${xa + s} ${bot} Z`, fill: ds === 'modern' ? 'node' : 'surface', stroke: 'ink' });
        const text = fitText(c.state, xb - xa - 2 * s - 6, 12);
        if (text) prims.push({ t: 'text', x: (xa + xb) / 2, y: mid + 4, text, anchor: 'middle', size: 12 });
        hits.changes.push({ ref: l.ref, index: c.index, x: xa, y: mid, box: { x: xa - 6, y: top - 2, w: 12, h: VALUE_H + 4 } });
      });
      if (!changes.length) prims.push({ t: 'line', x1: tl0, y1: mid, x2: X(end), y2: mid, stroke: 'muted', dashed: true });
    } else {
      // State / condition timeline: the states are listed on the left, one row each.
      for (const [state, ry] of rowY) {
        prims.push({ t: 'text', x: tl0 - 10, y: ry + 4, text: state, anchor: 'end', size: 12 });
        prims.push({ t: 'line', x1: tl0, y1: ry, x2: X(end), y2: ry, stroke: 'alt', dashed: true });
      }
      const steps: [number, number][] = [];
      let prevY = 0;
      changes.forEach((c, i) => {
        const x = X(c.at);
        const cy = rowY.get(c.state)!;
        if (i > 0) steps.push([x, prevY]);
        steps.push([x, cy]);
        const y1 = i === 0 ? cy : Math.min(prevY, cy);
        const y2 = i === 0 ? cy : Math.max(prevY, cy);
        hits.changes.push({ ref: l.ref, index: c.index, x, y: cy, box: { x: x - 6, y: y1 - 6, w: 12, h: y2 - y1 + 12 } });
        prevY = cy;
      });
      if (changes.length) {
        steps.push([X(end), prevY]);
        prims.push({ t: 'path', d: polylineD(steps, radius), fill: 'none', stroke: 'ink' });
      }
    }
  }
  if (bottom > top) {
    prims.push({ t: 'line', x1: 0, y1: bottom, x2: right, y2: bottom, stroke: 'ink' });
    prims.push({ t: 'line', x1: nameW, y1: top, x2: nameW, y2: bottom, stroke: 'ink' });
  }

  // --- constraints -----------------------------------------------------------------------------
  d.constraints.forEach((c, index) => {
    const comp = comps.get(c.on);
    if (!comp) return;
    const text = constraintText(c);
    const cy = comp.box.y + 13;
    const tw = textWidth(text, 12);
    if (c.to === undefined) {
      // Time constraint / observation: a mark at the instant, the text beside it.
      const x = X(c.from);
      prims.push({ t: 'line', x1: x, y1: comp.box.y + 4, x2: x, y2: comp.box.y + comp.box.h - 4, stroke: 'muted', dashed: true });
      prims.push({ t: 'line', x1: x - 4, y1: cy, x2: x + 4, y2: cy, stroke: 'ink' });
      prims.push({ t: 'text', x: x + 6, y: cy + 4, text, size: 12, halo: true });
      hits.constraints.push({ index, box: { x: x - 5, y: cy - 10, w: tw + 14, h: 20 }, label: { x: x + 6, y: cy + 4, anchor: 'start' } });
      return;
    }
    // Duration constraint: the interval with arrowheads, the text in the middle.
    const x1 = X(Math.min(c.from, c.to));
    const x2 = X(Math.max(c.from, c.to));
    for (const x of [x1, x2]) prims.push({ t: 'line', x1: x, y1: comp.box.y + 4, x2: x, y2: comp.box.y + comp.box.h - 4, stroke: 'muted', dashed: true });
    prims.push({ t: 'line', x1, y1: cy, x2, y2: cy, stroke: 'ink' });
    if (x2 - x1 > 24) {
      prims.push({ t: 'path', d: headPath('open', x1, cy, -1, 0, ds), fill: 'none', stroke: 'ink' });
      prims.push({ t: 'path', d: headPath('open', x2, cy, 1, 0, ds), fill: 'none', stroke: 'ink' });
    }
    const mx = (x1 + x2) / 2;
    prims.push({ t: 'text', x: mx, y: cy + 4, text, anchor: 'middle', size: 12, halo: true });
    hits.constraints.push({ index, box: { x: Math.min(x1, mx - tw / 2) - 4, y: cy - 10, w: Math.max(x2 - x1, tw) + 8, h: 20 }, label: { x: mx, y: cy + 4, anchor: 'middle' } });
  });

  // --- messages ---------------------------------------------------------------------------------
  const yAt = (ref: string, t: number) => {
    const c = comps.get(ref)!;
    if (c.l.form === 'value') return c.mid;
    const s = stateAt(c.l, t);
    return (s !== undefined ? c.rowY.get(s) : undefined) ?? c.mid;
  };
  d.messages.forEach((m, index) => {
    if ((m.from && !comps.has(m.from)) || (m.to && !comps.has(m.to)) || (!m.from && !m.to)) return;
    const t2 = m.arrive ?? m.at;
    const head = m.kind === 'sync' ? 'filled' : 'open';
    const tw = textWidth(m.label, 12);
    if (m.from && m.from === m.to) {
      // Self message: a loop above the timeline, back to the lifeline.
      const x1 = X(m.at);
      const x2 = X(t2);
      const y1 = yAt(m.from, m.at);
      const y2 = yAt(m.to, t2);
      const top = Math.min(y1, y2) - 16;
      const xr = Math.max(x1, x2) + 26;
      prims.push({ t: 'path', d: polylineD([[x1, y1], [x1, top], [xr, top], [xr, y2], [x2 + 1, y2]], radius ? 6 : 0), fill: 'none', stroke: 'ink', dashed: m.kind === 'reply' });
      prims.push({ t: 'path', d: headPath(head, x2 + 1, y2, -1, 0, ds), fill: head === 'filled' ? 'ink' : 'none', stroke: 'ink' });
      if (m.label) prims.push({ t: 'text', x: xr + 6, y: top + 10, text: m.label, size: 12, halo: true });
      hits.messages.push({ index, box: { x: x1 - 4, y: top - 4, w: xr - x1 + 10 + tw, h: Math.max(y1, y2) - top + 8 }, label: { x: xr + 6, y: top + 10, anchor: 'start' } });
      return;
    }
    // A missing end is a gate on the right edge of the frame.
    const x1 = m.from ? X(m.at) : right;
    const x2 = m.to ? X(t2) : right;
    const y1 = m.from ? yAt(m.from, m.at) : yAt(m.to!, t2) - 16;
    const y2 = m.to ? yAt(m.to, t2) : y1 - 16;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    prims.push({ t: 'line', x1, y1, x2, y2, stroke: 'ink', dashed: m.kind === 'reply' });
    prims.push({ t: 'path', d: headPath(head, x2, y2, ux, uy, ds), fill: head === 'filled' ? 'ink' : 'none', stroke: 'ink' });
    const vertical = Math.abs(x2 - x1) < 30;
    const lx = vertical ? Math.max(x1, x2) + 6 : (x1 + x2) / 2;
    const ly = (y1 + y2) / 2 + (vertical ? 4 : -4);
    if (m.label) prims.push({ t: 'text', x: lx, y: ly, text: m.label, anchor: vertical ? 'start' : 'middle', size: 12, halo: true });
    const bx1 = Math.min(x1, x2, vertical ? lx : lx - tw / 2) - 5;
    const bx2 = Math.max(x1, x2, vertical ? lx + tw : lx + tw / 2) + 5;
    const by1 = Math.min(y1, y2, ly - 12) - 3;
    const by2 = Math.max(y1, y2, ly + 3) + 3;
    hits.messages.push({ index, box: { x: bx1, y: by1, w: bx2 - bx1, h: by2 - by1 }, label: { x: lx, y: ly, anchor: vertical ? 'start' : 'middle' } });
  });

  // --- time axis and frame ----------------------------------------------------------------------
  const ay = bottom + 12;
  prims.push({ t: 'line', x1: tl0, y1: ay, x2: tl0 + W, y2: ay, stroke: 'ink' });
  for (let k = 0; k <= ticks; k++) {
    const t = Math.min(k * tick, end);
    const x = X(t);
    prims.push({ t: 'line', x1: x, y1: ay, x2: x, y2: ay + 5, stroke: 'ink' });
    prims.push({ t: 'text', x, y: ay + 18, text: fmt(t), anchor: 'middle', size: 11, fill: 'muted' });
  }
  if (d.unit) prims.push({ t: 'text', x: tl0 + W + 10, y: ay + 4, text: d.unit, size: 11, fill: 'muted' });
  const frameH = ay + 28;
  const tag = d.title ? `sd ${d.title}` : 'sd';
  const tagW = textWidth(tag, 12, true) + 18;
  prims.unshift({ t: 'rect', x: 0, y: 0, w: right, h: frameH, fill: 'surface', stroke: 'ink' });
  prims.push({ t: 'path', d: `M0 ${TAG_H} L${tagW - 6} ${TAG_H} L${tagW} ${TAG_H - 6} L${tagW} 0`, fill: 'none', stroke: 'ink' });
  prims.push({ t: 'text', x: 8, y: 15, text: tag, size: 12, bold: true });

  const normalized = normalizeWithOffset(roundCorners(prims, ds), 16);
  const scene = withStyle(normalized.scene, ds);
  const { dx, dy } = normalized;
  const mv = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy });
  const mvl = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
  return {
    scene,
    hits: {
      lifelines: hits.lifelines.map((l) => ({ ...l, box: mv(l.box), name: mv(l.name), rows: l.rows.map((r) => ({ ...r, y: r.y + dy, label: mv(r.label) })), mid: l.mid + dy })),
      changes: hits.changes.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy, box: mv(c.box) })),
      messages: hits.messages.map((m) => ({ ...m, box: mv(m.box), label: mvl(m.label) })),
      constraints: hits.constraints.map((c) => ({ ...c, box: mv(c.box), label: mvl(c.label) })),
      axis: { ...hits.axis, x0: hits.axis.x0 + dx, x1: hits.axis.x1 + dx, top: hits.axis.top + dy, bottom: hits.axis.bottom + dy },
    },
  };
}

export function layoutTiming(d: TimingDiagram, model: Model, ds: DiagramStyle = 'classic'): Scene {
  return layoutTimingWithHits(d, model, ds).scene;
}
