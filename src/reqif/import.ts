// ReqIF -> data/requirements.yaml. Every spec object of the specifications becomes a requirement, in
// document order, with its place in the hierarchy (parent). A requirement that is already in the list
// (same ReqIF identifier, or same id) is updated: what comes from the requirements tool is replaced,
// Archery's own fields (satisfiedBy, goals, custom columns) stay.
import { attr, kid, kids, type XElement } from './xml';
import { MAPPED_FIELDS, Reqif, refOf } from './reqif';

/** Types, specifications and relations Archery writes for the architecture (not requirements). */
export const OWNED = 'archery-arch-';

/** The ReqIF identifier of a requirement made in Archery. */
export const identFor = (r: { id: string; reqif?: string }) => r.reqif ?? `archery-req-${r.id}`;

/** Fields the requirements tool owns: replaced on import. */
export const SOURCED = ['id', 'heading', 'title', 'text', 'type', 'status', 'priority', 'parent', 'specification', 'attributes', 'reqif'] as const;

/** Field order in data/requirements.yaml. */
const ORDER = ['id', 'heading', 'title', 'text', 'type', 'status', 'priority', 'parent', 'specification', 'satisfiedBy', 'goals', 'attributes', 'reqif'];

type Item = Record<string, unknown>;

export interface Incoming {
  id: string;
  reqif: string;
  /** Identifier of the parent's spec object. */
  parentObject?: string;
  specification?: string;
  fields: Item;
}

/** An Archery id from a requirements tool's id: "42" -> "REQ-42", "SRS 1.2" -> "SRS-1.2". */
export function requirementId(foreign: string): string {
  const t = foreign.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!t) return '';
  return /^[A-Za-z_]/.test(t) ? t : `REQ-${t}`;
}

/** The requirements of a ReqIF document, in the order of its specifications. */
export function readRequirements(reqif: Reqif): { items: Incoming[]; specifications: string[] } {
  const owned = (e: XElement) => refOf(e, 'TYPE').startsWith(OWNED);
  const placed: { object: string; parent?: string; specification?: string }[] = [];
  const seen = new Set<string>();
  const specs = kids(kid(reqif.content, 'SPECIFICATIONS'), 'SPECIFICATION').filter((s) => !owned(s));
  const specNames = specs.map((s) => attr(s, 'LONG-NAME') ?? attr(s, 'IDENTIFIER') ?? '');

  const walk = (node: XElement, parent: string | undefined, specification: string | undefined) => {
    for (const h of kids(kid(node, 'CHILDREN'), 'SPEC-HIERARCHY')) {
      const object = refOf(h, 'OBJECT');
      const o = reqif.objects.get(object);
      if (!o || owned(o)) continue;
      if (!seen.has(object)) {
        seen.add(object);
        placed.push({ object, parent, specification });
      }
      walk(h, object, undefined);
    }
  };
  specs.forEach((s, i) => walk(s, undefined, specs.length > 1 ? specNames[i] : undefined));
  // Objects that no specification shows.
  for (const [object, o] of reqif.objects) if (!seen.has(object) && !owned(o)) placed.push({ object });

  const taken = new Set<string>();
  let counter = 0;
  const items = placed.map(({ object, parent, specification }) => {
    const o = reqif.objects.get(object)!;
    const type = reqif.typeOf(o);
    const defs = reqif.fieldDefs(type);
    const values = reqif.values(o);
    const fields: Item = {};
    for (const field of MAPPED_FIELDS) {
      const def = defs.get(field);
      const text = def ? reqif.valueText(def, values.get(def.id)) : '';
      if (text) fields[field] = text;
    }
    const mapped = new Set([...defs.values()].map((d) => d.id));
    const attributes: Record<string, string> = {};
    for (const def of type?.attrs ?? []) {
      if (mapped.has(def.id)) continue;
      const text = reqif.valueText(def, values.get(def.id));
      if (text) attributes[def.name] = text;
    }
    if (Object.keys(attributes).length) fields.attributes = attributes;
    if (type) fields.type = type.name;
    let id = requirementId(String(fields.id ?? ''));
    if (!id) {
      do id = `REQ-${++counter}`;
      while (taken.has(id));
    }
    for (let i = 2, base = id; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    delete fields.id;
    return { id, reqif: object, parentObject: parent, specification, fields };
  });
  return { items, specifications: specNames };
}

export interface MergeResult {
  items: Item[];
  added: string[];
  updated: string[];
  unchanged: number;
  /** Requirements from an earlier import that the file no longer has. */
  removed: string[];
  /** Requirements made in Archery that the file does not have (kept). */
  kept: string[];
  /** Old id -> new id, for requirements whose id changed in the requirements tool. */
  renamed: Map<string, string>;
}

const ordered = (item: Item): Item => {
  const out: Item = {};
  for (const k of ORDER) if (item[k] !== undefined) out[k] = item[k];
  for (const [k, v] of Object.entries(item)) if (!(k in out) && v !== undefined) out[k] = v;
  return out;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Merges the requirements of a ReqIF file into the current list. */
export function mergeRequirements(current: Item[], incoming: Incoming[]): MergeResult {
  const used = new Set<Item>();
  const result: MergeResult = { items: [], added: [], updated: [], unchanged: 0, removed: [], kept: [], renamed: new Map() };
  const idOfObject = new Map(incoming.map((i) => [i.reqif, i.id]));
  const matches = incoming.map((inc) => {
    const match =
      current.find((c) => !used.has(c) && c.reqif === inc.reqif) ??
      current.find((c) => !used.has(c) && !c.reqif && typeof c.id === 'string' && (identFor({ id: c.id }) === inc.reqif || c.id === inc.id));
    if (match) used.add(match);
    return match;
  });

  incoming.forEach((inc, i) => {
    const match = matches[i];
    const own = match ? Object.fromEntries(Object.entries(match).filter(([k]) => !(SOURCED as readonly string[]).includes(k))) : {};
    const parent = inc.parentObject ? idOfObject.get(inc.parentObject) : undefined;
    const item = ordered({ ...own, id: inc.id, ...inc.fields, parent, specification: inc.specification, reqif: inc.reqif });
    if (!match) result.added.push(inc.id);
    else {
      if (typeof match.id === 'string' && match.id !== inc.id) result.renamed.set(match.id, inc.id);
      if (same(ordered(match), item)) result.unchanged++;
      else result.updated.push(inc.id);
    }
    result.items.push(item);
  });

  const ids = new Set(result.items.map((i) => i.id));
  for (const c of current) {
    if (used.has(c)) continue;
    if (c.reqif) {
      result.removed.push(String(c.id));
      continue;
    }
    result.kept.push(String(c.id));
    result.items.push(c);
  }
  // Kept requirements under a renamed or removed one.
  for (const item of result.items) {
    const p = item.parent;
    if (typeof p !== 'string') continue;
    const renamed = result.renamed.get(p);
    if (renamed && !ids.has(p)) item.parent = renamed;
    else if (!result.items.some((i) => i.id === p)) delete item.parent;
  }
  return result;
}

/** The first .reqif document of a .reqifz archive's files. */
export function reqifEntry<T extends { name: string }>(entries: T[]): T | undefined {
  return entries.filter((e) => /\.reqif$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
}
