// Static rendering of a canvas diagram (*.uml.json): UML shapes for model elements
// (components, ports, interfaces as boxes or lollipops, actors, use cases, nodes, packages,
// artifacts, classes with generics, enums, data types, n-ary association diamonds), the
// diagram-local nodes of state machines and activity diagrams, and all relationships with
// their UML adornments. The diagram editor reuses the per-element and per-edge functions.
import { LineShapes, type CanvasDiagram, type DiagramNode, type Element, type LineShape, type LocalEdge, type LocalNode, type Model, type Relationship } from '../model/schema';
import { FONT_SIZE, headPath, normalize, r, textBox, textWidth, type Prim, type Scene, polylineD, roundCorners, withStyle, fillShapes, type DiagramStyle } from './scene';

const LINE = 18;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Outline = 'rect' | 'ellipse' | 'diamond';

/** Corner radius of modern lines. */
const MODERN_RADIUS = 8;

/** Default sizes per element / local node kind. */
export const DEFAULT_SIZE: Record<string, [number, number]> = {
  actor: [60, 80],
  usecase: [150, 60],
  externalSystem: [160, 70],
  component: [160, 70],
  interface: [160, 70],
  lollipop: [24, 24],
  port: [14, 14],
  package: [220, 140],
  node: [200, 110],
  executionEnvironment: [180, 90],
  artifact: [150, 60],
  class: [160, 80],
  datatype: [160, 70],
  enum: [140, 70],
  naryAssociation: [32, 32],
  note: [160, 60],
  state: [140, 56],
  initial: [20, 20],
  final: [24, 24],
  choice: [28, 28],
  junction: [12, 12],
  fork: [90, 8],
  join: [90, 8],
  history: [26, 26],
  deepHistory: [26, 26],
  terminate: [20, 20],
  action: [140, 48],
  activityFinal: [24, 24],
  flowFinal: [22, 22],
  decision: [28, 28],
  merge: [28, 28],
  object: [120, 44],
  partition: [240, 320],
  sendSignal: [140, 44],
  acceptEvent: [140, 44],
  instance: [170, 56],
  part: [160, 50],
  collaboration: [220, 110],
  collaborationUse: [190, 56],
  interactionUse: [220, 56],
  interaction: [260, 150],
  region: [260, 100],
  entryPoint: [16, 16],
  exitPoint: [16, 16],
  pin: [12, 12],
  acceptTimeEvent: [22, 30],
  interruptibleRegion: [320, 200],
};

/** Local nodes that sit on the border of their parent (like ports on a component). */
export const BORDER_LOCAL_KINDS = new Set(['entryPoint', 'exitPoint', 'pin']);

export function outlineOf(kind: string, lollipop = false): Outline {
  if (lollipop || ['usecase', 'collaboration', 'collaborationUse', 'entryPoint', 'exitPoint', 'initial', 'final', 'junction', 'history', 'deepHistory', 'terminate', 'activityFinal', 'flowFinal'].includes(kind)) return 'ellipse';
  if (['choice', 'decision', 'merge', 'naryAssociation'].includes(kind)) return 'diamond';
  return 'rect';
}

/** Keywords UML 2.0 shows for a kind (a component's icon is optional, its keyword is not: 8.3.1).
 *  An external system is a grey box marked «external» (an actor in rectangle notation would read «actor»). */
const KEYWORDS: Partial<Record<Element['kind'], string>> = {
  component: 'component',
  externalSystem: 'external',
  interface: 'interface',
  executionEnvironment: 'executionEnvironment',
  artifact: 'artifact',
  enum: 'enumeration',
  datatype: 'dataType',
};

/** «keyword» «stereotype» (both shown, each in guillemets; 18.3.8), or '' when there is neither. */
export function keywordText(e: Pick<Element, 'kind' | 'stereotype'>, subject = false): string {
  const kind = subject ? undefined : KEYWORDS[e.kind];
  const parts = [kind, ...(e.stereotype ? e.stereotype.split(',').map((x) => x.trim()) : [])].filter((x): x is string => !!x);
  return [...new Set(parts)].map((k) => `«${k}»`).join(' ');
}

/** A text cut to `max` wide, ending in "…". */
export function ellipsize(text: string, max: number, size = FONT_SIZE): string {
  if (textWidth(text, size) <= max) return text;
  let s = text;
  while (s.length > 1 && textWidth(`${s}…`, size) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Word-wrapped lines of at most `max` wide (a word longer than that is cut). */
export function wrapText(text: string, max: number, size = FONT_SIZE): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || textWidth(next, size) <= max) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.map((l) => ellipsize(l, max, size));
}

/** Property strings are never wider than this, unless the box is given a larger width. */
const PROPS_MAX = 300;

/**
 * Property strings drawn under the name: {technology=…, version=…, tag=value} and each {constraint}.
 * A property string wider than `max` is broken after a comma; a single property wider than that is cut.
 */
export function propertyLines(e: Element, max = Infinity): string[] {
  const props = [
    ...(e.technology ? [`technology=${e.technology}`] : []),
    ...(e.version ? [`version=${e.version}`] : []),
    ...Object.entries(e.tags ?? {}).map(([k, v]) => `${k}=${v}`),
  ];
  const constraints = (e.constraints ?? []).map((c) => ellipsize(`{${c}}`, max, 11));
  if (!props.length) return constraints;
  const whole = `{${props.join(', ')}}`;
  if (textWidth(whole, 11) <= max) return [whole, ...constraints];
  const lines: string[] = [];
  let line = '';
  props.forEach((p, i) => {
    const piece = `${i === 0 ? '{' : ''}${p}${i === props.length - 1 ? '}' : ','}`;
    const next = line ? `${line} ${piece}` : piece;
    if (line && textWidth(next, 11) > max) {
      lines.push(line);
      line = piece;
    } else line = next;
  });
  lines.push(line);
  return [...lines.map((l) => ellipsize(l, max, 11)), ...constraints];
}

/** "name : Type" of an instance, part or collaboration use (":Type" for an anonymous one), with a part's [multiplicity]. */
export function typedName(e: Element, classifier?: Pick<Element, 'name'>): string {
  const anonymous = e.name.trim() === '' || e.name.trim() === ':';
  const base = classifier ? (anonymous ? `:${classifier.name}` : `${e.name} : ${classifier.name}`) : e.name;
  return e.kind === 'part' && e.multiplicity ? `${base} [${e.multiplicity}]` : base;
}

const TYPED_KINDS = new Set(['instance', 'part', 'collaborationUse']);

/** Instance multiplicity, drawn in the top right corner (9.3.12). */
const INSTANCE_KINDS = new Set(['node', 'executionEnvironment', 'component', 'artifact']);

// ---------------------------------------------------------------------------
// members
// ---------------------------------------------------------------------------

export function attributeText(a: NonNullable<Element['attributes']>[number]): string {
  return `${a.visibility ?? ''}${a.derived ? '/' : ''}${a.name}${a.type ? `: ${a.type}` : ''}${a.multiplicity ? ` [${a.multiplicity}]` : ''}${a.default ? ` = ${a.default}` : ''}`;
}

export function operationText(o: NonNullable<Element['operations']>[number]): string {
  const params = (o.params ?? []).map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ');
  return `${o.visibility ?? ''}${o.name}(${params})${o.returns ? `: ${o.returns}` : ''}`;
}

function hasCompartments(e: Element): boolean {
  return e.kind === 'class' || e.kind === 'enum' || e.kind === 'datatype' || (e.kind === 'interface' && !!(e.operations?.length || e.attributes?.length));
}

/** Minimum size of an element's shape (class boxes grow to fit their members). */
const PROP_LINE = 14;

/** `width`: the width the box was given (property strings wrap to it). */
export function minSize(e: Element | undefined, lollipop = false, classifier?: Pick<Element, 'name'>, width?: number): [number, number] {
  if (!e) return [140, 50];
  if (lollipop) return DEFAULT_SIZE.lollipop!;
  const [dw, dh] = DEFAULT_SIZE[e.kind] ?? [160, 70];
  if (TYPED_KINDS.has(e.kind)) {
    const label = typedName(e, classifier);
    const slots = e.kind === 'instance' ? (e.slots ?? []).map((sl) => `${sl.name} = ${sl.value}`) : [];
    const w = Math.max(dw, textWidth(label, FONT_SIZE, true) + (e.kind === 'collaborationUse' ? 60 : 32), ...slots.map((l) => textWidth(l) + 24));
    return [w, Math.max(dh, (slots.length ? 38 + slots.length * LINE + 8 : dh))];
  }
  const props = propertyLines(e, (width ?? PROPS_MAX) - 24);
  const propW = Math.max(0, ...props.map((l) => textWidth(l, 11) + 24));
  if (e.kind === 'usecase' && e.extensionPoints?.length) {
    // The ellipse holds the name, a line and the "extension points" compartment.
    const lines = ['extension points', ...e.extensionPoints];
    const inner = Math.max(textWidth(e.name, FONT_SIZE, true), ...lines.map((l) => textWidth(l, 11)));
    return [Math.max(dw, inner * 1.45 + 30), Math.max(dh, 2 * (24 + lines.length * PROP_LINE) + 10)];
  }
  if (!hasCompartments(e)) {
    const keyword = keywordText(e);
    if (e.kind === 'port' || e.kind === 'naryAssociation') return [dw, dh];
    if (e.kind === 'actor') return [Math.max(dw, propW), dh + props.length * PROP_LINE];
    const extra = e.kind === 'component' || e.kind === 'artifact' ? 30 : 0; // room for the icon
    return [Math.max(dw, textWidth(e.name, FONT_SIZE, true) + 40 + extra, keyword ? textWidth(keyword, 12) + 24 + extra : 0, propW), dh + props.length * PROP_LINE];
  }
  const lines = e.kind === 'enum' ? e.literals ?? [] : [...(e.attributes ?? []).map(attributeText), ...(e.operations ?? []).map(operationText)];
  const keyword = keywordText(e);
  const w = Math.max(dw, textWidth(e.name, FONT_SIZE, true) + 32, keyword ? textWidth(keyword, 12) + 24 : 0, propW, ...lines.map((l) => textWidth(l) + 20));
  const header = (keyword ? LINE : 0) + 30 + props.length * PROP_LINE;
  const first = e.kind === 'enum' ? (e.literals?.length ?? 0) : (e.attributes?.length ?? 0);
  const ops = e.kind === 'enum' ? 0 : (e.operations?.length ?? 0);
  const h = header + Math.max(1, first) * LINE + 8 + (e.kind === 'enum' ? 0 : Math.max(1, ops) * LINE + 8);
  return [w, Math.max(dh, h)];
}

