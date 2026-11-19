// Communication diagram (UML 2.0, 14.4): the same interaction as a sequence diagram, drawn as
// participants (role : Type boxes) joined by links, with the messages listed along the links.
// Messages are numbered by call nesting (1, 1.1, 1.2, 2, ...); messages inside combined fragments
// carry their guard ("[ok]") or iteration ("*[each item]"). Replies are not drawn (the return is
// implied by the numbering). Positions are automatic unless the diagram stores them.
import type { Message, Model, SequenceDiagram, SequenceStep } from '../model/schema';
import type { Box } from './sequenceLayout';
import { headPath, normalizeWithOffset, roundCorners, textWidth, withStyle, type DiagramStyle, type Prim, type Scene } from './scene';

const BOX_H = 40;
const LINE = 16;

export interface NumberedMessage {
  /** Path of the message step (indices into steps / branches). */
  path: number[];
  msg: Message;
  /** "1.2", "2", ... */
  number: string;
  /** "[ok]" / "*[each item]" from the enclosing fragment, or ''. */
  guard: string;
}

export interface CommunicationHits {
  lifelines: { ref: string; box: Box }[];
  messages: { path: number[]; box: Box; label: { x: number; y: number; anchor: 'start' | 'middle' } }[];
}

/** Decimal sequence numbers by call nesting; replies close the call they answer. */
export function numberMessages(steps: SequenceStep[]): NumberedMessage[] {
  const out: NumberedMessage[] = [];
  const stack: { owner: string; number: string; children: number }[] = [];
  let top = 0;
  const walk = (list: SequenceStep[], prefix: number[], guard: string) => {
    list.forEach((s, i) => {
      const path = [...prefix, i];
      if ('msg' in s) {
        const m = s.msg;
        if (m.kind === 'reply') {
          // Close the activation of the replying participant.
          const at = stack.map((f) => f.owner).lastIndexOf(m.from ?? '');
          if (at >= 0) stack.length = at;
          return;
        }
        if (m.from) while (stack.length && stack.at(-1)!.owner !== m.from) stack.pop();
        const parent = stack.at(-1);
        const number = parent ? `${parent.number}.${++parent.children}` : String(++top);
        out.push({ path, msg: m, number, guard });
        if ((m.kind === 'sync' || m.kind === 'create') && m.to && m.to !== m.from) stack.push({ owner: m.to, number, children: 0 });
        return;
      }
      if ('branches' in s) {
        s.branches.forEach((b, j) => {
          const g = b.guard?.trim();
          const text = s.fragment === 'loop' ? `*[${g || ''}]` : g ? `[${g}]` : '';
          walk(b.steps, [...path, j], text || guard);
        });
      }
    });
  };
  walk(steps, [], '');
  return out;
}

export function lifelineLabel(diagram: SequenceDiagram, model: Model, ref: string): string {
  const e = model.elements.find((x) => x.id === ref);
  const role = diagram.lifelines.find((l) => l.ref === ref)?.role?.trim();
  return role ? `${role} : ${e?.name ?? ref}` : `:${e?.name ?? ref}`;
}

export function layoutCommunication(diagram: SequenceDiagram, model: Model, ds: DiagramStyle = 'classic'): Scene {
  return layoutCommunicationWithHits(diagram, model, ds).scene;
}

