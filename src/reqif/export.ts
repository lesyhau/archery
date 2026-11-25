// data/requirements.yaml (+ the architecture) -> ReqIF. When the requirements came from a ReqIF file
// (kept as data/requirements.reqif), the export starts from that file and changes only what changed
// in Archery: values whose text is the same keep their original markup, identifiers stay, and the
// types, datatypes, relations and tool extensions Archery does not know are written back as they were.
// Next to the requirements it writes the architecture as specifications of its own (quality goals,
// quality scenarios, constraints, decisions, the building blocks that satisfy requirements) and the
// trace links as spec relations: Satisfies, Refines, Addresses.
import type { Requirement } from '../model/schema';
import { identFor, OWNED } from './import';
import { emptyReqif, FIELD_NAMES, MAPPED_FIELDS, ncname, Reqif, refOf, resetIdents, uniqueIdent, VERBATIM, XHTML_NS, type AttrDef, type MappedField, type SpecType } from './reqif';
import { at, attr, el, elements, ensureKid, kid, kids, localName, serializeXml, setAttr, textOf, type XElement } from './xml';

export interface ArchitectureData {
  system: string;
  requirements: Requirement[];
  goals: { id: string; priority?: number; quality: string; goal: string; motivation?: string }[];
  scenarios: { id: string; name: string; kind?: string; quality?: string; goals: string[]; priority?: string; text: string }[];
  constraints: { id: string; category?: string; constraint: string; explanation?: string }[];
  decisions: { number: string; title: string; status?: string; date?: string; decision?: string; requirements: string[]; qualityGoals: string[]; constraints: string[] }[];
  elements: { id: string; name: string; kind: string; description?: string; stereotype?: string; technology?: string }[];
}

export interface ExportResult {
  xml: string;
  requirements: number;
  added: number;
  changed: number;
  removed: number;
  /** Architecture objects (goals, scenarios, constraints, decisions, building blocks). */
  architecture: number;
  /** Trace links Archery wrote. */
  links: number;
}

const ORDER = ['DATATYPES', 'SPEC-TYPES', 'SPEC-OBJECTS', 'SPEC-RELATIONS', 'SPECIFICATIONS', 'SPEC-RELATION-GROUPS'];
const norm = (s: string) => s.replace(/\r\n/g, '\n').trim();

function removeWhere(parent: XElement | undefined, drop: (e: XElement) => boolean): XElement[] {
  if (!parent) return [];
  const removed: XElement[] = [];
  parent.children = parent.children.filter((c) => {
    if (c.type !== 'element' || !drop(c)) return true;
    removed.push(c);
    return false;
  });
  // Whitespace left between removed elements is dropped by the serializer (element-only content).
  return removed;
}

const ref = (wrapper: string, tag: string, id: string) => el(wrapper, {}, [el(tag, {}, [id])]);

function setRef(e: XElement, wrapper: string, tag: string, id: string): void {
  const w = ensureKid(e, wrapper);
  w.children = [el(tag, {}, [id])];
}

function setValues(e: XElement, values: XElement[]): void {
  const existing = kid(e, 'VALUES');
  if (!values.length) {
    if (existing) e.children = e.children.filter((c) => c !== existing);
    return;
  }
  if (existing) existing.children = values;
  else {
    // VALUES goes in front of TYPE (and after ALTERNATIVE-ID).
    const i = e.children.findIndex((c) => c.type === 'element' && localName(c.name) !== 'ALTERNATIVE-ID');
    e.children.splice(i < 0 ? e.children.length : i, 0, el('VALUES', {}, values));
  }
}