// ---------------------------------------------------------------------------
// element shapes
// ---------------------------------------------------------------------------

function stickFigure(cx: number, top: number, s: number, out: Prim[]) {
  out.push({ t: 'circle', cx, cy: top + s * 0.14, r: s * 0.14, fill: 'surface', stroke: 'ink' });
  out.push({ t: 'line', x1: cx, y1: top + s * 0.28, x2: cx, y2: top + s * 0.65 });
  out.push({ t: 'line', x1: cx - s * 0.3, y1: top + s * 0.4, x2: cx + s * 0.3, y2: top + s * 0.4 });
  out.push({ t: 'line', x1: cx, y1: top + s * 0.65, x2: cx - s * 0.25, y2: top + s });
  out.push({ t: 'line', x1: cx, y1: top + s * 0.65, x2: cx + s * 0.25, y2: top + s });
}

/** «use» on usages (unless `noUse`) and «deploy» on deployments (7.3.53, 10.3.4), plus the stereotype(s). */
export function relationshipKeywords(rel: Pick<Relationship, 'kind' | 'stereotype'>, noUse = false): string {
  const kind = rel.kind === 'usage' ? (noUse ? undefined : 'use') : rel.kind === 'deploy' ? 'deploy' : rel.kind === 'manifest' ? 'manifest' : undefined;
  const parts = [kind, ...(rel.stereotype ? rel.stereotype.split(',').map((x) => x.trim()) : [])].filter((x): x is string => !!x);
  return [...new Set(parts)].map((k) => `«${k}»`).join(' ');
}

/**
 * Primitives for one model element in `box`. `container` draws the name at the top
 * (children are drawn inside); `lollipop` draws an interface as a ball.
 */
export function elementPrims(e: Element | undefined, ref: string, box: Box, opts: { container?: boolean; lollipop?: boolean; subject?: boolean; classifier?: Element } = {}): Prim[] {
  const out: Prim[] = [];
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  if (!e) {
    out.push({ t: 'rect', x, y, w, h, rx: 4, fill: 'surface', stroke: 'error', dashed: true });
    out.push({ t: 'text', x: cx, y: y + h / 2 + 4, text: `missing: ${ref}`, anchor: 'middle', fill: 'error' });
    return out;
  }
  const keyword = keywordText(e, opts.subject);
  const props = propertyLines(e, w - 24);
  /** «keywords», the name, then the property strings ({tagged values}, {constraints}). */
  const nameLines = (top: number, at = cx, anchor: 'middle' | 'start' = 'middle') => {
    let ty = top;
    if (keyword) {
      out.push({ t: 'text', x: at, y: ty, text: keyword, anchor, size: 12 });
      ty += 16;
    }
    out.push({ t: 'text', x: at, y: ty, text: e.name, anchor, bold: true, italic: e.abstract });
    for (const line of props) {
      ty += PROP_LINE;
      out.push({ t: 'text', x: at, y: ty, text: line, anchor, size: 11, fill: 'muted' });
    }
  };
  /** Baseline of the first line when the lines are centered vertically in the box. */
  const centered = (top: number, height: number) => top + height / 2 + 5 - ((keyword ? 16 : 0) + props.length * PROP_LINE) / 2;
  const centeredTop = opts.container ? y + 20 : centered(y, h);
  const instances = (right: number, top: number) => {
    if (e.instances && INSTANCE_KINDS.has(e.kind)) out.push({ t: 'text', x: right, y: top, text: e.instances, anchor: 'end', size: 11 });
  };

  if (opts.lollipop) {
    const rr = Math.min(w, h) / 2 - 1;
    out.push({ t: 'circle', cx, cy: y + h / 2, r: rr, fill: 'surface', stroke: 'ink' });
    out.push({ t: 'text', x: cx, y: y + h + 15, text: e.name, anchor: 'middle', size: 12 });
    return out;
  }

  switch (e.kind) {
    case 'instance': {
      // "name : Type" underlined (7.3.22), slots below; the shape follows the classifier (e.g. a node instance).
      const label = typedName(e, opts.classifier);
      const ck = opts.classifier?.kind;
      const slots = e.slots ?? [];
      let left = x;
      let top = y;
      let width = w;
      if (ck === 'node' || ck === 'executionEnvironment') {
        const d = 10;
        out.push({ t: 'path', d: `M${x} ${y + d} L${x + d} ${y} L${x + w} ${y} L${x + w} ${y + h - d} L${x + w - d} ${y + h} L${x} ${y + h} Z`, fill: 'alt', stroke: 'ink' });
        out.push({ t: 'path', d: `M${x} ${y + d} L${x + w - d} ${y + d} L${x + w} ${y} M${x + w - d} ${y + d} L${x + w - d} ${y + h}`, fill: 'none', stroke: 'ink' });
        out.push({ t: 'rect', x, y: y + d, w: w - d, h: h - d, fill: 'surface', stroke: 'ink' });
        top = y + d;
        width = w - d;
      } else {
        out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
        if (ck === 'component') {
          const ix = x + w - 22;
          const iy = y + 7;
          out.push({ t: 'rect', x: ix, y: iy, w: 14, h: 16, fill: 'surface', stroke: 'ink' });
          out.push({ t: 'rect', x: ix - 4, y: iy + 3, w: 8, h: 3.5, fill: 'surface', stroke: 'ink' });
          out.push({ t: 'rect', x: ix - 4, y: iy + 9.5, w: 8, h: 3.5, fill: 'surface', stroke: 'ink' });
        }
      }
      const kw = e.stereotype ? keywordText({ kind: 'instance', stereotype: e.stereotype }) : '';
      if (opts.container) {
        if (kw) out.push({ t: 'text', x: left + 10, y: top + 16, text: kw, size: 12 });
        out.push({ t: 'text', x: left + 10, y: top + (kw ? 32 : 18), text: label, bold: true, underline: true });
        return out;
      }
      if (slots.length) {
        const header = 30 + (kw ? 16 : 0);
        if (kw) out.push({ t: 'text', x: left + width / 2, y: top + 16, text: kw, anchor: 'middle', size: 12 });
        out.push({ t: 'text', x: left + width / 2, y: top + header - 10, text: label, anchor: 'middle', bold: true, underline: true });
        out.push({ t: 'line', x1: left, y1: top + header, x2: left + width, y2: top + header });
        slots.forEach((sl, i) => out.push({ t: 'text', x: left + 8, y: top + header + LINE - 2 + i * LINE, text: `${sl.name} = ${sl.value}` }));
        return out;
      }
      if (kw) out.push({ t: 'text', x: left + width / 2, y: top + (h - (top - y)) / 2 - 3, text: kw, anchor: 'middle', size: 12 });
      out.push({ t: 'text', x: left + width / 2, y: top + (h - (top - y)) / 2 + (kw ? 13 : 5), text: label, anchor: 'middle', bold: true, underline: true });
      return out;
    }
    case 'part': {
      // "name : Type [m]" in a box; dashed when the part is a reference, not owned (9.3.12).
      const label = typedName(e, opts.classifier);
      out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink', dashed: !!e.reference });
      if (opts.container) out.push({ t: 'text', x: x + 10, y: y + 18, text: label, bold: true });
      else out.push({ t: 'text', x: cx, y: y + h / 2 + 5, text: label, anchor: 'middle', bold: true });
      return out;
    }
    case 'collaboration':
    case 'collaborationUse': {
      // Dashed ellipse (9.3.3); a collaboration use reads "name : Collaboration" (9.3.4).
      out.push({ t: 'ellipse', cx, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: 'surface', stroke: 'ink', dashed: true });
      const label = e.kind === 'collaborationUse' ? typedName(e, opts.classifier) : e.name;
      if (opts.container) {
        out.push({ t: 'text', x: cx, y: y + 22, text: label, anchor: 'middle', bold: true });
        out.push({ t: 'line', x1: x + w * 0.12, y1: y + 30, x2: x + w * 0.88, y2: y + 30, dashed: true, stroke: 'ink' });
      } else out.push({ t: 'text', x: cx, y: y + h / 2 + 5, text: label, anchor: 'middle', bold: true });
      return out;
    }
    case 'actor': {
      const s = Math.min(h - 22, 50);
      stickFigure(cx, y + 2, s, out);
      out.push({ t: 'text', x: cx, y: y + s + 18, text: e.name, anchor: 'middle', bold: true, italic: e.abstract });
      props.forEach((line, i) => out.push({ t: 'text', x: cx, y: y + s + 18 + (i + 1) * PROP_LINE, text: line, anchor: 'middle', size: 11, fill: 'muted' }));
      return out;
    }
    case 'usecase': {
      out.push({ t: 'ellipse', cx, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: 'surface', stroke: 'ink' });
      const points = e.extensionPoints ?? [];
      if (!points.length) {
        nameLines(centered(y, h));
        return out;
      }
      // Extension points compartment (16.3.3): below a line across the ellipse.
      const lineY = y + h / 2 - 2;
      const half = (w / 2) * Math.sqrt(Math.max(0, 1 - ((lineY - (y + h / 2)) / (h / 2)) ** 2));
      nameLines(lineY - 10 - ((keyword ? 16 : 0) + props.length * PROP_LINE));
      out.push({ t: 'line', x1: cx - half, y1: lineY, x2: cx + half, y2: lineY, stroke: 'ink' });
      out.push({ t: 'text', x: cx, y: lineY + 14, text: 'extension points', anchor: 'middle', size: 11, bold: true });
      points.forEach((pt, i) => out.push({ t: 'text', x: cx, y: lineY + 14 + (i + 1) * PROP_LINE, text: pt, anchor: 'middle', size: 11 }));
      return out;
    }
    case 'port':
      out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
      out.push({ t: 'text', x: x + w + 4, y: y - 3, text: e.name, size: 11 });
      return out;
    case 'naryAssociation':
      out.push({ t: 'path', d: `M${cx} ${y} L${x + w} ${y + h / 2} L${cx} ${y + h} L${x} ${y + h / 2} Z`, fill: 'surface', stroke: 'ink' });
      if (e.name) out.push({ t: 'text', x: cx, y: y - 6, text: e.name, anchor: 'middle', size: 12 });
      return out;
    case 'node':
    case 'executionEnvironment': {
      const d = 10;
      out.push({ t: 'path', d: `M${x} ${y + d} L${x + d} ${y} L${x + w} ${y} L${x + w} ${y + h - d} L${x + w - d} ${y + h} L${x} ${y + h} Z`, fill: 'alt', stroke: 'ink' });
      out.push({ t: 'path', d: `M${x} ${y + d} L${x + w - d} ${y + d} L${x + w} ${y} M${x + w - d} ${y + d} L${x + w - d} ${y + h}`, fill: 'none', stroke: 'ink' });
      out.push({ t: 'rect', x, y: y + d, w: w - d, h: h - d, fill: 'surface', stroke: 'ink' });
      if (opts.container) nameLines(y + d + 18, x + 10, 'start');
      else nameLines(centered(y + d, h - d), x + (w - d) / 2);
      instances(x + w - d - 6, y + d + 14);
      return out;
    }
    case 'package': {
      // The name goes in the tab only when members are shown inside; otherwise in the body,
      // with the keyword above it (7.3.37).
      if (opts.container) {
        const tabW = Math.min(w * 0.6, Math.max(60, textWidth(e.name, 12, true) + 16, keyword ? textWidth(keyword, 11) + 16 : 0));
        const tabH = keyword ? 32 : 20;
        out.push({ t: 'rect', x, y, w: tabW, h: tabH, fill: 'alt', stroke: 'ink' });
        out.push({ t: 'rect', x, y: y + tabH, w, h: h - tabH, fill: 'surface', stroke: 'ink' });
        if (keyword) out.push({ t: 'text', x: x + 8, y: y + 13, text: keyword, size: 11 });
        out.push({ t: 'text', x: x + 8, y: y + tabH - 6, text: e.name, size: 12, bold: true });
        props.forEach((line, i) => out.push({ t: 'text', x: x + 8, y: y + tabH + 16 + i * PROP_LINE, text: line, size: 11, fill: 'muted' }));
      } else {
        const tabW = Math.min(w * 0.4, 56);
        out.push({ t: 'rect', x, y, w: tabW, h: 14, fill: 'alt', stroke: 'ink' });
        out.push({ t: 'rect', x, y: y + 14, w, h: h - 14, fill: 'surface', stroke: 'ink' });
        nameLines(centered(y + 14, h - 14));
      }
      return out;
    }
    case 'artifact': {
      out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
      const ix = x + w - 22;
      const iy = y + 6;
      out.push({ t: 'path', d: `M${ix} ${iy} L${ix + 9} ${iy} L${ix + 14} ${iy + 5} L${ix + 14} ${iy + 17} L${ix} ${iy + 17} Z M${ix + 9} ${iy} L${ix + 9} ${iy + 5} L${ix + 14} ${iy + 5}`, fill: 'none', stroke: 'ink' });
      nameLines(centeredTop);
      instances(ix - 6, y + 16);
      return out;
    }
    default:
      break;
  }

  if (e.kind === 'class' && opts.container) {
    out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
    nameLines(y + (keyword ? 16 : 20));
    const header = 30 + (keyword ? 16 : 0) + props.length * PROP_LINE;
    out.push({ t: 'line', x1: x, y1: y + header, x2: x + w, y2: y + header });
    return out;
  }

  if (hasCompartments(e)) {
    const header = (keyword ? LINE : 0) + 30 + props.length * PROP_LINE;
    out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
    nameLines(y + (keyword ? 16 : 20));
    if (e.typeParams?.length) {
      const text = e.typeParams.join(', ');
      const tw = textWidth(text, 11) + 12;
      out.push({ t: 'rect', x: x + w - tw * 0.75, y: y - 10, w: tw, h: 18, fill: 'surface', stroke: 'ink', dashed: true });
      out.push({ t: 'text', x: x + w - tw * 0.75 + 6, y: y + 3, text, size: 11, italic: true });
    }
    out.push({ t: 'line', x1: x, y1: y + header, x2: x + w, y2: y + header });
    let ty = y + header + LINE - 2;
    if (e.kind === 'enum') {
      for (const l of e.literals ?? []) {
        out.push({ t: 'text', x: x + 8, y: ty, text: l });
        ty += LINE;
      }
      return out;
    }
    const attrs = e.attributes ?? [];
    for (const a of attrs) {
      out.push({ t: 'text', x: x + 8, y: ty, text: attributeText(a), underline: !!a.static });
      ty += LINE;
    }
    const sep = y + header + Math.max(1, attrs.length) * LINE + 8;
    out.push({ t: 'line', x1: x, y1: sep, x2: x + w, y2: sep });
    ty = sep + LINE - 2;
    for (const o of e.operations ?? []) {
      out.push({ t: 'text', x: x + 8, y: ty, text: operationText(o), underline: !!o.static, italic: !!o.abstract });
      ty += LINE;
    }
    return out;
  }

  // component, externalSystem («external» rectangle), interface (plain box), use case subject
  if (opts.subject) {
    // The subject of use cases: a plain rectangle with its name at the top (16.3.6).
    out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
    nameLines(y + 20);
    return out;
  }
  out.push({ t: 'rect', x, y, w, h, rx: e.kind === 'externalSystem' ? 0 : 2, fill: e.kind === 'externalSystem' ? 'alt' : 'surface', stroke: 'ink' });
  if (e.kind === 'component') {
    const ix = x + w - 22;
    const iy = y + 7;
    out.push({ t: 'rect', x: ix, y: iy, w: 14, h: 16, fill: 'surface', stroke: 'ink' });
    out.push({ t: 'rect', x: ix - 4, y: iy + 3, w: 8, h: 3.5, fill: 'surface', stroke: 'ink' });
    out.push({ t: 'rect', x: ix - 4, y: iy + 9.5, w: 8, h: 3.5, fill: 'surface', stroke: 'ink' });
  }
  if (opts.container) nameLines(y + 20, x + 10, 'start');
  else nameLines(centeredTop);
  if (e.kind === 'component') instances(x + w - 30, y + 18);
  return out;
}