export function layoutCommunicationWithHits(diagram: SequenceDiagram, model: Model, ds: DiagramStyle = 'classic'): { scene: Scene; hits: CommunicationHits } {
  const numbered = numberMessages(diagram.steps);
  const refs = diagram.lifelines.map((l) => l.ref);
  for (const n of numbered) for (const id of [n.msg.from, n.msg.to]) if (id && !refs.includes(id)) refs.push(id);
  const actors = new Set(model.elements.filter((e) => e.kind === 'actor').map((e) => e.id));

  // Boxes: stored positions, else on an ellipse (participants in their sequence order).
  const n = refs.length;
  const rx = Math.max(180, n * 70);
  const ry = Math.max(120, n * 42);
  const boxes = new Map<string, Box>();
  refs.forEach((ref, i) => {
    const label = lifelineLabel(diagram, model, ref);
    const w = Math.max(110, textWidth(label, 13, true) + 28);
    const h = actors.has(ref) ? 58 : BOX_H;
    const stored = diagram.positions?.[ref];
    const angle = Math.PI + (2 * Math.PI * i) / Math.max(1, n);
    const cx = stored ? stored.x + w / 2 : rx + rx * Math.cos(angle);
    const cy = stored ? stored.y + h / 2 : ry + ry * Math.sin(angle);
    boxes.set(ref, { x: cx - w / 2, y: cy - h / 2, w, h });
  });
  const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const clip = (b: Box, tx: number, ty: number) => {
    const c = center(b);
    const dx = tx - c.x;
    const dy = ty - c.y;
    if (!dx && !dy) return c;
    const s = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
    return { x: c.x + dx * s, y: c.y + dy * s };
  };

  const prims: Prim[] = [];
  const hits: CommunicationHits = { lifelines: [], messages: [] };
  const labelOf = (m: NumberedMessage) => `${m.number}${m.guard ? ` ${m.guard}` : ''}: ${m.msg.label || (m.msg.kind === 'create' ? '«create»' : m.msg.kind === 'destroy' ? '«destroy»' : '')}`;
  const filled = (m: Message) => m.kind === 'sync' || ((m.kind === 'self' || m.kind === 'lost' || m.kind === 'found') && !m.async);

  // Links between participants that exchange messages, with the messages listed along them.
  const pairs = new Map<string, NumberedMessage[]>();
  for (const m of numbered) {
    const a = m.msg.from;
    const b = m.msg.to;
    if (!a || !b) continue;
    const key = a === b ? `${a}|${a}` : [a, b].sort().join('|');
    pairs.set(key, [...(pairs.get(key) ?? []), m]);
  }
  for (const [key, msgs] of pairs) {
    const [a, b] = key.split('|') as [string, string];
    const ba = boxes.get(a)!;
    if (a === b) {
      // Self link: a loop above the box, messages listed beside it.
      const c = center(ba);
      const top = ba.y;
      prims.push({ t: 'path', d: `M${c.x - 16} ${top} C${c.x - 16} ${top - 34} ${c.x + 16} ${top - 34} ${c.x + 16} ${top}`, fill: 'none', stroke: 'ink' });
      // Stacked upward from the loop, so the first message is on top (they read in number order).
      msgs.forEach((m, i) => listMessage(m, c.x + 24, top - 30 - (msgs.length - 1 - i) * LINE, 1, 0));
      continue;
    }
    const bb = boxes.get(b)!;
    const ca = center(ba);
    const cb = center(bb);
    const p1 = clip(ba, cb.x, cb.y);
    const p2 = clip(bb, ca.x, ca.y);
    prims.push({ t: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: 'ink' });
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const ux = (p2.x - p1.x) / len;
    const uy = (p2.y - p1.y) / len;
    // Normal pointing "up" (or left) so the two directions get opposite sides.
    let nx = -uy;
    let ny = ux;
    if (ny > 0 || (ny === 0 && nx > 0)) {
      nx = -nx;
      ny = -ny;
    }
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const forward = msgs.filter((m) => m.msg.from === a);
    const backward = msgs.filter((m) => m.msg.from === b);
    // Above the link the stack grows upward: reversed, so both sides read top-down in number order.
    forward.forEach((m, i) => {
      const k = forward.length - 1 - i;
      listMessage(m, mid.x + nx * (14 + k * LINE), mid.y + ny * (14 + k * LINE), ux, uy);
    });
    backward.forEach((m, i) => listMessage(m, mid.x - nx * (14 + i * LINE) , mid.y - ny * (14 + i * LINE) + 10, -ux, -uy));
  }

  // Lost / found messages: a short line to a dot (gates: to the frame, drawn below).
  const gates: NumberedMessage[] = [];
  for (const m of numbered) {
    if (m.msg.kind !== 'lost' && m.msg.kind !== 'found') continue;
    if (m.msg.gate) {
      gates.push(m);
      continue;
    }
    const ref = (m.msg.kind === 'lost' ? m.msg.from : m.msg.to)!;
    const b = boxes.get(ref);
    if (!b) continue;
    const x0 = b.x + b.w;
    const y0 = b.y + b.h / 2;
    prims.push({ t: 'line', x1: x0, y1: y0, x2: x0 + 60, y2: y0, stroke: 'ink' });
    prims.push({ t: 'circle', cx: x0 + 64, cy: y0, r: 4, fill: 'ink', stroke: 'ink' });
    listMessage(m, x0 + 10, y0 - 12, m.msg.kind === 'lost' ? 1 : -1, 0);
  }

  function listMessage(m: NumberedMessage, x: number, y: number, ux: number, uy: number) {
    // UML 2.0 14.4: an arrow parallel to the link, pointing to the receiver (filled head: call,
    // open head: asynchronous), next to the sequence-numbered label. Long enough to read as an arrow.
    const ax = x;
    const ay = y - 4;
    const len = 28;
    const tipX = ax + ux * len;
    const tipY = ay + uy * len;
    prims.push({ t: 'line', x1: ax, y1: ay, x2: tipX, y2: tipY, stroke: 'ink' });
    prims.push({ t: 'path', d: headPath(filled(m.msg) ? 'filled' : 'open', tipX, tipY, ux, uy, ds), fill: filled(m.msg) ? 'ink' : 'none', stroke: 'ink' });
    const text = labelOf(m);
    const tx = Math.max(ax, tipX) + 6;
    prims.push({ t: 'text', x: tx, y, text, size: 12 });
    hits.messages.push({ path: m.path, box: { x: Math.min(ax, tipX) - 2, y: y - 14, w: Math.abs(tipX - ax) + 10 + textWidth(text, 12), h: 18 }, label: { x: tx, y, anchor: 'start' } });
  }

  // Participant boxes on top of the links.
  for (const ref of refs) {
    const b = boxes.get(ref)!;
    const label = lifelineLabel(diagram, model, ref);
    if (actors.has(ref)) {
      const c = center(b);
      prims.push({ t: 'circle', cx: c.x, cy: b.y + 5, r: 4.5, fill: 'surface', stroke: 'ink' });
      prims.push({ t: 'line', x1: c.x, y1: b.y + 9.5, x2: c.x, y2: b.y + 20 });
      prims.push({ t: 'line', x1: c.x - 7, y1: b.y + 13, x2: c.x + 7, y2: b.y + 13 });
      prims.push({ t: 'line', x1: c.x, y1: b.y + 20, x2: c.x - 6, y2: b.y + 28 });
      prims.push({ t: 'line', x1: c.x, y1: b.y + 20, x2: c.x + 6, y2: b.y + 28 });
      prims.push({ t: 'text', x: c.x, y: b.y + 44, text: label, anchor: 'middle', bold: true, size: 12 });
    } else {
      prims.push({ t: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, rx: 2, fill: ds === 'modern' ? 'node' : 'surface', stroke: 'ink' });
      prims.push({ t: 'text', x: b.x + b.w / 2, y: b.y + b.h / 2 + 5, text: label, anchor: 'middle', bold: true, fill: model.elements.some((e) => e.id === ref) ? 'ink' : 'error' });
    }
    hits.lifelines.push({ ref, box: b });
  }

  // The frame ("sd name"); messages to / from gates run to its left (in) or right (out) border.
  const inner = normalizeWithOffset(prims, 0);
  const minX = -inner.dx;
  const minY = -inner.dy;
  const fx1 = minX - (gates.some((g) => g.msg.kind === 'found') ? 90 : 24);
  const fx2 = minX + inner.scene.width + (gates.some((g) => g.msg.kind === 'lost') ? 90 : 24);
  const fy1 = minY - 34;
  const fy2 = minY + inner.scene.height + 20;
  const tag = diagram.title ? `sd ${diagram.title}` : 'sd';
  const tagW = textWidth(tag, 12, true) + 18;
  prims.unshift(
    { t: 'rect', x: fx1, y: fy1, w: fx2 - fx1, h: fy2 - fy1, fill: 'none', stroke: 'ink' },
    { t: 'path', d: `M${fx1} ${fy1 + 22} L${fx1 + tagW - 6} ${fy1 + 22} L${fx1 + tagW} ${fy1 + 16} L${fx1 + tagW} ${fy1}`, fill: 'none', stroke: 'ink' },
    { t: 'text', x: fx1 + 8, y: fy1 + 15, text: tag, size: 12, bold: true },
  );
  const gateRows = new Map<string, number>();
  for (const m of gates) {
    const ref = (m.msg.kind === 'lost' ? m.msg.from : m.msg.to)!;
    const b = boxes.get(ref);
    if (!b) continue;
    // Below the lost / found line of the box, one row per gate message.
    const row = gateRows.get(ref) ?? 0;
    gateRows.set(ref, row + 1);
    const y0 = b.y + b.h - 4 + row * 18;
    if (m.msg.kind === 'found') {
      prims.push({ t: 'line', x1: fx1, y1: y0, x2: b.x, y2: y0, stroke: 'ink' });
      listMessage(m, fx1 + 10, y0 + 15, 1, 0);
    } else {
      prims.push({ t: 'line', x1: b.x + b.w, y1: y0, x2: fx2, y2: y0, stroke: 'ink' });
      listMessage(m, b.x + b.w + 10, y0 + 15, 1, 0);
    }
  }

  const normalized = normalizeWithOffset(roundCorners(prims, ds), 24);
  const scene = withStyle(normalized.scene, ds);
  const { dx, dy } = normalized;
  const mv = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy });
  return {
    scene,
    hits: {
      lifelines: hits.lifelines.map((l) => ({ ...l, box: mv(l.box) })),
      messages: hits.messages.map((m) => ({ ...m, box: mv(m.box), label: { ...m.label, x: m.label.x + dx, y: m.label.y + dy } })),
    },
  };
}

/** The scene of an interaction file in the notation it is set to. */
export function layoutInteraction(diagram: SequenceDiagram, model: Model, layoutSequence: (d: SequenceDiagram, m: Model, ds?: DiagramStyle) => Scene, ds: DiagramStyle = 'classic'): Scene {
  return diagram.notation === 'communication' ? layoutCommunication(diagram, model, ds) : layoutSequence(diagram, model, ds);
}
