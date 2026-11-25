// The parts of a ReqIF 1.x document (OMG Requirements Interchange Format, https://www.omg.org/reqif/)
// that Archery reads and writes: datatypes, spec types with their attribute definitions, spec
// objects with their attribute values, the specifications' hierarchies and spec relations.
// Attribute names follow the ProSTEP ReqIF Implementation Guide (ReqIF.ForeignID, ReqIF.Text, ...).
import { markdownToXhtml, xhtmlToMarkdown } from './xhtml';
import { at, attr, el, elements, ensureKid, kid, kids, localName, parseXml, textOf, type XDocument, type XElement } from './xml';

export const REQIF_NS = 'http://www.omg.org/spec/ReqIF/20110401/reqif.xsd';
export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Content written as it is read: formatted text and other tools' extensions. */
export const VERBATIM = new Set(['THE-VALUE', 'THE-ORIGINAL-VALUE', 'TOOL-EXTENSIONS']);

export class ReqifError extends Error {}

export type DatatypeKind = 'STRING' | 'XHTML' | 'ENUMERATION' | 'INTEGER' | 'REAL' | 'BOOLEAN' | 'DATE';
const KINDS: DatatypeKind[] = ['STRING', 'XHTML', 'ENUMERATION', 'INTEGER', 'REAL', 'BOOLEAN', 'DATE'];

export interface Datatype {
  id: string;
  kind: DatatypeKind;
  name: string;
  el: XElement;
}

export interface AttrDef {
  id: string;
  name: string;
  kind: DatatypeKind;
  datatype: string;
  multiValued: boolean;
  el: XElement;
}

export interface SpecType {
  id: string;
  name: string;
  /** SPEC-OBJECT-TYPE, SPECIFICATION-TYPE, SPEC-RELATION-TYPE or RELATION-GROUP-TYPE. */
  tag: string;
  attrs: AttrDef[];
  el: XElement;
}

/** The fields of a requirement that come from attributes; everything else goes to `attributes`. */
export type MappedField = 'id' | 'heading' | 'title' | 'text' | 'status' | 'priority';

/** The attribute (long) names each field is read from, preferred name first (case is ignored). */
export const FIELD_NAMES: Record<MappedField, string[]> = {
  id: ['ReqIF.ForeignID'],
  heading: ['ReqIF.ChapterName'],
  title: ['ReqIF.Name'],
  text: ['ReqIF.Text'],
  status: ['Status', 'ReqIF.Status', 'State'],
  priority: ['Priority', 'ReqIF.Priority'],
};
export const MAPPED_FIELDS = Object.keys(FIELD_NAMES) as MappedField[];

/** A ReqIF document with indexes over its content. Changes go to `doc` (re-index with `reindex`). */
export class Reqif {
  readonly datatypes = new Map<string, Datatype>();
  readonly types = new Map<string, SpecType>();
  readonly objects = new Map<string, XElement>();

  constructor(readonly doc: XDocument) {
    if (localName(doc.root.name) !== 'REQ-IF') throw new ReqifError('This is not a ReqIF file (its root element is not REQ-IF).');
    this.reindex();
  }

  static parse(xml: string): Reqif {
    return new Reqif(parseXml(xml));
  }

  /** REQ-IF-CONTENT, created when missing. */
  get content(): XElement {
    return ensureKid(ensureKid(this.doc.root, 'CORE-CONTENT'), 'REQ-IF-CONTENT');
  }

  /** A section of REQ-IF-CONTENT (DATATYPES, SPEC-TYPES, SPEC-OBJECTS, ...), created when missing. */
  part(name: string): XElement {
    return ensureKid(this.content, name);
  }