/** A note's text, wrapped to its width. */
export function noteLines(text: string, w: number): string[] {
  return wrapText(text, w - 20, 12);
}

/** The size a note needs: wide enough for its longest line (up to 280), tall enough for all its lines. */
export function noteSize(text: string, w?: number, h?: number): [number, number] {
  const [dw, dh] = DEFAULT_SIZE.note ?? [160, 60];
  const width = w ?? Math.max(dw, Math.min(280, Math.max(0, ...text.split('\n').map((l) => textWidth(l, 12) + 24))));
  return [width, Math.max(h ?? dh, 12 + noteLines(text, width).length * 16)];
}

/** Primitives for one state-machine/activity/note node. */
/**
 * The drill-down marker of an element shown in detail on another diagram: the UML "rake" in the
 * bottom-right corner, with a hit area carrying the link.
 */
export function detailMarker(box: Box, file: string): Prim[] {
  const s = 12;
  const x = box.x + box.w - s - 7;
  const y = box.y + box.h - s - 6;
  const mid = y + s / 2;
  return [
    // M / L pairs only: normalize() shifts paths pair by pair.
    { t: 'path', d: `M${x + s / 2} ${y} L${x + s / 2} ${y + s} M${x} ${y + s} L${x} ${mid} L${x + s} ${mid} L${x + s} ${y + s}`, fill: 'none', stroke: 'ink' },
    { t: 'rect', x: x - 4, y: y - 4, w: s + 8, h: s + 8, fill: 'none', stroke: 'none', link: file },
  ];
}

/** Whether an element gets the drill-down marker on a diagram (not on the detail diagram itself, not on small shapes). */
export function detailOf(e: Element | undefined, self: string | undefined, lollipop = false): string | undefined {
  if (!e?.detail || e.detail === self || lollipop || e.kind === 'port') return undefined;
  return e.detail;
}

