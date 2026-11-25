// A small XML parser and serializer for ReqIF files. It keeps what it does not change: text and
// attributes are written back as they were read (entities and all), comments and processing
// instructions stay where they were, and the content of XHTML values and tool extensions is written
// verbatim. Element-only content elsewhere is re-indented, so inserted elements line up.

export interface XAttr {
  name: string;
  value: string;
  /** The source text between the quotes, written back while `value` is unchanged. */
  raw?: string;
  rawOf?: string;
}

export interface XElement {
  type: 'element';
  name: string;
  attrs: XAttr[];
  children: XNode[];
}

export interface XText {
  type: 'text';
  value: string;
  raw?: string;
  rawOf?: string;
}

/** Comments, CDATA sections, processing instructions and the doctype, kept as written. */
export interface XRaw {
  type: 'raw';
  text: string;
}

export type XNode = XElement | XText | XRaw;

export interface XDocument {
  /** What comes before the root element (XML declaration, comments). */
  prolog: XRaw[];
  root: XElement;
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');

/** The name without its namespace prefix: `xhtml:div` -> `div`. */
export const localName = (name: string) => name.slice(name.indexOf(':') + 1);

export function parseXml(source: string): XDocument {
  const s = source.replace(/^﻿/, '');
  let i = 0;
  const fail = (message: string): never => {
    const line = s.slice(0, i).split('\n').length;
    throw new XmlError(`${message} (line ${line})`);
  };

  const readRaw = (): XRaw | undefined => {
    for (const [open, close] of [['<!--', '-->'], ['<![CDATA[', ']]>'], ['<?', '?>']] as const) {
      if (s.startsWith(open, i)) {
        const end = s.indexOf(close, i + open.length);
        if (end < 0) fail(`Unclosed ${open}`);
        const text = s.slice(i, end + close.length);
        i = end + close.length;
        return { type: 'raw', text };
      }
    }
    if (s.startsWith('<!DOCTYPE', i)) {
      // A doctype may hold an internal subset in brackets.
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === '[') depth++;
        else if (s[j] === ']') depth--;
        else if (s[j] === '>' && depth === 0) break;
      }
      const text = s.slice(i, j + 1);
      i = j + 1;
      return { type: 'raw', text };
    }
    return undefined;
  };

  const NAME = /[^\s/>=]+/y;
  const readName = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(s);
    if (!m) fail('Expected a name');
    i += m![0].length;
    return m![0];
  };
  const skipSpace = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };

  const readElement = (): XElement => {
    i++; // <
    const name = readName();
    const attrs: XAttr[] = [];
    for (;;) {
      skipSpace();
      if (s.startsWith('/>', i)) {
        i += 2;
        return { type: 'element', name, attrs, children: [] };
      }
      if (s[i] === '>') {
        i++;
        break;
      }
      if (i >= s.length) fail(`Unclosed tag <${name}>`);
      const attrName = readName();
      skipSpace();
      if (s[i] !== '=') fail(`Expected = after ${attrName}`);
      i++;
      skipSpace();
      const quote = s[i];
      if (quote !== '"' && quote !== "'") fail(`Expected a quoted value for ${attrName}`);
      const end = s.indexOf(quote!, i + 1);
      if (end < 0) fail(`Unclosed value of ${attrName}`);
      const raw = s.slice(i + 1, end);
      const value = decodeEntities(raw.replace(/[\r\n\t]/g, ' '));
      attrs.push({ name: attrName, value, raw, rawOf: value });
      i = end + 1;
    }
    const children = readChildren(name);
    return { type: 'element', name, attrs, children };
  };

  const readChildren = (parent: string | undefined): XNode[] => {
    const children: XNode[] = [];
    while (i < s.length) {
      if (s.startsWith('</', i)) {
        if (parent === undefined) fail('Unexpected closing tag');
        i += 2;
        const name = readName();
        if (name !== parent) fail(`Expected </${parent}>, found </${name}>`);
        skipSpace();
        if (s[i] !== '>') fail(`Unclosed </${name}`);
        i++;
        return children;
      }
      if (s[i] === '<') {
        const raw = readRaw();
        if (raw) children.push(raw);
        else children.push(readElement());
        continue;
      }
      const end = s.indexOf('<', i);
      const raw = s.slice(i, end < 0 ? s.length : end);
      i += raw.length;
      const value = decodeEntities(raw);
      children.push({ type: 'text', value, raw, rawOf: value });
    }
    if (parent !== undefined) fail(`Unclosed element <${parent}>`);
    return children;
  };

  const top = readChildren(undefined);
  const rootIndex = top.findIndex((n) => n.type === 'element');
  if (rootIndex < 0) throw new XmlError('No root element');
  const prolog = top.slice(0, rootIndex).filter((n): n is XRaw => n.type === 'raw');
  return { prolog, root: top[rootIndex] as XElement };
}