export function exportReqif(data: ArchitectureData, options: { base?: string; now?: Date } = {}): ExportResult {
  const now = (options.now ?? new Date()).toISOString();
  const system = data.system || 'System';
  const reqif = options.base ? Reqif.parse(options.base) : emptyReqif(`${system} requirements`, now, `archery-${ncname(system.toLowerCase())}`);
  resetIdents(reqif);
  const content = reqif.content;
  const owned = (e: XElement) => refOf(e, 'TYPE').startsWith(OWNED);

  // What Archery wrote last time is written again from the current architecture.
  removeWhere(kid(content, 'SPEC-OBJECTS'), owned);
  removeWhere(kid(content, 'SPECIFICATIONS'), owned);
  const ownedRelations = new Set(removeWhere(kid(content, 'SPEC-RELATIONS'), owned).map((r) => attr(r, 'IDENTIFIER')));
  removeWhere(kid(content, 'SPEC-TYPES'), (t) => (attr(t, 'IDENTIFIER') ?? '').startsWith(OWNED));
  reqif.reindex();

  const result: ExportResult = { xml: '', requirements: data.requirements.length, added: 0, changed: 0, removed: 0, architecture: 0, links: 0 };
  const base = new Map(reqif.objects);
  const objectTypes = () => [...reqif.types.values()].filter((t) => t.tag === 'SPEC-OBJECT-TYPE');
  const madeTypes = new Set<string>();

  const typeFor = (r: Requirement, old: XElement | undefined): SpecType => {
    const oldType = old ? reqif.typeOf(old) : undefined;
    if (r.type) {
      const want = r.type.trim().toLowerCase();
      if (oldType && oldType.name.toLowerCase() === want) return oldType;
      const found = objectTypes().find((t) => t.name.toLowerCase() === want);
      if (found) return found;
      const t = reqif.addType('SPEC-OBJECT-TYPE', uniqueIdent(`archery-type-${ncname(r.type)}`, reqif), r.type.trim(), now);
      madeTypes.add(t.id);
      return t;
    }
    if (oldType) return oldType;
    const found = objectTypes().find((t) => t.name.toLowerCase() === 'requirement') ?? objectTypes().find((t) => reqif.fieldDefs(t).has('text'));
    if (found) return found;
    const t = reqif.addType('SPEC-OBJECT-TYPE', 'archery-type-requirement', 'Requirement', now);
    madeTypes.add(t.id);
    return t;
  };

  // --- requirements ------------------------------------------------------------------------------
  const keep = new Set<string>();
  for (const r of data.requirements) {
    const ident = identFor(r);
    keep.add(ident);
    const old = base.get(ident);
    const type = typeFor(r, old);
    const defs = reqif.fieldDefs(type);
    const want = new Map<string, string>();
    /** Values written back as they are: the requirements tool's own id of its objects. */
    const asIs = new Set<string>();
    for (const field of MAPPED_FIELDS) {
      const value = field === 'id' ? r.id : (r[field as Exclude<MappedField, 'id'>] ?? '');
      if (field === 'id' && old) {
        const def = defs.get('id');
        if (def) asIs.add(def.id);
        continue;
      }
      if (!value) continue;
      let def = defs.get(field);
      // A requirements tool numbers its own objects: Archery adds an id attribute only to its own types.
      if (!def && field === 'id' && !madeTypes.has(type.id)) continue;
      if (!def) {
        def = reqif.addAttrDef(type, FIELD_NAMES[field][0]!, field === 'text' ? 'XHTML' : 'STRING', now);
        defs.set(field, def);
      }
      want.set(def.id, value);
    }
    const mapped = new Set([...defs.values()].map((d) => d.id));
    for (const [name, value] of Object.entries(r.attributes ?? {})) {
      if (!value) continue;
      const def = type.attrs.find((a) => a.name === name && !mapped.has(a.id)) ?? reqif.addAttrDef(type, name, 'STRING', now);
      want.set(def.id, value);
    }

    const sameType = !!old && refOf(old, 'TYPE') === type.id;
    const oldValues = old && sameType ? reqif.values(old) : new Map<string, XElement>();
    let changed = !old || !sameType;
    const values: XElement[] = [];
    for (const def of type.attrs) {
      const text = want.get(def.id) ?? '';
      const before = oldValues.get(def.id);
      if (asIs.has(def.id)) {
        if (before) values.push(before);
        continue;
      }
      if (norm(reqif.valueText(def, before)) === norm(text)) {
        if (before) values.push(before);
        continue;
      }
      changed = true;
      if (text) values.push(valueOf(reqif, def, text, now, r.id));
    }
    // Values of attributes the type does not have (any more) are dropped.
    if (old && [...reqif.values(old).keys()].some((d) => !reqif.attrDef(type, d))) changed = true;

    if (old) {
      setValues(old, values);
      setRef(old, 'TYPE', 'SPEC-OBJECT-TYPE-REF', type.id);
      if (changed) {
        setAttr(old, 'LAST-CHANGE', now);
        result.changed++;
      }
    } else {
      const o = el('SPEC-OBJECT', { IDENTIFIER: ident, 'LAST-CHANGE': now }, [...(values.length ? [el('VALUES', {}, values)] : []), ref('TYPE', 'SPEC-OBJECT-TYPE-REF', type.id)]);
      reqif.part('SPEC-OBJECTS').children.push(o);
      result.added++;
    }
  }

  // Requirements deleted in Archery, with their relations.
  const gone = new Set([...base.keys()].filter((id) => !keep.has(id)));
  result.removed = gone.size;
  removeWhere(kid(content, 'SPEC-OBJECTS'), (o) => gone.has(attr(o, 'IDENTIFIER') ?? ''));
  const goneRelations = new Set(
    removeWhere(kid(content, 'SPEC-RELATIONS'), (r) => gone.has(refOf(r, 'SOURCE')) || gone.has(refOf(r, 'TARGET'))).map((r) => attr(r, 'IDENTIFIER')),
  );
  for (const group of kids(kid(content, 'SPEC-RELATION-GROUPS'), 'RELATION-GROUP')) {
    removeWhere(kid(group, 'SPEC-RELATIONS'), (r) => goneRelations.has(textOf(r).trim()) || ownedRelations.has(textOf(r).trim()));
  }
  reqif.reindex();

  // --- the specifications' hierarchy -------------------------------------------------------------
  let specs = kids(kid(content, 'SPECIFICATIONS'), 'SPECIFICATION');
  if (!specs.length && data.requirements.length) {
    const specType = [...reqif.types.values()].find((t) => t.tag === 'SPECIFICATION-TYPE') ?? reqif.addType('SPECIFICATION-TYPE', 'archery-type-specification', 'Requirements specification', now);
    reqif.part('SPECIFICATIONS').children.push(
      el('SPECIFICATION', { IDENTIFIER: uniqueIdent('archery-specification', reqif), 'LAST-CHANGE': now, 'LONG-NAME': `${system} requirements` }, [ref('TYPE', 'SPECIFICATION-TYPE-REF', specType.id)]),
    );
    specs = kids(kid(content, 'SPECIFICATIONS'), 'SPECIFICATION');
  }
  const byId = new Map(data.requirements.map((r) => [r.id, r]));
  const underCycle = (r: Requirement) => {
    const seen = new Set<string>([r.id]);
    for (let p = r.parent; p; p = byId.get(p)?.parent) {
      if (seen.has(p)) return true;
      seen.add(p);
    }
    return false;
  };
  const isTop = (r: Requirement) => !r.parent || !byId.has(r.parent) || underCycle(r);
  const children = new Map<string, Requirement[]>();
  for (const r of data.requirements) if (!isTop(r)) children.set(r.parent!, [...(children.get(r.parent!) ?? []), r]);
  const specName = (s: XElement) => attr(s, 'LONG-NAME') ?? attr(s, 'IDENTIFIER') ?? '';
  for (const spec of specs) {
    const nodes = new Map<string, XElement>();
    const walk = (n: XElement) => {
      for (const h of kids(kid(n, 'CHILDREN'), 'SPEC-HIERARCHY')) {
        const object = refOf(h, 'OBJECT');
        if (!nodes.has(object)) nodes.set(object, h);
        walk(h);
      }
    };
    walk(spec);
    const build = (r: Requirement, depth: number): XElement => {
      const ident = identFor(r);
      const node = nodes.get(ident) ?? el('SPEC-HIERARCHY', { IDENTIFIER: uniqueIdent(`archery-h-${ncname(ident)}`, reqif), 'LAST-CHANGE': now }, [ref('OBJECT', 'SPEC-OBJECT-REF', ident)]);
      const below = depth < 64 ? (children.get(r.id) ?? []).map((c) => build(c, depth + 1)) : [];
      node.children = node.children.filter((c) => c.type !== 'element' || localName(c.name) !== 'CHILDREN');
      if (below.length) node.children.push(el('CHILDREN', {}, below));
      return node;
    };
    const tops = data.requirements.filter((r) => isTop(r) && (specs.find((s) => specName(s) === r.specification) ?? specs[0]) === spec);
    const built = tops.map((r) => build(r, 0));
    spec.children = spec.children.filter((c) => c.type !== 'element' || localName(c.name) !== 'CHILDREN');
    if (built.length) spec.children.push(el('CHILDREN', {}, built));
  }

  // --- the architecture --------------------------------------------------------------------------
  const archType = (key: string, name: string, extras: string[]) => {
    const t = reqif.addType('SPEC-OBJECT-TYPE', `${OWNED}${key}`, name, now);
    const defs: [string, 'STRING' | 'XHTML'][] = [['ReqIF.ForeignID', 'STRING'], ['ReqIF.Name', 'STRING'], ['ReqIF.Text', 'XHTML'], ...extras.map((e): [string, 'STRING'] => [e, 'STRING'])];
    for (const [attrName, kind] of defs) {
      const datatype = reqif.datatype(kind, now);
      const id = `${OWNED}${key}-${ncname(attrName)}`;
      const e = el(`ATTRIBUTE-DEFINITION-${kind}`, { IDENTIFIER: id, 'LAST-CHANGE': now, 'LONG-NAME': attrName }, [ref('TYPE', `DATATYPE-DEFINITION-${kind}-REF`, datatype.id)]);
      ensureKid(t.el, 'SPEC-ATTRIBUTES').children.push(e);
      t.attrs.push({ id, name: attrName, kind, datatype: datatype.id, multiValued: false, el: e });
    }
    return t;
  };
  const specType = reqif.addType('SPECIFICATION-TYPE', `${OWNED}specification`, 'Architecture (arc42)', now);
  const archSpecs: XElement[] = [];
  const archObject = (key: string, list: { foreign: string; name: string; text?: string; extras: Record<string, string | undefined> }[], typeName: string, specTitle: string): Map<string, string> => {
    const idents = new Map<string, string>();
    if (!list.length) return idents;
    const extras = [...new Set(list.flatMap((i) => Object.keys(i.extras)))];
    const type = archType(key, typeName, extras);
    const hierarchy: XElement[] = [];
    for (const item of list) {
      const ident = `${OWNED}${key}-${ncname(item.foreign)}`;
      idents.set(item.foreign, ident);
      const texts: Record<string, string | undefined> = { 'ReqIF.ForeignID': item.foreign, 'ReqIF.Name': item.name, 'ReqIF.Text': item.text, ...item.extras };
      const values = type.attrs.filter((a) => texts[a.name]).map((a) => valueOf(reqif, a, texts[a.name]!, now, item.foreign));
      reqif.part('SPEC-OBJECTS').children.push(el('SPEC-OBJECT', { IDENTIFIER: ident, 'LAST-CHANGE': now }, [...(values.length ? [el('VALUES', {}, values)] : []), ref('TYPE', 'SPEC-OBJECT-TYPE-REF', type.id)]));
      hierarchy.push(el('SPEC-HIERARCHY', { IDENTIFIER: `${OWNED}h-${key}-${ncname(item.foreign)}`, 'LAST-CHANGE': now }, [ref('OBJECT', 'SPEC-OBJECT-REF', ident)]));
      result.architecture++;
    }
    archSpecs.push(el('SPECIFICATION', { IDENTIFIER: `${OWNED}spec-${key}`, 'LAST-CHANGE': now, 'LONG-NAME': specTitle }, [ref('TYPE', 'SPECIFICATION-TYPE-REF', specType.id), el('CHILDREN', {}, hierarchy)]));
    return idents;
  };

  const goalIds = archObject(
    'goal',
    data.goals.map((g) => ({ foreign: g.id, name: g.quality, text: g.goal, extras: { Priority: g.priority?.toString(), Motivation: g.motivation } })),
    'Quality goal',
    'Quality goals',
  );
  const scenarioIds = archObject(
    'scenario',
    data.scenarios.map((s) => ({ foreign: s.id, name: s.name, text: s.text, extras: { Kind: s.kind, Quality: s.quality, Priority: s.priority } })),
    'Quality scenario',
    'Quality scenarios',
  );
  const constraintIds = archObject(
    'constraint',
    data.constraints.map((c) => ({ foreign: c.id, name: c.constraint, text: c.explanation, extras: { Category: c.category } })),
    'Architecture constraint',
    'Architecture constraints',
  );
  const decisionIds = archObject(
    'decision',
    data.decisions.map((d) => ({ foreign: `ADR-${d.number}`, name: d.title, text: d.decision, extras: { Status: d.status, Date: d.date } })),
    'Architecture decision',
    'Architecture decisions',
  );
  const satisfying = new Set(data.requirements.flatMap((r) => r.satisfiedBy));
  const elementIds = archObject(
    'element',
    data.elements.filter((e) => satisfying.has(e.id)).map((e) => ({ foreign: e.id, name: e.name, text: e.description, extras: { Kind: e.kind, Stereotype: e.stereotype, Technology: e.technology } })),
    'Building block',
    'Building blocks',
  );
  reqif.part('SPECIFICATIONS').children.push(...archSpecs);
  if (!archSpecs.length) removeWhere(kid(content, 'SPEC-TYPES'), (t) => t === specType.el);

  // --- trace links -------------------------------------------------------------------------------
  const requirementIds = new Map(data.requirements.map((r) => [r.id, identFor(r)]));
  const relationTypes = new Map<string, string>();
  const relations: XElement[] = [];
  const link = (kind: 'satisfies' | 'refines' | 'addresses', source: string | undefined, target: string | undefined) => {
    if (!source || !target) return;
    let type = relationTypes.get(kind);
    if (!type) {
      type = reqif.addType('SPEC-RELATION-TYPE', `${OWNED}${kind}`, kind.charAt(0).toUpperCase() + kind.slice(1), now).id;
      relationTypes.set(kind, type);
    }
    relations.push(
      el('SPEC-RELATION', { IDENTIFIER: `${OWNED}rel-${kind}-${ncname(source)}-${ncname(target)}`, 'LAST-CHANGE': now }, [
        ref('SOURCE', 'SPEC-OBJECT-REF', source),
        ref('TARGET', 'SPEC-OBJECT-REF', target),
        ref('TYPE', 'SPEC-RELATION-TYPE-REF', type),
      ]),
    );
  };
  for (const r of data.requirements) {
    for (const e of r.satisfiedBy) link('satisfies', elementIds.get(e), requirementIds.get(r.id));
    for (const g of r.goals) link('refines', requirementIds.get(r.id), goalIds.get(g));
  }
  for (const s of data.scenarios) for (const g of s.goals) link('refines', scenarioIds.get(s.id), goalIds.get(g));
  for (const d of data.decisions) {
    const source = decisionIds.get(`ADR-${d.number}`);
    for (const r of d.requirements) link('addresses', source, requirementIds.get(r));
    for (const g of d.qualityGoals) link('addresses', source, goalIds.get(g));
    for (const c of d.constraints) link('addresses', source, constraintIds.get(c));
  }
  const unique = new Map(relations.map((r) => [attr(r, 'IDENTIFIER'), r]));
  reqif.part('SPEC-RELATIONS').children.push(...unique.values());
  result.links = unique.size;

  // --- header, namespaces, order ----------------------------------------------------------------
  const header = at(reqif.doc.root, 'THE-HEADER', 'REQ-IF-HEADER');
  if (header) {
    for (const [name, value] of [['CREATION-TIME', now], ['REQ-IF-TOOL-ID', 'Archery']] as const) ensureKid(header, name).children = [{ type: 'text', value }];
  }
  if (!attr(reqif.doc.root, 'xmlns:xhtml')) setAttr(reqif.doc.root, 'xmlns:xhtml', XHTML_NS);
  // Empty sections are left out (but for objects and specifications); the rest in the order of the schema.
  for (const required of ['SPEC-OBJECTS', 'SPECIFICATIONS']) ensureKid(content, required);
  const rank = (e: XElement) => ORDER.indexOf(localName(e.name)) + 1 || 99;
  content.children = elements(content)
    .filter((c) => ['SPEC-OBJECTS', 'SPECIFICATIONS'].includes(localName(c.name)) || !ORDER.includes(localName(c.name)) || elements(c).length > 0)
    .sort((a, b) => rank(a) - rank(b));

  result.xml = serializeXml(reqif.doc, { verbatim: VERBATIM });
  return result;
}

function valueOf(reqif: Reqif, def: AttrDef, text: string, now: string, owner: string): XElement {
  try {
    return reqif.valueElement(def, text, now);
  } catch (e) {
    throw new Error(`${owner}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