export function localNodePrims(n: LocalNode, box: Box, container = false, opts: { separator?: boolean; side?: LaidOutNode['side'] } = {}): Prim[] {
  const out: Prim[] = [];
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = Math.min(w, h) / 2;
  const name = n.name ?? '';
  /** A name outside the shape: movable, tied to the shape by a dotted line once moved. */
  const outerLabel = (text: TextPrim) => {
    const outline: Outline = n.kind === 'entryPoint' || n.kind === 'exitPoint' ? 'ellipse' : n.kind === 'decision' || n.kind === 'choice' || n.kind === 'merge' ? 'diamond' : 'rect';
    placeLabel(text, n.labelOffset, (c) => clipTo(box, outline, c[0], c[1]), out);
  };
  /** The name of a border node, outside its parent. */
  const sideLabel = () => {
    if (!name) return;
    if (opts.side === 'left') outerLabel({ t: 'text', x: x - 4, y: cy + 4, text: name, anchor: 'end', size: 11 });
    else if (opts.side === 'right') outerLabel({ t: 'text', x: x + w + 4, y: cy + 4, text: name, size: 11 });
    else if (opts.side === 'bottom') outerLabel({ t: 'text', x: cx, y: y + h + 13, text: name, anchor: 'middle', size: 11 });
    else outerLabel({ t: 'text', x: opts.side === 'top' ? cx : x + w + 3, y: y - 4, text: name, anchor: opts.side === 'top' ? 'middle' : 'start', size: 11 });
  };
  switch (n.kind) {
    case 'note':
      out.push({ t: 'path', d: `M${x} ${y} L${x + w - 12} ${y} L${x + w} ${y + 12} L${x + w} ${y + h} L${x} ${y + h} Z M${x + w - 12} ${y} L${x + w - 12} ${y + 12} L${x + w} ${y + 12}`, fill: 'alt', stroke: 'ink' });
      noteLines(n.text ?? name, w).forEach((line, i) => out.push({ t: 'text', x: x + 8, y: y + 18 + i * 16, text: line, size: 12 }));
      break;
    case 'state': {
      const lines = (n.text ?? '').split('\n').filter(Boolean);
      out.push({ t: 'rect', x, y, w, h, rx: 12, fill: 'surface', stroke: 'ink' });
      if (lines.length === 0 && !container) {
        out.push({ t: 'text', x: cx, y: cy + 4.5, text: name, anchor: 'middle', bold: true });
        break;
      }
      // Composite state or internal activities: name compartment on top.
      out.push({ t: 'text', x: cx, y: y + 19, text: name, anchor: 'middle', bold: true });
      out.push({ t: 'line', x1: x, y1: y + 28, x2: x + w, y2: y + 28 });
      lines.forEach((line, i) => out.push({ t: 'text', x: x + 8, y: y + 45 + i * 16, text: line, size: 12 }));
      break;
    }
    case 'initial':
      out.push({ t: 'circle', cx, cy, r: rad, fill: 'ink', stroke: 'ink' });
      break;
    case 'final':
    case 'activityFinal':
      out.push({ t: 'circle', cx, cy, r: rad, fill: 'surface', stroke: 'ink' });
      out.push({ t: 'circle', cx, cy, r: rad * 0.6, fill: 'ink', stroke: 'ink' });
      break;
    case 'flowFinal':
      out.push({ t: 'circle', cx, cy, r: rad, fill: 'surface', stroke: 'ink' });
      out.push({ t: 'path', d: `M${cx - rad * 0.7} ${cy - rad * 0.7} L${cx + rad * 0.7} ${cy + rad * 0.7} M${cx + rad * 0.7} ${cy - rad * 0.7} L${cx - rad * 0.7} ${cy + rad * 0.7}`, fill: 'none', stroke: 'ink' });
      break;
    case 'terminate':
      out.push({ t: 'path', d: `M${x} ${y} L${x + w} ${y + h} M${x + w} ${y} L${x} ${y + h}`, fill: 'none', stroke: 'ink' });
      break;
    case 'junction':
      out.push({ t: 'circle', cx, cy, r: rad, fill: 'ink', stroke: 'ink' });
      break;
    case 'choice':
    case 'decision':
    case 'merge':
      out.push({ t: 'path', d: `M${cx} ${y} L${x + w} ${cy} L${cx} ${y + h} L${x} ${cy} Z`, fill: 'surface', stroke: 'ink', round: true });
      if (name) outerLabel({ t: 'text', x: x + w + 4, y: y - 2, text: name, size: 12 });
      break;
    case 'fork':
    case 'join':
      out.push({ t: 'rect', x, y, w, h, fill: 'ink', stroke: 'ink' });
      break;
    case 'history':
    case 'deepHistory':
      out.push({ t: 'circle', cx, cy, r: rad, fill: 'surface', stroke: 'ink' });
      out.push({ t: 'text', x: cx, y: cy + 4.5, text: n.kind === 'history' ? 'H' : 'H*', anchor: 'middle', size: 12, bold: true });
      break;
    case 'action':
      out.push({ t: 'rect', x, y, w, h, rx: 14, fill: 'surface', stroke: 'ink' });
      out.push({ t: 'text', x: cx, y: cy + 4.5, text: name, anchor: 'middle' });
      break;
    case 'object':
      // An object node is a plain rectangle; only actions have rounded corners (12.3.37).
      out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink', sharp: true });
      out.push({ t: 'text', x: cx, y: cy + 4.5, text: name, anchor: 'middle', underline: false });
      break;
    case 'sendSignal':
      out.push({ t: 'path', d: `M${x} ${y} L${x + w - 16} ${y} L${x + w} ${cy} L${x + w - 16} ${y + h} L${x} ${y + h} Z`, fill: 'surface', stroke: 'ink', round: true });
      out.push({ t: 'text', x: x + (w - 16) / 2, y: cy + 4.5, text: name, anchor: 'middle' });
      break;
    case 'acceptEvent':
      out.push({ t: 'path', d: `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} L${x + 16} ${cy} Z`, fill: 'surface', stroke: 'ink', round: true });
      out.push({ t: 'text', x: x + 8 + w / 2, y: cy + 4.5, text: name, anchor: 'middle' });
      break;
    case 'partition':
      out.push({ t: 'rect', x, y, w, h, fill: 'none', stroke: 'ink' });
      out.push({ t: 'line', x1: x, y1: y + 28, x2: x + w, y2: y + 28 });
      out.push({ t: 'text', x: cx, y: y + 19, text: name, anchor: 'middle', bold: true });
      break;
    case 'region':
      // An orthogonal region fills its state; regions after the first are separated by a dashed line.
      if (opts.separator) out.push({ t: 'line', x1: x, y1: y, x2: x + w, y2: y, stroke: 'ink', dashed: true });
      if (name) out.push({ t: 'text', x: x + 8, y: y + 15, text: name, size: 11, italic: true, fill: 'muted' });
      break;
    case 'entryPoint':
    case 'exitPoint':
      out.push({ t: 'circle', cx, cy, r: rad, fill: 'surface', stroke: 'ink' });
      if (n.kind === 'exitPoint') {
        const k = rad * 0.7;
        out.push({ t: 'path', d: `M${cx - k} ${cy - k} L${cx + k} ${cy + k} M${cx + k} ${cy - k} L${cx - k} ${cy + k}`, fill: 'none', stroke: 'ink' });
      }
      sideLabel();
      break;
    case 'pin':
      out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
      sideLabel();
      break;
    case 'acceptTimeEvent':
      // Hourglass (12.3.2): the time expression below it.
      out.push({ t: 'path', d: `M${x} ${y} L${x + w} ${y} L${x} ${y + h} L${x + w} ${y + h} Z`, fill: 'surface', stroke: 'ink' });
      if (name) outerLabel({ t: 'text', x: cx, y: y + h + 15, text: name, anchor: 'middle', size: 12 });
      break;
    case 'interruptibleRegion':
      out.push({ t: 'rect', x, y, w, h, rx: 10, fill: 'none', stroke: 'ink', dashed: true });
      if (name) out.push({ t: 'text', x: x + 10, y: y + 16, text: name, size: 11, italic: true, fill: 'muted' });
      break;
    case 'interactionUse':
    case 'interaction': {
      // Interaction overview nodes (14.4): "ref" frames and inline "sd" frames.
      const tag = n.kind === 'interactionUse' ? 'ref' : `sd ${name}`;
      const tw = textWidth(tag, 11, true) + 18;
      out.push({ t: 'rect', x, y, w, h, fill: 'surface', stroke: 'ink' });
      out.push({ t: 'path', d: `M${x} ${y + 18} L${x + tw - 6} ${y + 18} L${x + tw} ${y + 12} L${x + tw} ${y}`, fill: 'none', stroke: 'ink' });
      out.push({ t: 'text', x: x + 6, y: y + 13, text: tag, size: 11, bold: true });
      if (n.kind === 'interactionUse') out.push({ t: 'text', x: cx, y: y + h / 2 + 9, text: name, anchor: 'middle' });
      else if (n.text) n.text.split('\n').forEach((line, i) => out.push({ t: 'text', x: x + 10, y: y + 38 + i * 16, text: line, size: 12, fill: 'muted' }));
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// edges
// ---------------------------------------------------------------------------

/** Where the segment from the center of `box` towards (tx, ty) leaves the shape. */
export function clipTo(box: Box, outline: Outline, tx: number, ty: number): [number, number] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const a = box.w / 2;
  const b = box.h / 2;
  let s: number;
  if (outline === 'ellipse') s = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
  else if (outline === 'diamond') s = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  else s = Math.min(dx !== 0 ? a / Math.abs(dx) : Infinity, dy !== 0 ? b / Math.abs(dy) : Infinity);
  return [cx + dx * s, cy + dy * s];
}

/** Backwards compatible rectangle clipping. */
export const clipToBox = (box: Box, tx: number, ty: number) => clipTo(box, 'rect', tx, ty);

export interface Shape {
  box: Box;
  outline: Outline;
  lollipop?: boolean;
}

type Head = 'open' | 'filled' | 'triangle' | 'diamond-open' | 'diamond-filled' | 'socket' | 'none';

const REL_STYLE: Record<Relationship['kind'], { dashed: boolean; to: Head; from: Head }> = {
  link: { dashed: false, to: 'none', from: 'none' },
  manifest: { dashed: true, to: 'open', from: 'none' },
  association: { dashed: false, to: 'none', from: 'none' },
  aggregation: { dashed: false, to: 'none', from: 'diamond-open' },
  composition: { dashed: false, to: 'none', from: 'diamond-filled' },
  generalization: { dashed: false, to: 'triangle', from: 'none' },
  realization: { dashed: true, to: 'triangle', from: 'none' },
  dependency: { dashed: true, to: 'open', from: 'none' },
  usage: { dashed: true, to: 'open', from: 'none' },
  connector: { dashed: false, to: 'none', from: 'none' },
  deploy: { dashed: true, to: 'open', from: 'none' },
};

const unit = (a: [number, number], b: [number, number]): [number, number] => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
};

export interface EdgeGeometry {
  points: [number, number][];
}

type Pt = [number, number];

/** How one edge is drawn: its line shape, and for edges between the same two shapes a sideways shift. */
export interface Route {
  line?: LineShape;
  /** Shift by `by` (signed) across `perp`; edges between the same two shapes share `perp` and differ in `by`. */
  offset?: { by: number; perp: Pt };
  /** Right-angled lines sharing a side of a shape: move this line's end along that side. */
  ports?: { from?: number; to?: number };
}

/** The line shape of an edge: its own (style.line), else the diagram style's (straight / right angles). */
export function lineShapeOf(style: Record<string, string> | undefined, ds: DiagramStyle = 'classic'): LineShape {
  const own = style?.line;
  return (LineShapes as readonly string[]).includes(own ?? '') ? (own as LineShape) : ds === 'modern' ? 'orthogonal' : 'straight';
}

const centerOf = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];

/** The polyline of an edge between two shapes (through waypoints), ending on both outlines. Curves come as many short segments. */
export function edgePoints(from: Shape, to: Shape, waypoints: { x: number; y: number }[], ds: DiagramStyle = 'classic', route: Route = {}): Pt[] {
  const line = route.line ?? lineShapeOf(undefined, ds);
  const pts = waypoints.map((p) => [p.x, p.y] as Pt);
  if (line === 'curved') return curvedRoute(from, to, pts, route.offset);
  if (pts.length > 0) {
    if (line === 'straight') return [clipTo(from.box, from.outline, ...pts[0]!), ...pts, clipTo(to.box, to.outline, ...pts.at(-1)!)];
    // Bend points: leave and enter through the ports facing the nearest bend point.
    return [portToward(from, pts[0]!), ...pts, portToward(to, pts.at(-1)!)];
  }
  if (line !== 'straight') {
    const routed = line === 'orthogonal' ? orthoRoute(from, to) : (cornerRoute(from, to, line === 'horizontalFirst') ?? orthoRoute(from, to));
    if (routed) return route.offset ? shiftRoute(routed, route.offset) : route.ports ? spreadPorts(routed, route.ports) : routed;
  }
  if (route.offset) return bowed(from, to, route.offset);
  const start = clipTo(from.box, from.outline, ...centerOf(to.box));
  const end = clipTo(to.box, to.outline, ...centerOf(from.box));
  return [start, end];
}

/**
 * One corner: out of the side facing the target, horizontally (`horizontalFirst`) or vertically, then
 * into the target's top / bottom (or left / right). Straight across when the ends already line up;
 * undefined when the target is right above / below (or beside) the source.
 */