// ---------------------------------------------------------------------------
// building and querying
// ---------------------------------------------------------------------------

export function el(name: string, attrs: Record<string, string | undefined> = {}, children: (XNode | string)[] = []): XElement {
  return {
    type: 'element',
    name,
    attrs: Object.entries(attrs)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([n, value]) => ({ name: n, value })),
    children: children.map((c) => (typeof c === 'string' ? { type: 'text', value: c } : c)),
  };
}

export const elements = (e: XElement | undefined): XElement[] => (e ? (e.children.filter((c) => c.type === 'element') as XElement[]) : []);
/** The child elements with this local name. */
export const kids = (e: XElement | undefined, name: string): XElement[] => elements(e).filter((c) => localName(c.name) === name);
export const kid = (e: XElement | undefined, name: string): XElement | undefined => kids(e, name)[0];
/** The element at a path of local names. */
export const at = (e: XElement | undefined, ...path: string[]): XElement | undefined => path.reduce<XElement | undefined>((cur, n) => kid(cur, n), e);

export const attr = (e: XElement | undefined, name: string): string | undefined => e?.attrs.find((a) => a.name === name)?.value;

export function setAttr(e: XElement, name: string, value: string | undefined): void {
  const i = e.attrs.findIndex((a) => a.name === name);
  if (value === undefined) {
    if (i >= 0) e.attrs.splice(i, 1);
  } else if (i >= 0) {
    if (e.attrs[i]!.value !== value) e.attrs[i] = { name, value };
  } else e.attrs.push({ name, value });
}

/** The child with this local name, created (with the parent's namespace prefix) when missing. */
export function ensureKid(parent: XElement, name: string): XElement {
  const found = kid(parent, name);
  if (found) return found;
  const prefix = parent.name.includes(':') ? parent.name.slice(0, parent.name.indexOf(':') + 1) : '';
  const created = el(prefix + name);
  parent.children.push(created);
  return created;
}

export function textOf(e: XElement | undefined): string {
  if (!e) return '';
  return e.children.map((c) => (c.type === 'text' ? c.value : c.type === 'element' ? textOf(c) : c.text.startsWith('<![CDATA[') ? c.text.slice(9, -3) : '')).join('');
}

// ---------------------------------------------------------------------------
// serializing
// ---------------------------------------------------------------------------

export interface SerializeOptions {
  /** Elements (by local name) whose content is written as it is, not re-indented. */
  verbatim?: ReadonlySet<string>;
  indent?: string;
}

const attrText = (a: XAttr) => ` ${a.name}="${a.raw !== undefined && a.rawOf === a.value ? a.raw : escapeAttr(a.value)}"`;

export function serializeXml(doc: XDocument, options: SerializeOptions = {}): string {
  const indent = options.indent ?? '  ';
  const verbatim = options.verbatim ?? new Set<string>();
  const out: string[] = [];

  const writeNode = (n: XNode, depth: number, pretty: boolean): void => {
    if (n.type === 'text') out.push(n.raw !== undefined && n.rawOf === n.value ? n.raw : escapeText(n.value));
    else if (n.type === 'raw') out.push(n.text);
    else writeElement(n, depth, pretty);
  };

  const writeElement = (e: XElement, depth: number, pretty: boolean): void => {
    out.push(`<${e.name}${e.attrs.map(attrText).join('')}`);
    if (e.children.length === 0) {
      out.push('/>');
      return;
    }
    out.push('>');
    const elementOnly = e.children.every((c) => c.type !== 'text' || !c.value.trim());
    if (pretty && elementOnly && !verbatim.has(localName(e.name))) {
      for (const c of e.children) {
        if (c.type === 'text') continue;
        out.push(`\n${indent.repeat(depth + 1)}`);
        writeNode(c, depth + 1, true);
      }
      out.push(`\n${indent.repeat(depth)}`);
    } else {
      for (const c of e.children) writeNode(c, depth + 1, false);
    }
    out.push(`</${e.name}>`);
  };

  for (const p of doc.prolog) out.push(p.text, '\n');
  if (!doc.prolog.some((p) => p.text.startsWith('<?xml'))) out.unshift('<?xml version="1.0" encoding="UTF-8"?>\n');
  writeElement(doc.root, 0, true);
  out.push('\n');
  return out.join('');
}