  reindex(): void {
    this.datatypes.clear();
    this.types.clear();
    this.objects.clear();
    const content = at(this.doc.root, 'CORE-CONTENT', 'REQ-IF-CONTENT');
    for (const d of elements(kid(content, 'DATATYPES'))) {
      const kind = localName(d.name).replace('DATATYPE-DEFINITION-', '') as DatatypeKind;
      const id = attr(d, 'IDENTIFIER');
      if (id && KINDS.includes(kind)) this.datatypes.set(id, { id, kind, name: attr(d, 'LONG-NAME') ?? id, el: d });
    }
    for (const t of elements(kid(content, 'SPEC-TYPES'))) {
      const id = attr(t, 'IDENTIFIER');
      if (!id) continue;
      const attrs: AttrDef[] = [];
      for (const a of elements(kid(t, 'SPEC-ATTRIBUTES'))) {
        const kind = localName(a.name).replace('ATTRIBUTE-DEFINITION-', '') as DatatypeKind;
        const aid = attr(a, 'IDENTIFIER');
        if (!aid || !KINDS.includes(kind)) continue;
        const datatype = textOf(elements(kid(a, 'TYPE'))[0]).trim();
        attrs.push({ id: aid, name: attr(a, 'LONG-NAME') ?? aid, kind, datatype, multiValued: attr(a, 'MULTI-VALUED') === 'true', el: a });
      }
      this.types.set(id, { id, name: attr(t, 'LONG-NAME') ?? id, tag: localName(t.name), attrs, el: t });
    }
    for (const o of kids(kid(content, 'SPEC-OBJECTS'), 'SPEC-OBJECT')) {
      const id = attr(o, 'IDENTIFIER');
      if (id) this.objects.set(id, o);
    }
  }

  /** The type an element (spec object, specification, relation) refers to. */
  typeOf(e: XElement): SpecType | undefined {
    return this.types.get(refOf(e, 'TYPE'));
  }

  attrDef(type: SpecType | undefined, id: string): AttrDef | undefined {
    return type?.attrs.find((a) => a.id === id);
  }

  /** The values of an element by attribute definition id. */
  values(e: XElement): Map<string, XElement> {
    const out = new Map<string, XElement>();
    for (const v of elements(kid(e, 'VALUES'))) {
      const def = refOf(v, 'DEFINITION');
      if (def) out.set(def, v);
    }
    return out;
  }

  /** An attribute value as Archery text (formatted text as Markdown, enumerations as their names). */
  valueText(def: AttrDef, value: XElement | undefined): string {
    const v = value ?? elements(kid(def.el, 'DEFAULT-VALUE'))[0];
    if (!v) return '';
    switch (def.kind) {
      case 'XHTML':
        return xhtmlToMarkdown(kid(v, 'THE-VALUE')?.children ?? []);
      case 'ENUMERATION': {
        const literals = this.enumValues(def);
        return elements(kid(v, 'VALUES'))
          .map((r) => textOf(r).trim())
          .map((id) => literals.find((l) => l.id === id)?.name ?? id)
          .join(', ');
      }
      default:
        return attr(v, 'THE-VALUE') ?? '';
    }
  }

  enumValues(def: AttrDef): { id: string; name: string; el: XElement }[] {
    const d = this.datatypes.get(def.datatype);
    return kids(kid(d?.el, 'SPECIFIED-VALUES'), 'ENUM-VALUE').map((e) => ({ id: attr(e, 'IDENTIFIER') ?? '', name: attr(e, 'LONG-NAME') ?? attr(e, 'IDENTIFIER') ?? '', el: e }));
  }