function cornerRoute(from: Shape, to: Shape, horizontalFirst: boolean): Pt[] | undefined {
  const a = from.box;
  const b = to.box;
  const [acx, acy] = centerOf(a);
  const [bcx, bcy] = centerOf(b);
  if (horizontalFirst) {
    if (bcx >= a.x && bcx <= a.x + a.w) return undefined;
    const right = bcx > acx;
    const s = portOf(from, right ? 'right' : 'left');
    if (s[1] >= b.y && s[1] <= b.y + b.h) return [s, [right ? b.x : b.x + b.w, s[1]]];
    const t = portOf(to, bcy > s[1] ? 'top' : 'bottom');
    return [s, [t[0], s[1]], t];
  }
  if (bcy >= a.y && bcy <= a.y + a.h) return undefined;
  const down = bcy > acy;
  const s = portOf(from, down ? 'bottom' : 'top');
  if (s[0] >= b.x && s[0] <= b.x + b.w) return [s, [s[0], down ? b.y : b.y + b.h]];
  const t = portOf(to, bcx > s[0] ? 'left' : 'right');
  return [s, [s[0], t[1]], t];
}

/** Moves the ends of a right-angled route along their sides (the next corner moves with them, so it stays right-angled). */
function spreadPorts(route: Pt[], ports: NonNullable<Route['ports']>): Pt[] {
  const out = route.map((p) => [p[0], p[1]] as Pt);
  const shift = (i: number, j: number, d: number | undefined) => {
    if (!d) return;
    const axis = Math.abs(out[j]![0] - out[i]![0]) > Math.abs(out[j]![1] - out[i]![1]) ? 1 : 0;
    out[i]![axis] += d;
    if (out.length > 2) out[j]![axis] += d;
  };
  shift(0, 1, ports.from);
  shift(out.length - 1, out.length - 2, ports.to);
  if (out.length === 2) {
    const [s, t] = out as [Pt, Pt];
    // Two ends no longer in line: a step halfway.
    if (Math.abs(s[0] - t[0]) > 0.5 && Math.abs(s[1] - t[1]) > 0.5) {
      const horizontal = Math.abs(route[1]![0] - route[0]![0]) > Math.abs(route[1]![1] - route[0]![1]);
      if (horizontal) return [s, [(s[0] + t[0]) / 2, s[1]], [(s[0] + t[0]) / 2, t[1]], t];
      return [s, [s[0], (s[1] + t[1]) / 2], [t[0], (s[1] + t[1]) / 2], t];
    }
  }
  return out;
}

/** Moves a right-angled route sideways: the ends along their side, the corners with them. */
function shiftRoute(route: Pt[], offset: NonNullable<Route['offset']>): Pt[] {
  const sx = offset.perp[0] >= 0 ? 1 : -1;
  const sy = offset.perp[1] >= 0 ? 1 : -1;
  const d = offset.by;
  return route.map((p, i) => {
    if (i > 0 && i < route.length - 1) return [p[0] + d * sx, p[1] + d * sy];
    const q = route[i === 0 ? 1 : i - 1]!;
    const horizontal = Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]);
    return horizontal ? [p[0], p[1] + d * sy] : [p[0] + d * sx, p[1]];
  });
}

const SAMPLES = 24;

function cubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, n = SAMPLES): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]);
  }
  return out;
}

/** A straight edge that shares its ends with another: a gentle arc to one side. */
function bowed(from: Shape, to: Shape, offset: NonNullable<Route['offset']>): Pt[] {
  const a = centerOf(from.box);
  const b = centerOf(to.box);
  const c: Pt = [(a[0] + b[0]) / 2 + offset.perp[0] * offset.by * 2, (a[1] + b[1]) / 2 + offset.perp[1] * offset.by * 2];
  const s = clipTo(from.box, from.outline, ...c);
  const e = clipTo(to.box, to.outline, ...c);
  // A quadratic curve as a cubic one.
  return cubic(s, [s[0] + ((c[0] - s[0]) * 2) / 3, s[1] + ((c[1] - s[1]) * 2) / 3], [e[0] + ((c[0] - e[0]) * 2) / 3, e[1] + ((c[1] - e[1]) * 2) / 3], e, 16);
}

/**
 * Curved: from the port facing the target, leaving and arriving straight out of the sides (like the
 * right-angled route, with its corners smoothed away); through the bend points when there are some.
 */
function curvedRoute(from: Shape, to: Shape, pts: Pt[], offset: Route['offset']): Pt[] {
  if (pts.length > 0) {
    // A smooth curve through every bend point (Catmull-Rom).
    const all: Pt[] = [clipTo(from.box, from.outline, ...pts[0]!), ...pts, clipTo(to.box, to.outline, ...pts.at(-1)!)];
    const out: Pt[] = [all[0]!];
    for (let i = 0; i < all.length - 1; i++) {
      const p0 = all[Math.max(0, i - 1)]!;
      const p1 = all[i]!;
      const p2 = all[i + 1]!;
      const p3 = all[Math.min(all.length - 1, i + 2)]!;
      const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      out.push(...cubic(p1, c1, c2, p2, 12).slice(1));
    }
    return out;
  }
  let routed = orthoRoute(from, to);
  if (!routed) return offset ? bowed(from, to, offset) : [clipTo(from.box, from.outline, ...centerOf(to.box)), clipTo(to.box, to.outline, ...centerOf(from.box))];
  if (offset) routed = shiftRoute(routed, offset);
  const s = routed[0]!;
  const e = routed.at(-1)!;
  if (routed.length === 2) return routed;
  const out = unit(s, routed[1]!);
  const into = unit(routed.at(-2)!, e);
  const k = Math.max(24, Math.hypot(e[0] - s[0], e[1] - s[1]) * 0.45);
  return cubic(s, [s[0] + out[0] * k, s[1] + out[1] * k], [e[0] - into[0] * k, e[1] - into[1] * k], e);
}

export type PortSide = 'top' | 'right' | 'bottom' | 'left';

/** The four ports of a shape (Modern): the middles of its sides, on the outline for any shape. */
export function portOf(s: Shape, side: PortSide): [number, number] {
  const b = s.box;
  if (side === 'top') return [b.x + b.w / 2, b.y];
  if (side === 'bottom') return [b.x + b.w / 2, b.y + b.h];
  if (side === 'left') return [b.x, b.y + b.h / 2];
  return [b.x + b.w, b.y + b.h / 2];
}

/** The port on the side facing a point. */
export function portToward(s: Shape, p: [number, number]): [number, number] {
  const b = s.box;
  const dx = (p[0] - (b.x + b.w / 2)) / (b.w || 1);
  const dy = (p[1] - (b.y + b.h / 2)) / (b.h || 1);
  if (Math.abs(dx) >= Math.abs(dy)) return portOf(s, dx >= 0 ? 'right' : 'left');
  return portOf(s, dy >= 0 ? 'bottom' : 'top');
}

/**
 * Modern routing without bend points: from one of the source's four ports to one of the
 * target's, with right angles. Facing sides with a turn halfway along the axis with more room
 * (straight when the ports line up); one turn when neither axis has room for two. Undefined
 * when the shapes overlap (the classic line is used).
 */
export function orthoRoute(from: Shape, to: Shape): [number, number][] | undefined {
  const a = from.box;
  const b = to.box;
  const ac: [number, number] = [a.x + a.w / 2, a.y + a.h / 2];
  const bc: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
  const dx = bc[0] - ac[0];
  const dy = bc[1] - ac[1];
  // Room between the facing sides (negative when the boxes overlap on that axis).
  const gx = dx > 0 ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
  const gy = dy > 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
  const ROOM = 16;
  if (gx < 0 && gy < 0) return undefined;
  const z = (s: [number, number], t: [number, number], horizontal: boolean): [number, number][] => {
    // Ports (nearly) in line: one straight line; a jog of a few pixels would read as a squiggle.
    if (Math.abs((horizontal ? s[1] : s[0]) - (horizontal ? t[1] : t[0])) < 6) return [s, t];
    if (horizontal) {
      const mx = (s[0] + t[0]) / 2;
      return [s, [mx, s[1]], [mx, t[1]], t];
    }
    const my = (s[1] + t[1]) / 2;
    return [s, [s[0], my], [t[0], my], t];
  };
  if (gx >= ROOM && (gx >= gy || gy < ROOM)) return z(portOf(from, dx > 0 ? 'right' : 'left'), portOf(to, dx > 0 ? 'left' : 'right'), true);
  if (gy >= ROOM || gx < 0) return z(portOf(from, dy > 0 ? 'bottom' : 'top'), portOf(to, dy > 0 ? 'top' : 'bottom'), false);
  if (gy < 0) return z(portOf(from, dx > 0 ? 'right' : 'left'), portOf(to, dx > 0 ? 'left' : 'right'), true);
  // Close on both axes (corner to corner): out of the side port, one turn into the top or bottom port.
  const s = portOf(from, dx > 0 ? 'right' : 'left');
  const t = portOf(to, dy > 0 ? 'top' : 'bottom');
  return [s, [t[0], s[1]], t];
}

/** Whether segment `k` of a route is horizontal or vertical (undefined when it is diagonal). */
export function segmentAxis(points: [number, number][], k: number): 'h' | 'v' | undefined {
  const a = points[k];
  const b = points[k + 1];
  if (!a || !b) return undefined;
  if (Math.abs(a[1] - b[1]) < 1 && Math.abs(a[0] - b[0]) >= 1) return 'h';
  if (Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) >= 1) return 'v';
  return undefined;
}

/**
 * Modern: moves segment `k` of a right-angle route across its direction, to `to` (the new y of a
 * horizontal segment, the new x of a vertical one); its neighbours stretch to follow. The ports
 * stay where they are: an end segment keeps a short stub at its port and jogs from there. Returns
 * the new bend points (redundant ones dropped).
 */
export function moveSegment(points: [number, number][], k: number, to: number): { x: number; y: number }[] {
  const axis = segmentAxis(points, k);
  if (!axis) return points.slice(1, -1).map(([x, y]) => ({ x, y }));
  const set = (p: [number, number]): [number, number] => (axis === 'h' ? [p[0], to] : [to, p[1]]);
  const a = points[k]!;
  const b = points[k + 1]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const stub = Math.min(16, len / 3);
  const toward = (p: [number, number], q: [number, number]): [number, number] => [p[0] + ((q[0] - p[0]) / len) * stub, p[1] + ((q[1] - p[1]) / len) * stub];
  const head: [number, number][] = k === 0 ? [a, toward(a, b), set(toward(a, b))] : [...points.slice(0, k), set(a)];
  const tail: [number, number][] = k + 1 === points.length - 1 ? [set(toward(b, a)), toward(b, a), b] : [set(b), ...points.slice(k + 2)];
  const all = [...head, ...tail].map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]);
  // Drop repeated points and points in the middle of a straight run.
  const out: [number, number][] = [];
  for (const p of all) {
    const last = out.at(-1);
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const prev = out.at(-2);
    if (prev && last && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) out.pop();
    out.push(p);
  }
  return out.slice(1, -1).map(([x, y]) => ({ x, y }));
}

function drawHead(head: Head, tip: [number, number], u: [number, number], out: Prim[], ds: DiagramStyle = 'classic') {
  switch (head) {
    case 'none':
      return;
    case 'socket':
      return; // drawn by relationshipPrims, which knows the ball
    case 'diamond-open':
    case 'diamond-filled':
      out.push({ t: 'path', d: headPath('diamond', tip[0], tip[1], u[0], u[1], ds), fill: head === 'diamond-filled' ? 'ink' : 'surface', stroke: 'ink' });
      return;
    default:
      out.push({ t: 'path', d: headPath(head, tip[0], tip[1], u[0], u[1], ds), fill: head === 'triangle' ? 'surface' : head === 'filled' ? 'ink' : 'none', stroke: 'ink' });
  }
}

/** Places a text near an edge end, on the given side (1 / -1) of the line. */
function endText(p: [number, number], q: [number, number], side: number, text: string, out: Prim[]) {
  const [ux, uy] = unit(p, q);
  const off = 12 * side;
  const x = p[0] + ux * 18 - uy * off;
  const y = p[1] + uy * 18 + ux * off + 4;
  out.push({ t: 'text', x, y, text, anchor: 'middle', size: 11 });
}

type TextPrim = Extract<Prim, { t: 'text' }>;
type Offset = { x: number; y: number } | undefined;

/** The nearest point of a polyline to `p`. */
export function nearestOnPolyline(points: [number, number][], p: [number, number]): [number, number] {
  let best: [number, number] = points[0] ?? p;
  let bestD = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = vx * vx + vy * vy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
    const q: [number, number] = [a[0] + vx * t, a[1] + vy * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}

/**
 * The dotted leader of a moved label whose box is `b`: from the label's edge (its background box) to
 * `anchorOf` its centre, the nearest point of what it labels; undefined while the label is close to it.
 */
export function leaderLine(b: Box, anchorOf: (c: [number, number]) => [number, number]): [Pt, Pt] | undefined {
  const a = anchorOf([b.x + b.w / 2, b.y + b.h / 2]);
  const e: Pt = [Math.max(b.x - 4, Math.min(b.x + b.w + 4, a[0])), Math.max(b.y, Math.min(b.y + b.h + 1, a[1]))];
  return Math.hypot(a[0] - e[0], a[1] - e[1]) > 8 ? [e, a] : undefined;
}

/**
 * Adds a label moved by `offset` from its default place. Once it is away from what it labels, a
 * dotted line ties it to the nearest point of that (`anchorOf`, given the label's center).
 */
export function placeLabel(text: TextPrim, offset: Offset, anchorOf: (c: [number, number]) => [number, number], out: Prim[]) {
  const t: TextPrim = { ...text, x: r(text.x + (offset?.x ?? 0)), y: r(text.y + (offset?.y ?? 0)), movable: true };
  if (offset && (offset.x || offset.y)) {
    const leader = leaderLine(textBox(t), anchorOf);
    if (leader) out.push({ t: 'line', x1: r(leader[0][0]), y1: r(leader[0][1]), x2: r(leader[1][0]), y2: r(leader[1][1]), stroke: 'muted', dotted: true });
  }
  out.push(t);
}

/** The point at fraction `t` of a polyline's length, and the segment it is on. */
export function pointAlong(points: Pt[], t: number): { p: Pt; a: Pt; b: Pt } {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q[0] - points[i]![0], q[1] - points[i]![1]));
  const total = lengths.reduce((x, y) => x + y, 0);
  let left = total * Math.min(1, Math.max(0, t));
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (left <= lengths[i]! || i === lengths.length - 1) {
      const f = lengths[i]! ? Math.min(1, left / lengths[i]!) : 0;
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], a, b };
    }
    left -= lengths[i]!;
  }
  return { p: points[0]!, a: points[0]!, b: points[0]! };
}

/**
 * The label of a line at fraction `at` of its length (default: the middle of its middle segment):
 * above a line that runs sideways, to the right of one that runs up or down.
 */