  /** A new value element for `def` holding `text` (Archery text), or an error message. */
  valueElement(def: AttrDef, text: string, now: string): XElement {
    const tag = `ATTRIBUTE-VALUE-${def.kind}`;
    const definition = el('DEFINITION', {}, [el(`ATTRIBUTE-DEFINITION-${def.kind}-REF`, {}, [def.id])]);
    const bad = (what: string): never => {
      throw new ReqifError(`"${text}" is not ${what} (attribute "${def.name}")`);
    };
    switch (def.kind) {
      case 'XHTML':
        return el(tag, {}, [definition, el('THE-VALUE', {}, [markdownToXhtml(text)])]);
      case 'STRING':
        return el(tag, { 'THE-VALUE': text }, [definition]);
      case 'INTEGER':
        if (!/^[+-]?\d+$/.test(text.trim())) bad('a whole number');
        return el(tag, { 'THE-VALUE': String(Number(text.trim())) }, [definition]);
      case 'REAL':
        if (!Number.isFinite(Number(text.trim())) || !text.trim()) bad('a number');
        return el(tag, { 'THE-VALUE': text.trim() }, [definition]);
      case 'BOOLEAN': {
        const t = text.trim().toLowerCase();
        const b = ['true', 'yes', '1'].includes(t) ? 'true' : ['false', 'no', '0'].includes(t) ? 'false' : bad('true or false');
        return el(tag, { 'THE-VALUE': b }, [definition]);
      }
      case 'DATE': {
        const t = /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ? `${text.trim()}T00:00:00Z` : text.trim();
        if (Number.isNaN(Date.parse(t))) bad('a date');
        return el(tag, { 'THE-VALUE': t }, [definition]);
      }
      case 'ENUMERATION': {
        const names = def.multiValued ? text.split(',').map((s) => s.trim()).filter(Boolean) : [text.trim()];
        const refs = names.map((n) => this.enumLiteral(def, n, now));
        return el(tag, {}, [definition, el('VALUES', {}, refs.map((id) => el('ENUM-VALUE-REF', {}, [id])))]);
      }
    }
  }

  /** The id of an enumeration literal by name (case is ignored), added to the datatype when missing. */
  private enumLiteral(def: AttrDef, name: string, now: string): string {
    const literals = this.enumValues(def);
    const found = literals.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const d = this.datatypes.get(def.datatype);
    if (!d) throw new ReqifError(`Attribute "${def.name}" has an unknown datatype`);
    const keys = literals.map((l) => Number(attr(at(l.el, 'PROPERTIES', 'EMBEDDED-VALUE'), 'KEY'))).filter(Number.isFinite);
    const id = uniqueIdent(`archery-enum-${ncname(d.id)}-${ncname(name)}`, this);
    ensureKid(d.el, 'SPECIFIED-VALUES').children.push(
      el('ENUM-VALUE', { IDENTIFIER: id, 'LAST-CHANGE': now, 'LONG-NAME': name }, [
        el('PROPERTIES', {}, [el('EMBEDDED-VALUE', { KEY: String(keys.length ? Math.max(...keys) + 1 : 0), 'OTHER-CONTENT': '' })]),
      ]),
    );
    return id;
  }

  /** Which attribute definition of a type each requirement field is read from. */
  fieldDefs(type: SpecType | undefined): Map<MappedField, AttrDef> {
    const out = new Map<MappedField, AttrDef>();
    if (!type) return out;
    for (const field of MAPPED_FIELDS) {
      for (const name of FIELD_NAMES[field]) {
        const def = type.attrs.find((a) => a.name.toLowerCase() === name.toLowerCase());
        if (def) {
          out.set(field, def);
          break;
        }
      }
    }
    // Text without ReqIF.Text: the type's only formatted text attribute.
    if (!out.has('text')) {
      const xhtml = type.attrs.filter((a) => a.kind === 'XHTML' && ![...out.values()].includes(a));
      if (xhtml.length === 1) out.set('text', xhtml[0]!);
    }
    return out;
  }

  /** Archery's datatype of this kind (for every attribute Archery adds), created when missing. */
  datatype(kind: 'STRING' | 'XHTML', now: string): Datatype {
    const id = `archery-datatype-${kind.toLowerCase()}`;
    const found = this.datatypes.get(id);
    if (found) return found;
    const e = el(`DATATYPE-DEFINITION-${kind}`, { IDENTIFIER: id, 'LAST-CHANGE': now, 'LONG-NAME': kind === 'STRING' ? 'Text' : 'Formatted text', ...(kind === 'STRING' ? { 'MAX-LENGTH': '32000' } : {}) });
    this.part('DATATYPES').children.push(e);
    const d: Datatype = { id, kind, name: attr(e, 'LONG-NAME')!, el: e };
    this.datatypes.set(id, d);
    return d;
  }