function labelPrim(points: Pt[], text: string, ds: DiagramStyle, at?: number): TextPrim {
  // Modern: muted italic labels above the line.
  const look = ds === 'modern' ? { fill: 'muted' as const, italic: true } : {};
  let a: Pt, b: Pt, mx: number, my: number;
  if (at === undefined) {
    const mid = Math.floor((points.length - 1) / 2);
    a = points[mid]!;
    b = points[mid + 1]!;
    [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  } else {
    const hit = pointAlong(points, at);
    [a, b] = [hit.a, hit.b];
    [mx, my] = hit.p;
  }
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
    ? { t: 'text', x: mx, y: my - 7, text, anchor: 'middle', size: 12, halo: true, ...look }
    : { t: 'text', x: mx + 8, y: my + 4, text, anchor: 'start', size: 12, halo: true, ...look };
}

function midLabel(points: Pt[], text: string, out: Prim[], ds: DiagramStyle = 'classic', offset?: Offset, at?: number) {
  placeLabel(labelPrim(points, text, ds, at), offset, (c) => nearestOnPolyline(points, c), out);
}

export function midpoint(points: [number, number][]): [number, number] {
  const mid = Math.floor((points.length - 1) / 2);
  const a = points[mid]!;
  const b = points[mid + 1]!;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** How to draw one edge: its route, where its label goes, and whether relationship keywords («use», ...) show. */
export interface EdgeDraw extends Route {
  labelAt?: number;
  keywords?: Keywords;
}

/** Corners are rounded in Modern, on lines that have corners. */
const cornerRadius = (ds: DiagramStyle, line: LineShape | undefined) => {
  const shape = line ?? lineShapeOf(undefined, ds);
  return ds === 'modern' && shape !== 'straight' && shape !== 'curved' ? MODERN_RADIUS : 0;
};

/** Which relationship keywords a diagram shows (DiagramShow.keywords): undefined is 'auto'. */
export type Keywords = boolean | 'auto' | undefined;

/**
 * The label of a relationship: its keywords and its label. Keywords: all (true), none (false), or by
 * default all but «use» on a line that has a label (the label already says how it is used).
 */
export function relationshipLabel(rel: Relationship, keywords: Keywords = 'auto'): string {
  const words = keywords === false ? '' : relationshipKeywords(rel, keywords !== true && !!rel.label);
  return [words, rel.label ?? ''].filter(Boolean).join(' ');
}

/** Primitives for one relationship between two shapes. */
export function relationshipPrims(rel: Relationship, from: Shape, to: Shape, waypoints: { x: number; y: number }[], ds: DiagramStyle = 'classic', labelOffset?: Offset, opts: EdgeDraw = {}): Prim[] {
  const out: Prim[] = [];
  let points = edgePoints(from, to, waypoints, ds, opts);
  const style = { ...REL_STYLE[rel.kind] };
  // Provided/required interfaces in lollipop notation.
  if (to.lollipop && rel.kind === 'realization') {
    style.dashed = false;
    style.to = 'none';
  }
  if (to.lollipop && rel.kind === 'usage') {
    style.dashed = false;
    style.to = 'socket';
  }
  if (rel.kind === 'association' || rel.kind === 'aggregation' || rel.kind === 'composition') {
    if (rel.navigable?.to) style.to = 'open';
    if (rel.navigable?.from && style.from === 'none') style.from = 'open';
  }

  // Qualifiers: small boxes attached to the end, the line continues from their far side.
  const qualifier = (end: 'from' | 'to') => {
    const text = rel.qualifier?.[end];
    if (!text) return;
    const idx = end === 'from' ? 0 : points.length - 1;
    const p = points[idx]!;
    const q = points[end === 'from' ? 1 : points.length - 2]!;
    const [ux, uy] = unit(p, q);
    const qw = textWidth(text, 11) + 12;
    const qh = 18;
    const horizontal = Math.abs(ux) >= Math.abs(uy);
    const bx = horizontal ? (ux > 0 ? p[0] : p[0] - qw) : p[0] - qw / 2;
    const by = horizontal ? p[1] - qh / 2 : uy > 0 ? p[1] : p[1] - qh;
    out.push({ t: 'rect', x: bx, y: by, w: qw, h: qh, fill: 'surface', stroke: 'ink' });
    out.push({ t: 'text', x: bx + qw / 2, y: by + 13, text, anchor: 'middle', size: 11 });
    const moved: [number, number] = horizontal ? [ux > 0 ? bx + qw : bx, p[1]] : [p[0], uy > 0 ? by + qh : by];
    points = idx === 0 ? [moved, ...points.slice(1)] : [...points.slice(0, -1), moved];
  };
  qualifier('from');
  qualifier('to');

  const start = points[0]!;
  let end = points.at(-1)!;
  if (style.to === 'socket') {
    // A required interface: the line ends in a half circle around the provided ball.
    const c: [number, number] = [to.box.x + to.box.w / 2, to.box.y + to.box.h / 2];
    const u = unit(points.at(-2)!, c);
    const rr = Math.min(to.box.w, to.box.h) / 2 + 6;
    const p: [number, number] = [-u[1], u[0]];
    const back: [number, number] = [c[0] - u[0] * rr, c[1] - u[1] * rr];
    // Half circle a1 -> back -> a2 as two cubic Bezier quarter arcs (no arc commands in paths).
    const k = 0.5523 * rr;
    const a1: [number, number] = [c[0] + p[0] * rr, c[1] + p[1] * rr];
    const a2: [number, number] = [c[0] - p[0] * rr, c[1] - p[1] * rr];
    const pt = (q: [number, number]) => `${r(q[0])} ${r(q[1])}`;
    const c1: [number, number] = [a1[0] - u[0] * k, a1[1] - u[1] * k];
    const c2: [number, number] = [back[0] + p[0] * k, back[1] + p[1] * k];
    const c3: [number, number] = [back[0] - p[0] * k, back[1] - p[1] * k];
    const c4: [number, number] = [a2[0] - u[0] * k, a2[1] - u[1] * k];
    out.push({ t: 'path', d: `M${pt(a1)} C${pt(c1)} ${pt(c2)} ${pt(back)} C${pt(c3)} ${pt(c4)} ${pt(a2)}`, fill: 'none', stroke: 'ink' });
    end = back;
    points = [...points.slice(0, -1), back];
  }
  out.unshift({ t: 'path', d: polylineD(points, cornerRadius(ds, opts.line)), fill: 'none', stroke: 'ink', dashed: style.dashed });
  drawHead(style.to, end, unit(points.at(-2)!, end), out, ds);
  drawHead(style.from, start, unit(points[1]!, start), out, ds);

  const label = relationshipLabel(rel, opts.keywords);
  if (label) midLabel(points, label, out, ds, labelOffset, opts.labelAt);
  if (rel.condition || rel.extensionPoint) {
    // «extend» condition and extension point: a note attached to the relationship (16.3.3).
    const lines = [rel.condition ? `Condition: {${rel.condition}}` : '', rel.extensionPoint ? `extension point: ${rel.extensionPoint}` : ''].filter(Boolean);
    // Anchored a third of the way along the middle segment, clear of the «extend» label.
    const mi = Math.floor((points.length - 1) / 2);
    const [pa, pb] = [points[mi]!, points[mi + 1]!];
    const [mx, my] = [pa[0] + (pb[0] - pa[0]) * 0.3, pa[1] + (pb[1] - pa[1]) * 0.3];
    const nw = Math.max(...lines.map((l) => textWidth(l, 11))) + 20;
    const nh = lines.length * 15 + 10;
    const nx = mx + 24;
    const ny = my - nh - 30;
    out.push({ t: 'line', x1: mx, y1: my, x2: nx + 10, y2: ny + nh, stroke: 'ink', dashed: true });
    out.push({ t: 'path', d: `M${nx} ${ny} L${nx + nw - 10} ${ny} L${nx + nw} ${ny + 10} L${nx + nw} ${ny + nh} L${nx} ${ny + nh} Z`, fill: 'alt', stroke: 'ink' });
    lines.forEach((l, k) => out.push({ t: 'text', x: nx + 8, y: ny + 17 + k * 15, text: l, size: 11 }));
  }
  if (rel.multiplicity?.from) endText(start, points[1]!, 1, rel.multiplicity.from, out);
  if (rel.multiplicity?.to) endText(end, points.at(-2)!, -1, rel.multiplicity.to, out);
  if (rel.roles?.from) endText(start, points[1]!, -1, rel.roles.from, out);
  if (rel.roles?.to) endText(end, points.at(-2)!, 1, rel.roles.to, out);
  return out;
}

/** Primitives for a local edge (transition, control/object flow, note anchor). */
export function localEdgePrims(edge: LocalEdge, from: Shape, to: Shape, ds: DiagramStyle = 'classic', opts: EdgeDraw = {}): Prim[] {
  const out: Prim[] = [];
  const line = opts.line ?? lineShapeOf(edge.style, ds);
  let points = edgePoints(from, to, edge.waypoints, ds, { ...opts, line });
  const radius = edge.kind !== 'interrupt' ? cornerRadius(ds, line) : 0;
  if (edge.kind === 'interrupt') {
    // Interrupting edge (12.3.31): a lightning bolt in the middle of the line.
    const i = Math.floor((points.length - 1) / 2);
    const a = points[i]!;
    const b = points[i + 1]!;
    const [ux, uy] = unit(a, b);
    const [nx, ny] = [-uy, ux];
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const bolt: [number, number][] = [
      [mx - ux * 12, my - uy * 12],
      [mx + nx * 8 + ux * 3, my + ny * 8 + uy * 3],
      [mx - nx * 8 - ux * 3, my - ny * 8 - uy * 3],
      [mx + ux * 12, my + uy * 12],
    ];
    points = [...points.slice(0, i + 1), ...bolt, ...points.slice(i + 1)];
  }
  out.push({ t: 'path', d: polylineD(points, radius), fill: 'none', stroke: 'ink', dashed: edge.kind === 'anchor' });
  if (edge.kind !== 'anchor') drawHead('open', points.at(-1)!, unit(points.at(-2)!, points.at(-1)!), out, ds);
  if (edge.label) midLabel(points, edge.label, out, ds, edge.labelOffset, opts.labelAt);
  return out;
}

// ---------------------------------------------------------------------------
// whole diagram
// ---------------------------------------------------------------------------

export interface LaidOutNode {
  id: string;
  /** 'model' for element refs, 'local' for diagram-local nodes. */
  source: 'model' | 'local';
  box: Box;
  outline: Outline;
  lollipop: boolean;
  container: boolean;
  /** A component containing use cases: the system boundary (subject) of a use case diagram. */
  subject?: boolean;
  /** A region after the first in its state: drawn with a dashed separator on top. */
  separator?: boolean;
  /** Ports, pins, entry / exit points: the border of the parent they sit on (labels go outside). */
  side?: 'left' | 'right' | 'top' | 'bottom';
  parent?: string;
  depth: number;
}

/**
 * The room a container keeps around its children: `pad` on every side, plus `header` above them for
 * «keywords», the name and the property strings. Regions get a small inset (and room for their name);
 * a state holding regions only needs its name compartment.
 */
export function containerInset(el: Element | undefined, localKind: string | undefined, localName: string | undefined, subject: boolean, holdsRegions: boolean, width = Infinity): { pad: number; header: number } {
  const isRegion = localKind === 'region';
  const pad = isRegion ? 10 : holdsRegions ? 0 : 16;
  const header = el ? 34 + (keywordText(el, subject) ? 16 : 0) + propertyLines(el, Math.min(width, PROPS_MAX) - 24).length * PROP_LINE : isRegion ? (localName ? 14 : 0) : holdsRegions ? 28 : 34;
  return { pad, header };
}

/** The model as a diagram shows it: without tagged values unless the diagram shows them. */
export function displayModel(model: Model, diagram: Pick<CanvasDiagram, 'show'>): Model {
  if (diagram.show?.tags) return model;
  if (!model.elements.some((e) => e.tags)) return model;
  return { ...model, elements: model.elements.map((e) => (e.tags ? (({ tags: _, ...rest }) => rest)(e) : e)) };
}

/**
 * Absolute boxes of every node: default sizes, class boxes grown to their members,
 * containers grown around their children, ports snapped to their component's border.
 */
export function layoutNodes(diagram: CanvasDiagram, model: Model): Map<string, LaidOutNode> {
  model = displayModel(model, diagram);
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const result = new Map<string, LaidOutNode>();
  const onDiagram = new Set([...diagram.nodes.map((n) => n.ref), ...diagram.local.nodes.map((n) => n.id)]);

  const add = (id: string, source: 'model' | 'local', kind: string, n: { x: number; y: number; w?: number; h?: number }, parent: string | undefined, lollipop: boolean, min: [number, number]) => {
    const [dw, dh] = DEFAULT_SIZE[lollipop ? 'lollipop' : kind] ?? [160, 70];
    const w = Math.max(n.w ?? dw, min[0]);
    const h = Math.max(n.h ?? dh, min[1]);
    result.set(id, { id, source, box: { x: n.x, y: n.y, w, h }, outline: outlineOf(kind, lollipop), lollipop, container: false, parent: parent && onDiagram.has(parent) ? parent : undefined, depth: 0 });
  };
  for (const n of diagram.nodes) {
    const e = elements.get(n.ref);
    const lollipop = e?.kind === 'interface' && n.style?.notation === 'lollipop';
    add(n.ref, 'model', e?.kind ?? 'component', n, e?.parent, lollipop, minSize(e, lollipop, e?.classifier ? elements.get(e.classifier) : undefined, n.w));
  }
  for (const n of diagram.local.nodes) {
    if (n.kind === 'note') {
      const [w, h] = noteSize(n.text ?? n.name ?? '', n.w, n.h);
      add(n.id, 'local', n.kind, { ...n, w, h }, n.parent, false, [0, 0]);
    } else add(n.id, 'local', n.kind, n, n.parent, false, [0, 0]);
  }

  // Depths for containment (children inside parents; cycles are cut).
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const node = result.get(id);
    if (!node?.parent || seen.has(id)) return 0;
    seen.add(id);
    return 1 + depthOf(node.parent, seen);
  };
  for (const node of result.values()) node.depth = depthOf(node.id);

  // Grow containers around their children, deepest first. Ports, pins and entry / exit points sit on the border instead.
  const localKind = new Map(diagram.local.nodes.map((n) => [n.id, n.kind]));
  const localName = new Map(diagram.local.nodes.map((n) => [n.id, n.name ?? '']));
  const isPort = (id: string) => elements.get(id)?.kind === 'port' || BORDER_LOCAL_KINDS.has(localKind.get(id) ?? '');
  const byDepth = [...result.values()].sort((a, b) => b.depth - a.depth);
  for (const node of byDepth) {
    const kids = [...result.values()].filter((c) => c.parent === node.id && !isPort(c.id));
    if (kids.length === 0) continue;
    node.container = true;
    const el = elements.get(node.id);
    // A component holding use cases is the subject (system boundary) of a use case diagram.
    node.subject = el?.kind === 'component' && kids.some((k) => elements.get(k.id)?.kind === 'usecase');
    const holdsRegions = kids.some((k) => localKind.get(k.id) === 'region');
    const { pad, header } = containerInset(el, localKind.get(node.id), localName.get(node.id), node.subject, holdsRegions, node.box.w);
    const minX = Math.min(...kids.map((k) => k.box.x)) - pad;
    const minY = Math.min(...kids.map((k) => k.box.y)) - pad - header;
    const maxX = Math.max(...kids.map((k) => k.box.x + k.box.w)) + pad;
    const maxY = Math.max(...kids.map((k) => k.box.y + k.box.h)) + pad;
    const b = node.box;
    const x = Math.min(b.x, minX);
    const y = Math.min(b.y, minY);
    node.box = { x, y, w: Math.max(b.x + b.w, maxX) - x, h: Math.max(b.y + b.h, maxY) - y };
    // Orthogonal regions fill their state: full width, stacked from the name compartment down.
    const regions = kids.filter((k) => localKind.get(k.id) === 'region').sort((a, b) => a.box.y - b.box.y);
    if (regions.length) {
      const nb = node.box;
      regions.forEach((rg, i) => {
        const top = i === 0 ? nb.y + 28 : rg.box.y;
        const next = regions[i + 1];
        const bottom = next ? next.box.y : nb.y + nb.h;
        rg.box = { x: nb.x, y: top, w: nb.w, h: Math.max(20, bottom - top) };
        rg.separator = i > 0;
      });
    }
  }
  for (const node of result.values()) {
    if (!isPort(node.id) || !node.parent) continue;
    const p = result.get(node.parent)!.box;
    const b = node.box;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    // Snap the port's center to the nearest border of its component.
    const d = [Math.abs(cx - p.x), Math.abs(cx - (p.x + p.w)), Math.abs(cy - p.y), Math.abs(cy - (p.y + p.h))];
    const side = d.indexOf(Math.min(...d));
    const clampX = Math.min(Math.max(cx, p.x + b.w), p.x + p.w - b.w);
    const clampY = Math.min(Math.max(cy, p.y + b.h), p.y + p.h - b.h);
    const [nx, ny] = side === 0 ? [p.x, clampY] : side === 1 ? [p.x + p.w, clampY] : side === 2 ? [clampX, p.y] : [clampX, p.y + p.h];
    node.box = { ...b, x: nx - b.w / 2, y: ny - b.h / 2 };
    node.side = (['left', 'right', 'top', 'bottom'] as const)[side];
  }
  return result;
}

/** The key of an edge in edgeLayouts: m:<relationship ref> or l:<local edge id>. */
export const edgeKey = (source: 'model' | 'local', id: string) => `${source === 'model' ? 'm' : 'l'}:${id}`;

/** Edges between the same two shapes are this far apart. */
const PARALLEL_GAP = 20;
/** Where along its line a label may go (fractions of the length), best first. */
const LABEL_SPOTS = [0.5, 0.35, 0.65, 0.22, 0.78];

const boxesOverlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Whether the segment p-q runs through the inside of a box shrunk by `inset` (Liang-Barsky clipping). */
export function segmentCrossesBox(p: Pt, q: Pt, b: Box, inset = 3): boolean {
  const x0 = b.x + inset;
  const y0 = b.y + inset;
  const x1 = b.x + b.w - inset;
  const y1 = b.y + b.h - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  for (const [pp, qq] of [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]] as const) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
  }
  return t1 - t0 > 1e-6;
}

/** The box a label takes (as labelPrim places it). */
export function labelBox(points: Pt[], text: string, ds: DiagramStyle, at?: number): Box {
  return textBox(labelPrim(points, text, ds, at));
}

/**
 * How every edge of a canvas diagram is drawn, so the editor and the exports agree:
 *  - its line shape (its own, else the diagram style's);
 *  - edges between the same two shapes (either direction, no bend points) are spread apart sideways;
 *  - its label goes to the first place along the line where it covers no shape and no other label
 *    (a label moved by hand stays where it was put).
 */
export function edgeLayouts(diagram: CanvasDiagram, model: Model, nodes: Map<string, LaidOutNode>, ds: DiagramStyle = 'classic'): Map<string, EdgeDraw> {
  const relationships = new Map(model.relationships.map((r) => [r.id, r]));
  const keywords = diagram.show?.keywords;
  type Item = { key: string; from: string; to: string; waypoints: { x: number; y: number }[]; style?: Record<string, string>; label: string; offset?: { x: number; y: number } };
  const items: Item[] = [];
  for (const e of diagram.edges) {
    const rel = relationships.get(e.ref);
    if (!rel || !nodes.has(rel.from) || !nodes.has(rel.to)) continue;
    items.push({ key: edgeKey('model', e.ref), from: rel.from, to: rel.to, waypoints: e.waypoints, style: e.style, label: relationshipLabel(rel, keywords), offset: e.labelOffset });
  }
  for (const e of diagram.local.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    items.push({ key: edgeKey('local', e.id), from: e.from, to: e.to, waypoints: e.waypoints, style: e.style, label: e.label ?? '', offset: e.labelOffset });
  }

  const out = new Map<string, EdgeDraw>();
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    out.set(it.key, { line: lineShapeOf(it.style, ds), keywords });
    if (it.from === it.to || it.waypoints.length) continue;
    const pair = [it.from, it.to].sort().join(' ');
    groups.set(pair, [...(groups.get(pair) ?? []), it]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // One sideways direction for the pair, whichever way each edge points.
    const [first, second] = [group[0]!.from, group[0]!.to].sort();
    const u = unit(centerOf(nodes.get(first!)!.box), centerOf(nodes.get(second!)!.box));
    const perp: Pt = [-u[1], u[0]];
    group.forEach((it, k) => (out.get(it.key)!.offset = { by: (k - (group.length - 1) / 2) * PARALLEL_GAP, perp }));
  }

  // Right-angled lines that leave or enter the same side of a shape: spread along that side, in the
  // order of where their other ends are (so they do not cross), instead of meeting in one point.
  const sides = new Map<string, { it: Item; end: 'from' | 'to'; key: number }[]>();
  const sideOf = (b: Box, p: Pt) => {
    const d = [Math.abs(p[1] - b.y), Math.abs(p[1] - (b.y + b.h)), Math.abs(p[0] - b.x), Math.abs(p[0] - (b.x + b.w))];
    return (['top', 'bottom', 'left', 'right'] as const)[d.indexOf(Math.min(...d))]!;
  };
  for (const it of items) {
    const draw = out.get(it.key)!;
    if (it.from === it.to || it.waypoints.length || draw.offset || !(draw.line === 'orthogonal' || draw.line === 'horizontalFirst' || draw.line === 'verticalFirst')) continue;
    const a = nodes.get(it.from)!;
    const b = nodes.get(it.to)!;
    if (a.side || b.side || a.lollipop || b.lollipop) continue;
    const pts = edgePoints({ box: a.box, outline: a.outline }, { box: b.box, outline: b.outline }, [], ds, { line: draw.line });
    for (const [end, node, other, p] of [['from', a, b, pts[0]!], ['to', b, a, pts.at(-1)!]] as const) {
      const side = sideOf(node.box, p);
      const along = side === 'top' || side === 'bottom' ? centerOf(other.box)[0] : centerOf(other.box)[1];
      const k = `${node.id} ${side}`;
      sides.set(k, [...(sides.get(k) ?? []), { it, end, key: along }]);
    }
  }
  for (const [k, list] of sides) {
    if (list.length < 2) continue;
    const node = nodes.get(k.slice(0, k.lastIndexOf(' ')))!;
    const vertical = / (left|right)$/.test(k);
    const room = (vertical ? node.box.h : node.box.w) * 0.8;
    const gap = Math.min(16, room / list.length);
    list.sort((x, y) => x.key - y.key).forEach((e, i) => {
      const draw = out.get(e.it.key)!;
      draw.ports = { ...draw.ports, [e.end]: (i - (list.length - 1) / 2) * gap };
    });
  }

  // Labels: shapes, labels moved by hand (they stay where they were put) and the labels placed so far are in the way.
  const obstacles = [...nodes.values()].filter((n) => !n.container).map((n) => n.box);
  const placed: Box[] = [];
  const pointsOf = (it: Item) => {
    const a = nodes.get(it.from)!;
    const b = nodes.get(it.to)!;
    return edgePoints({ box: a.box, outline: a.outline, lollipop: a.lollipop }, { box: b.box, outline: b.outline, lollipop: b.lollipop }, it.waypoints, ds, out.get(it.key)!);
  };
  for (const it of items) {
    if (!it.label || !it.offset) continue;
    const box = labelBox(pointsOf(it), it.label, ds);
    placed.push({ ...box, x: box.x + it.offset.x, y: box.y + it.offset.y });
  }
  // Other lines through a label are in the way too (each costs half the label's area).
  const lines = new Map(items.map((it) => [it.key, pointsOf(it)]));
  const crossedBy = (box: Box, key: string) => {
    let n = 0;
    for (const [k, pts] of lines) if (k !== key && pts.slice(1).some((q, i) => segmentCrossesBox(pts[i]!, q, box, 1))) n++;
    return n;
  };
  for (const it of items) {
    if (!it.label || it.offset) continue;
    const draw = out.get(it.key)!;
    const points = lines.get(it.key)!;
    let best: { at: number; cost: number; box: Box } | undefined;
    for (const at of LABEL_SPOTS) {
      const box = labelBox(points, it.label, ds, at);
      const cost =
        [...obstacles, ...placed].reduce((sum, o) => sum + (boxesOverlap(box, o) ? overlapArea(box, o) : 0), 0) + (crossedBy(box, it.key) * box.w * box.h) / 2;
      if (!best || cost < best.cost) best = { at, cost, box };
      if (cost === 0) break;
    }
    if (!best) continue;
    if (best.at !== 0.5) draw.labelAt = best.at;
    placed.push(best.box);
  }
  return out;
}

/** `file`: the diagram's own path, so elements detailed on it get no link to themselves. */
export function layoutCanvas(diagram: CanvasDiagram, model: Model, ds: DiagramStyle = 'classic', file?: string): Scene {
  model = displayModel(model, diagram);
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const relationships = new Map(model.relationships.map((rel) => [rel.id, rel]));
  const locals = new Map(diagram.local.nodes.map((n) => [n.id, n]));
  const nodes = layoutNodes(diagram, model);
  const draws = edgeLayouts(diagram, model, nodes, ds);
  const shape = (id: string): Shape | undefined => {
    const n = nodes.get(id);
    return n && { box: n.box, outline: n.outline, lollipop: n.lollipop };
  };

  const nodePrims: Prim[] = [];
  // Parents first, so children are drawn on top; ports last.
  const order = [...nodes.values()].sort((a, b) => a.depth - b.depth || Number(elements.get(a.id)?.kind === 'port') - Number(elements.get(b.id)?.kind === 'port'));
  for (const n of order) {
    if (n.source === 'model') {
      const el = elements.get(n.id);
      const prims = elementPrims(el, n.id, n.box, { container: n.container, lollipop: n.lollipop, subject: n.subject, classifier: el?.classifier ? elements.get(el.classifier) : undefined });
      nodePrims.push(...fillShapes(prims, ds, { container: n.container, external: el?.kind === 'externalSystem' }));
      const detail = detailOf(el, file, n.lollipop);
      if (detail) nodePrims.push(...detailMarker(n.box, detail));
    } else nodePrims.push(...fillShapes(localNodePrims(locals.get(n.id)!, n.box, n.container, { separator: n.separator, side: n.side }), ds, { container: n.container }));
  }

  const edgePrims: Prim[] = [];
  for (const edge of diagram.edges) {
    const rel = relationships.get(edge.ref);
    const from = rel && shape(rel.from);
    const to = rel && shape(rel.to);
    if (!rel || !from || !to) continue;
    const draw = draws.get(edgeKey('model', edge.ref));
    edgePrims.push(...relationshipPrims(rel, from, to, edge.waypoints, ds, edge.labelOffset, draw));
    // Association class: dashed line from the middle of the association to the class.
    const cls = rel.associationClass && shape(rel.associationClass);
    if (cls) {
      const [mx, my] = midpoint(edgePoints(from, to, edge.waypoints, ds, draw));
      const [ex, ey] = clipTo(cls.box, cls.outline, mx, my);
      edgePrims.push({ t: 'line', x1: mx, y1: my, x2: ex, y2: ey, stroke: 'ink', dashed: true });
    }
  }
  for (const edge of diagram.local.edges) {
    const from = shape(edge.from);
    const to = shape(edge.to);
    if (from && to) edgePrims.push(...localEdgePrims(edge, from, to, ds, draws.get(edgeKey('local', edge.id))));
  }

  return withStyle(normalize(roundCorners([...nodePrims, ...edgePrims], ds)), ds);
}

export type { DiagramNode };