  /** Adds an attribute definition to a type. */
  addAttrDef(type: SpecType, name: string, kind: 'STRING' | 'XHTML', now: string): AttrDef {
    const datatype = this.datatype(kind, now);
    const id = uniqueIdent(`${ncname(type.id)}-${ncname(name)}`, this);
    const e = el(`ATTRIBUTE-DEFINITION-${kind}`, { IDENTIFIER: id, 'LAST-CHANGE': now, 'LONG-NAME': name }, [el('TYPE', {}, [el(`DATATYPE-DEFINITION-${kind}-REF`, {}, [datatype.id])])]);
    ensureKid(type.el, 'SPEC-ATTRIBUTES').children.push(e);
    const def: AttrDef = { id, name, kind, datatype: datatype.id, multiValued: false, el: e };
    type.attrs.push(def);
    return def;
  }

  /** Adds a spec type (SPEC-OBJECT-TYPE, SPECIFICATION-TYPE, SPEC-RELATION-TYPE). */
  addType(tag: string, id: string, name: string, now: string): SpecType {
    const e = el(tag, { IDENTIFIER: id, 'LAST-CHANGE': now, 'LONG-NAME': name });
    this.part('SPEC-TYPES').children.push(e);
    const type: SpecType = { id, name, tag, attrs: [], el: e };
    this.types.set(id, type);
    return type;
  }

  /** Every identifier in the document. */
  identifiers(): Set<string> {
    const ids = new Set<string>();
    const walk = (e: XElement) => {
      const id = attr(e, 'IDENTIFIER');
      if (id) ids.add(id);
      if (!VERBATIM.has(localName(e.name))) elements(e).forEach(walk);
    };
    walk(this.doc.root);
    return ids;
  }
}

/** The identifier a reference child holds: `<TYPE><SPEC-OBJECT-TYPE-REF>id</...></TYPE>`. */
export function refOf(e: XElement | undefined, child: string): string {
  return textOf(elements(kid(e, child))[0]).trim();
}

/** A string usable in an identifier (xsd:ID: no spaces, no colons, not starting with a digit). */
export function ncname(s: string): string {
  const t = s.normalize('NFKD').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[A-Za-z_]/.test(t) ? t : `_${t}`;
}

const identSeen = new WeakMap<Reqif, Set<string>>();
/** A new identifier, unique in the document. */
export function uniqueIdent(base: string, reqif: Reqif): string {
  let taken = identSeen.get(reqif);
  if (!taken) identSeen.set(reqif, (taken = reqif.identifiers()));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}
/** Forgets the identifiers seen (after a document was rebuilt). */
export function resetIdents(reqif: Reqif): void {
  identSeen.delete(reqif);
}

/** A minimal ReqIF document. */
export function emptyReqif(title: string, now: string, headerId: string): Reqif {
  const root = el('REQ-IF', { xmlns: REQIF_NS, 'xmlns:xhtml': XHTML_NS }, [
    el('THE-HEADER', {}, [
      el('REQ-IF-HEADER', { IDENTIFIER: headerId }, [
        el('CREATION-TIME', {}, [now]),
        el('REQ-IF-TOOL-ID', {}, ['Archery']),
        el('REQ-IF-VERSION', {}, ['1.0']),
        el('SOURCE-TOOL-ID', {}, ['Archery']),
        el('TITLE', {}, [title]),
      ]),
    ]),
    el('CORE-CONTENT', {}, [el('REQ-IF-CONTENT', {}, ['DATATYPES', 'SPEC-TYPES', 'SPEC-OBJECTS', 'SPEC-RELATIONS', 'SPECIFICATIONS'].map((n) => el(n)))]),
  ]);
  return new Reqif({ prolog: [{ type: 'raw', text: '<?xml version="1.0" encoding="UTF-8"?>' }], root });
}
