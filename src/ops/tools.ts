// Tool definitions shared by the MCP server (Claude Code & other MCP clients) and the
// VS Code language model tools (GitHub Copilot). One definition = one zod input schema,
// an agent-facing description, and a pure `run` against an ArcherySession.
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { z } from 'zod';
import { forEachMessage } from '../model/checks';
import { sequenceProblems } from '../model/umlRules';
import type { WorkspaceReader } from '../model/load';
import {
  AdrFrontMatterSchema,
  AttributeSchema,
  ExportSettingsSchema,
  CanvasDiagramTypeSchema,
  ConstraintsSchema,
  ElementKindSchema,
  GlossarySchema,
  DiagramShowSchema,
  IdSchema,
  LineShapes,
  LocalEdgeKindSchema,
  LocalNodeKinds,
  LocalNodeKindSchema,
  OperationSchema,
  QualityGoalsSchema,
  ScenarioSchema,
  QualityRequirementsSchema,
  RelationshipKindSchema,
  RequirementsSchema,
  RisksSchema,
  SequenceStepSchema,
  StakeholdersSchema,
  TimingConstraintSchema,
  TimingLifelineSchema,
  TimingMessageSchema,
  type CanvasDiagram,
  type DiagramNode,
  type LocalEdge,
  type LocalNode,
  type Model,
  type SequenceDiagram,
  type SequenceStep,
  type TimingDiagram,
} from '../model/schema';
import { validateWorkspace } from '../model/validate';
import { findSection, SECTIONS } from '../template/template';
import { camelSlug, fileSlug, kebabSlug, uniqueId } from './ids';
import { defaultColumns, listByName, listForSrc, LISTS, parseCell } from '../doc/dataLists';
import { buildTables } from '../doc/tables';
import { documentTitle } from '../doc/title';
import type { DocTable } from '../doc/protocol';
import { findBrowsers, NO_BROWSER } from '../export/browsers';
import { stillWrapping, tallestCell, totalLines, wrappingColumns, type TargetLayout } from '../export/tableFit';
import { measure, tableOfList, type TableSource } from '../export/tableMeasure';
import { parse as parseYamlText } from 'yaml';
import { autoLayout } from './autoLayout';
import { layoutProblems } from '../render/layoutLint';
import { appendItem, OpError, type ArcherySession, type ToolHost } from './session';
import { alignBoxes, ALIGN_MODES, type AlignMode } from './align';
import { layoutNodes } from '../render/canvasLayout';
import { parseProject } from '../model/load';
import { parseDocument as parseYamlDocument } from 'yaml';
import { adrTitle, readAdrParts, setAdrPart, setAdrTitle, splitAdrText, type AdrPart } from '../doc/adr';
import { exportReqif, type ArchitectureData } from '../reqif/export';
import { mergeRequirements, readRequirements, reqifEntry } from '../reqif/import';
import { Reqif } from '../reqif/reqif';
import { isZip, readZip, writeZip } from '../reqif/zip';
import { REQUIREMENTS_HEADER, yamlFile } from '../template/scaffold';
import { parseYaml } from '../model/load';

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  /** snake_case; MCP clients namespace it (mcp__archery__add_element), Copilot gets an `archery_` prefix. */
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly: boolean;
  run(session: ArcherySession, input: z.infer<S>): unknown | Promise<unknown>;
  /** Short confirmation text shown by Copilot before a write. */
  confirm?(input: z.infer<S>): string;
}

const tool = <S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> => def;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function sessionReader(session: ArcherySession): WorkspaceReader {
  return {
    readText: async (path) => session.read(path),
    list: async (dir) => session.files(dir).map((p) => p.slice(dir.length + 1)),
  };
}

function seqIndex(doc: ReturnType<ArcherySession['modelDocument']>, key: string, field: string, value: unknown): number {
  const seq = doc.get(key, true);
  if (!isSeq(seq)) return -1;
  return seq.items.findIndex((item) => isMap(item) && item.get(field) === value);
}

/** Drops undefined values so they are not written as `key: null`. */
function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function requireElement(model: Model, id: string): Model['elements'][number] {
  const element = model.elements.find((e) => e.id === id);
  if (!element) throw new OpError(`Unknown element "${id}". Call get_model to see the existing ids.`);
  return element;
}

const NODE_W = 180;
const NODE_H = 80;

function placeNodes(existing: { y: number; h?: number }[], refs: string[]): DiagramNode[] {
  const cols = 4;
  const startY = existing.length > 0 ? Math.max(...existing.map((n) => n.y + (n.h ?? NODE_H))) + 60 : 40;
  // No w/h: the renderer uses the default size of each element kind (actor, port, lollipop, ...).
  return refs.map((ref, i) => ({
    ref,
    x: 40 + (i % cols) * (NODE_W + 60),
    y: startY + Math.floor(i / cols) * (NODE_H + 60),
  }));
}

/**
 * Which relationships to draw when both ends are shown: `all`, or `mostSpecific` - a relationship of a
 * container (A -> B) is left out when one of its shown parts has the same relationship to B or to one
 * of B's shown parts (the part's line already says it, more precisely).
 */
const RelationshipPolicySchema = z.enum(['mostSpecific', 'all']);
type RelationshipPolicy = z.infer<typeof RelationshipPolicySchema>;

/** Adds edges for the model relationships whose both ends are on the diagram. Returns the added ids. */
function addMissingEdges(diagram: CanvasDiagram, model: Model, policy: RelationshipPolicy = 'mostSpecific'): string[] {
  const on = new Set(diagram.nodes.map((n) => n.ref));
  const present = new Set(diagram.edges.map((e) => e.ref));
  const parents = new Map(model.elements.map((e) => [e.id, e.parent]));
  /** `id` is `ancestor` or inside it. */
  const within = (id: string, ancestor: string) => {
    for (let p: string | undefined = id, n = 0; p && n < 50; p = parents.get(p), n++) if (p === ancestor) return true;
    return false;
  };
  const shown = model.relationships.filter((r) => on.has(r.from) && on.has(r.to));
  const refined = (r: Model['relationships'][number]) =>
    shown.some((o) => o.id !== r.id && o.kind === r.kind && (o.from !== r.from || o.to !== r.to) && within(o.from, r.from) && within(o.to, r.to));
  const added: string[] = [];
  for (const r of shown) {
    if (present.has(r.id) || (policy === 'mostSpecific' && refined(r))) continue;
    diagram.edges.push({ ref: r.id, waypoints: [] });
    added.push(r.id);
  }
  return added;
}

function canvasDiagrams(session: ArcherySession): { path: string; diagram: CanvasDiagram }[] {
  return session
    .files('diagrams')
    .filter((p) => p.endsWith('.uml.json'))
    .flatMap((path) => {
      try {
        return [{ path, diagram: session.canvasDiagram(path) }];
      } catch {
        return []; // invalid diagrams are reported by validate
      }
    });
}

function sequenceDiagrams(session: ArcherySession): { path: string; diagram: SequenceDiagram }[] {
  return session
    .files('diagrams')
    .filter((p) => p.endsWith('.seq.json'))
    .flatMap((path) => {
      try {
        return [{ path, diagram: session.sequenceDiagram(path) }];
      } catch {
        return [];
      }
    });
}

function timingDiagrams(session: ArcherySession): { path: string; diagram: TimingDiagram }[] {
  return session
    .files('diagrams')
    .filter((p) => p.endsWith('.timing.json'))
    .flatMap((path) => {
      try {
        return [{ path, diagram: session.timingDiagram(path) }];
      } catch {
        return [];
      }
    });
}

/** A timing diagram without the lifeline `id`, its messages and its constraints. */
function withoutTimingLifeline(d: TimingDiagram, id: string): TimingDiagram {
  return {
    ...d,
    lifelines: d.lifelines.filter((l) => l.ref !== id),
    messages: d.messages.filter((m) => m.from !== id && m.to !== id),
    constraints: d.constraints.filter((c) => c.on !== id),
  };
}

function removeMessages(steps: SequenceStep[], involves: (id: string) => boolean): SequenceStep[] {
  return steps.flatMap((step): SequenceStep[] => {
    if ('msg' in step) return (step.msg.from && involves(step.msg.from)) || (step.msg.to && involves(step.msg.to)) ? [] : [step];
    if ('branches' in step) {
      return [{ ...step, branches: step.branches.map((b) => ({ ...b, steps: removeMessages(b.steps, involves) })) }];
    }
    if ('over' in step) {
      const over = step.over.filter((id) => !involves(id));
      return over.length > 0 ? [{ ...step, over }] : [];
    }
    return [step];
  });
}

const Ends = <T extends z.ZodType>(t: T) => z.object({ from: t.optional(), to: t.optional() });

function canvasPath(session: ArcherySession, name: string): string {
  const path = session.resolveDiagram(name);
  if (!path.endsWith('.uml.json')) throw new OpError(`${session.display(path)} is a sequence diagram; use write_sequence_diagram.`);
  return path;
}

/** The drawn box of nodes on a canvas diagram (text and children can make a box larger than its w / h). */
function drawnBoxes(diagram: CanvasDiagram, model: Model, ids?: string[]): Record<string, { x: number; y: number; w: number; h: number }> {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const want = ids && new Set(ids);
  for (const [id, n] of layoutNodes(diagram, model)) {
    if (want && !want.has(id)) continue;
    out[id] = { x: Math.round(n.box.x), y: Math.round(n.box.y), w: Math.round(n.box.w), h: Math.round(n.box.h) };
  }
  return out;
}

/** A chapter by number ("5"), id ("building-block-view") or title. */
function resolveSection(session: ArcherySession, ref: string): { id: string; number?: number; title: string; file: string } {
  const project = parseProject(session.read('archery.yaml') ?? '').value;
  const q = ref.trim().toLowerCase().replace(/\.$/, '');
  const all = (project?.sections ?? []).map((s) => {
    const def = findSection(s.id);
    return { id: s.id, number: def?.number, title: s.title ?? def?.title ?? s.id, file: s.file };
  });
  const found = all.find((s) => String(s.number) === q || s.id.toLowerCase() === q || s.title.toLowerCase() === q);
  if (!found) throw new OpError(`Unknown chapter "${ref}". Chapters: ${all.map((s) => `${s.number ?? ''} ${s.title}`.trim()).join(', ')}.`);
  return found;
}

/**
 * Inserts lines into a chapter as a block of their own: at the end of the part under `afterHeading`
 * (up to the next heading of the same or a higher level, subsections included), else at the end of the
 * chapter. Headings inside code blocks do not count.
 */
function insertInChapter(session: ArcherySession, s: { id: string; number?: number; file: string }, block: string[], afterHeading?: string): void {
  const lines = (session.read(s.file) ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
  let at = lines.length;
  if (afterHeading) {
    let fence: string | null = null;
    const levels = lines.map((l) => {
      const f = /^\s*(```|~~~)/.exec(l);
      if (f) {
        fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
        return 0;
      }
      return fence === null ? (/^(#{1,6})\s/.exec(l)?.[1]?.length ?? 0) : 0;
    });
    const name = (l: string) => l.replace(/^#+\s*/, '').replace(/\s+#+\s*$/, '').trim().toLowerCase();
    const want = afterHeading.trim().replace(/^#+\s*/, '').toLowerCase();
    const start = lines.findIndex((l, i) => levels[i]! > 0 && name(l) === want);
    if (start < 0) throw new OpError(`No heading "${afterHeading}" in chapter ${s.number ?? s.id}.`);
    const end = levels.findIndex((lv, i) => i > start && lv > 0 && lv <= levels[start]!);
    at = end < 0 ? lines.length : end;
    while (at > start + 1 && lines[at - 1]!.trim() === '') at--;
  }
  lines.splice(at, 0, '', ...block, ...(at < lines.length ? [''] : []));
  session.write(s.file, `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`);
}

/** The data tables and export settings, for measuring tables (src/export/tableMeasure.ts). */
function tableSource(session: ArcherySession): TableSource {
  const data = new Map<string, unknown>();
  for (const l of LISTS) {
    const text = data.has(l.file) ? undefined : session.read(l.file);
    if (text === undefined) continue;
    try {
      data.set(l.file, parseYamlText(text));
    } catch (e) {
      throw new OpError(`${l.file} has syntax errors: ${e instanceof Error ? e.message : e}`);
    }
  }
  const project = parseProject(session.read('archery.yaml') ?? '').value;
  const system = project?.system ?? 'System';
  return { system, title: documentTitle(system, project?.title), version: '', tables: buildTables(data), exportSettings: project?.export };
}

/** Browsers to measure with: VS Code's (with its browserPath setting) when it is open, else the installed ones. */
async function browsersFor(session: ArcherySession): Promise<string[]> {
  const list = (await session.host?.browsers?.().catch(() => undefined)) ?? findBrowsers();
  if (!list.length) throw new OpError(`Measuring tables ${NO_BROWSER}.`);
  return list;
}

/** The table of a list, with columns and rows to measure. */
function measurableTable(src: TableSource, list: string): DocTable {
  const table = tableOfList(src.tables, list);
  if (!table) throw new OpError(`There is no ${list} table yet (its data file is missing).`);
  if (!table.columns.length) throw new OpError(`The ${list} table shows no columns.`);
  if (!table.rows.length) throw new OpError(`The ${list} table has no rows to measure.`);
  return table;
}

/**
 * Saves column widths in the table's view (`views.<key>.columns`). When the view lists exactly the
 * shown columns, only their `width` values change; otherwise the shown columns are written with them.
 */
function saveColumnWidths(session: ArcherySession, list: DataListName, table: DocTable, widths: number[]): void {
  const def = listByName(list)!;
  const doc = parseDocument(session.read(def.file) ?? `${def.key}: []\n`);
  if (doc.errors.length > 0) throw new OpError(`${def.file} has syntax errors: ${doc.errors[0]!.message}`);
  const saved = doc.getIn(['views', def.key, 'columns'], true);
  if (isSeq(saved) && saved.items.length === table.columns.length && saved.items.every((it, i) => isMap(it) && it.get('field') === table.columns[i]!.field)) {
    saved.items.forEach((it, i) => isMap(it) && it.set('width', widths[i]));
  } else {
    doc.setIn(['views', def.key, 'columns'], doc.createNode(table.columns.map((c, i) => ({ field: c.field, label: c.label, width: widths[i] }))));
  }
  session.writeDocument(def.file, doc);
}

const TargetsSchema = z.array(z.enum(['screen', 'print'])).min(1).describe('screen: the exported page; print: the printed page (page size, orientation and margins from the export settings). Default both').optional();

/** Problems of the tables the chapters show, measured in a browser (none without one). */
async function tableLayoutProblems(session: ArcherySession): Promise<{ file: string; message: string }[]> {
  const src = tableSource(session);
  const project = parseProject(session.read('archery.yaml') ?? '').value;
  const shown = new Map<string, DocTable>();
  for (const s of project?.sections ?? []) {
    if (!s.enabled) continue;
    for (const m of (session.read(s.file) ?? '').matchAll(/<!--\s*archery:table\s+((?:(?!-->)\S)+)/g)) {
      const def = listForSrc(m[1]!);
      const table = def && tableOfList(src.tables, def.name);
      if (table && table.rows.length && table.columns.length) shown.set(table.list, table);
    }
  }
  if (!shown.size) return [];
  const browsers = (await session.host?.browsers?.().catch(() => undefined)) ?? findBrowsers();
  if (!browsers.length) return [];
  const results = await measure(browsers, src, [...shown.values()].map((table) => ({ table, mode: 'layout' as const })));
  const problems = new Map<string, { file: string; message: string; targets: string[] }>();
  const add = (key: string, file: string, message: string, target: string) => {
    const p = problems.get(key) ?? { file, message, targets: [] };
    p.targets.push(target);
    problems.set(key, p);
  };
  for (const r of results) {
    const table = shown.get(r.list)!;
    const label = (field: string) => table.columns.find((c) => c.field === field)?.label || field;
    const name = `Table "${table.title}" (${table.list})`;
    for (const l of r.layouts) {
      for (const o of l.overflow) add(`o:${r.list}:${o.row}:${o.field}`, table.file, `${name}: a word in the "${label(o.field)}" cell of ${o.row === 'header' ? 'the header' : `row ${o.row}`} is wider than its column`, l.target);
      for (const f of l.forced) add(`f:${r.list}:${f.field}`, table.file, `${name}: column "${label(f.field)}" is set to ${f.requested}% but a word needs about ${Math.ceil(f.rendered)}%; fit_table_columns finds widths that fit`, l.target);
      for (const w of wrappingColumns(l)) add(`w:${r.list}:${w.field}`, table.file, `${name}: column "${label(w.field)}" wraps much more than the rest (median ${w.median} lines, the table's ${w.table}); fit_table_columns balances the widths`, l.target);
    }
  }
  return [...problems.values()].map((p) => ({ file: p.file, message: `${p.message} (${p.targets.join(', ')})` }));
}

/** Versions and export run in VS Code. */
function needHost(session: ArcherySession): ToolHost {
  if (!session.host) throw new OpError('This needs VS Code with the Archery extension open on this folder (open the folder in VS Code, then try again).');
  return session.host;
}

// ---------------------------------------------------------------------------
// data lists (structured sections)
// ---------------------------------------------------------------------------

const DATA_LISTS = {
  requirements: { file: 'data/requirements.yaml', key: 'requirements', idField: 'id', schema: RequirementsSchema, section: '1.1', fields: 'id, heading (chapter heading), title, text (Markdown), type (e.g. "Functional requirement"), status, priority, parent (id of the requirement or heading it is under; the list is in document order), specification, satisfiedBy (list of model element ids: the building blocks that satisfy it), goals (list of quality goal ids it refines), attributes (map name -> text: other attributes of a requirements tool), reqif (ReqIF identifier, set by import_reqif; keep it)' },
  'quality-goals': { file: 'data/quality-goals.yaml', key: 'goals', idField: 'id', schema: QualityGoalsSchema, section: '1.2', fields: 'id, priority (integer, 1 = highest), quality (e.g. ISO 25010 / Q42 characteristic), goal, motivation' },
  stakeholders: { file: 'data/stakeholders.yaml', key: 'stakeholders', idField: 'role', schema: StakeholdersSchema, section: '1.3', fields: 'role, contact, expectations (towards the architecture documentation)' },
  constraints: { file: 'data/constraints.yaml', key: 'constraints', idField: 'id', schema: ConstraintsSchema, section: '2', fields: 'id, category (technical | organizational | convention), constraint, explanation' },
  'quality-overview': { file: 'data/quality-requirements.yaml', key: 'overview', idField: 'category', schema: QualityRequirementsSchema, section: '10.1', fields: 'category, description' },
  'quality-scenarios': { file: 'data/quality-requirements.yaml', key: 'scenarios', idField: 'id', schema: QualityRequirementsSchema, section: '10.2', fields: 'id, name, kind (usage | change), quality, goals (list of quality goal ids), priority; short form: context, stimulus, metric; long form: source, stimulus, environment, artifact, response, responseMeasure' },
  risks: { file: 'data/risks.yaml', key: 'risks', idField: 'id', schema: RisksSchema, section: '11', fields: 'id, kind (risk | debt), title, description, priority (high | medium | low), probability, impact, mitigation' },
  glossary: { file: 'data/glossary.yaml', key: 'terms', idField: 'term', schema: GlossarySchema, section: '12', fields: 'term, definition, translations (map language -> term), synonyms (list)' },
} as const;
type DataListName = keyof typeof DATA_LISTS;
const DataListSchema = z.enum(Object.keys(DATA_LISTS) as [DataListName, ...DataListName[]]);
const DATA_LIST_HELP = Object.entries(DATA_LISTS)
  .map(([name, l]) => `- ${name} (section ${l.section}, key field "${l.idField}"): ${l.fields}`)
  .join('\n');

function dataDocument(session: ArcherySession, list: DataListName) {
  const def = DATA_LISTS[list];
  const empty = list === 'requirements' ? yamlFile(REQUIREMENTS_HEADER, { requirements: [] }) : `${def.key}: []\n`;
  const doc = parseDocument(session.read(def.file) ?? empty);
  if (doc.errors.length > 0) throw new OpError(`${def.file} has syntax errors: ${doc.errors[0]!.message}`);
  if (!isSeq(doc.get(def.key, true))) doc.set(def.key, doc.createNode([]));
  return { def, doc };
}

/** The requirements a model element satisfies. */
function requirementsSatisfiedBy(session: ArcherySession, id: string): string[] {
  const text = session.read('data/requirements.yaml');
  if (text === undefined) return [];
  let items: unknown;
  try {
    items = (parseYamlText(text) as { requirements?: unknown } | null)?.requirements;
  } catch {
    return [];
  }
  return Array.isArray(items) ? items.filter((r) => Array.isArray(r?.satisfiedBy) && r.satisfiedBy.map(String).includes(id)).map((r) => String(r.id)) : [];
}

// ---------------------------------------------------------------------------
// ReqIF (requirements exchange with requirements tools)
// ---------------------------------------------------------------------------

/** The ReqIF file kept from the last import; export_reqif writes it back with Archery's changes. */
const REQIF_BASE = 'data/requirements.reqif';

function needDisk(session: ArcherySession) {
  if (!session.disk) throw new OpError('Reading and writing files outside the documentation is not available here.');
  return session.disk;
}

/** The ReqIF XML of a .reqif file or a .reqifz archive. */
function reqifXml(bytes: Uint8Array, file: string): string {
  if (!isZip(bytes)) return new TextDecoder().decode(bytes);
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    throw new OpError(`${file} is not a readable .reqifz archive: ${e instanceof Error ? e.message : e}`);
  }
  const entry = reqifEntry(entries);
  if (!entry) throw new OpError(`${file} contains no .reqif file.`);
  return new TextDecoder().decode(entry.data);
}

/** A data file's parsed content, or an error naming the file. */
function dataFile<S extends z.ZodType>(session: ArcherySession, file: string, schema: S): z.infer<S> | undefined {
  const text = session.read(file);
  if (text === undefined) return undefined;
  const parsed = parseYaml(file, text, schema);
  if (!parsed.value) throw new OpError(`${file} is invalid (${parsed.issues[0]?.message}). Run validate for details.`);
  return parsed.value;
}

/** Everything export_reqif writes: the requirements, the architecture they trace to, the decisions. */
function architectureData(session: ArcherySession): ArchitectureData {
  const project = parseProject(session.read('archery.yaml') ?? '').value;
  const quality = dataFile(session, 'data/quality-requirements.yaml', QualityRequirementsSchema);
  const decisions = session
    .files('decisions')
    .filter((f) => /\/\d{4}-.+\.md$/.test(f))
    .map((file) => {
      const { front, body } = splitAdrText(session.read(file) ?? '');
      let meta: Record<string, unknown> = {};
      try {
        meta = (front ? (parseYamlText(front) as Record<string, unknown> | null) : null) ?? {};
      } catch {
        meta = {};
      }
      const ids = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
      const number = /\/(\d{4})-/.exec(file)![1]!;
      const date = meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : meta.date != null ? String(meta.date) : undefined;
      return {
        number,
        title: adrTitle(body) ?? file.slice('decisions/'.length + 5, -3).replace(/-/g, ' '),
        status: typeof meta.status === 'string' ? meta.status : undefined,
        date,
        decision: readAdrParts(body).decision,
        requirements: ids(meta.requirements),
        qualityGoals: ids(meta.qualityGoals),
        constraints: ids(meta.constraints),
      };
    });
  const line = (label: string, value: string | undefined) => (value?.trim() ? `${label}: ${value.trim()}` : '');
  return {
    system: project?.system ?? 'System',
    requirements: dataFile(session, 'data/requirements.yaml', RequirementsSchema)?.requirements ?? [],
    goals: dataFile(session, 'data/quality-goals.yaml', QualityGoalsSchema)?.goals ?? [],
    scenarios: (quality?.scenarios ?? []).map((q) => ({
      id: q.id,
      name: q.name,
      kind: q.kind,
      quality: q.quality,
      goals: q.goals,
      priority: q.priority,
      text: [
        line('Source', q.source),
        line('Context', q.context),
        line('Stimulus', q.stimulus),
        line('Environment', q.environment),
        line('Artifact', q.artifact),
        line('Response', q.response),
        line('Response measure', q.responseMeasure),
        line('Metric', q.metric),
      ]
        .filter(Boolean)
        .join('\n'),
    })),
    constraints: dataFile(session, 'data/constraints.yaml', ConstraintsSchema)?.constraints ?? [],
    decisions,
    elements: session.model().elements.map((e) => ({ id: e.id, name: e.name, kind: e.kind, description: e.description, stereotype: e.stereotype, technology: e.technology })),
  };
}

/** Requirement ids changed in the requirements tool: the decisions that address them follow. */
function renameRequirementsInDecisions(session: ArcherySession, renamed: Map<string, string>): void {
  if (!renamed.size) return;
  for (const file of session.files('decisions').filter((f) => f.endsWith('.md'))) {
    const adr = splitAdr(session.read(file)!);
    const list = adr.front.get('requirements', true);
    if (!isSeq(list)) continue;
    let changed = false;
    for (const item of list.items) {
      if (isScalar(item) && renamed.has(String(item.value))) {
        item.value = renamed.get(String(item.value));
        changed = true;
      }
    }
    if (changed) session.write(file, joinAdr(adr.front, adr.body));
  }
}

/** Shows the requirements table in chapter 1.1 when no chapter shows it yet. Returns the chapter file. */
function showRequirementsTable(session: ArcherySession): string | undefined {
  const project = parseProject(session.read('archery.yaml') ?? '').value;
  const shown = (project?.sections ?? []).some((s) => /<!--\s*archery:table\s+data\/requirements\.yaml[\s#]/.test(session.read(s.file) ?? ''));
  if (shown) return undefined;
  const entry = project?.sections.find((s) => s.id === 'introduction-and-goals') ?? project?.sections[0];
  if (!entry || !session.has(entry.file)) return undefined;
  const s = { id: entry.id, number: findSection(entry.id)?.number, file: entry.file };
  try {
    insertInChapter(session, s, ['<!-- archery:table data/requirements.yaml -->'], 'Requirements Overview');
  } catch {
    insertInChapter(session, s, ['<!-- archery:table data/requirements.yaml -->']);
  }
  return session.display(entry.file);
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

const ElementFields = {
  stereotype: z.string().describe('Optional UML stereotype without guillemets, e.g. "service"').optional(),
  description: z.string().describe('Responsibility / short description (used in black box tables)').optional(),
  abstract: z.boolean().optional(),
  attributes: z.array(AttributeSchema).describe('Class attributes (kind class)').optional(),
  operations: z.array(OperationSchema).describe('Class operations (kind class/interface)').optional(),
  literals: z.array(z.string()).describe('Enum literals (kind enum)').optional(),
  technology: z.string().describe('Technology, platform or protocol, e.g. "Spring Boot", "PostgreSQL 16", "REST/HTTPS"').optional(),
  version: z.string().describe('Version of a component or artifact').optional(),
  instances: z.string().describe('Instances of a node / execution environment / component, e.g. "3" or "1..*"').optional(),
  responsibilities: z.array(z.string()).describe('What it is responsible for, one short point each').optional(),
  goals: z.array(z.string()).describe('What an actor wants to achieve (kind actor)').optional(),
  scenario: ScenarioSchema.describe('Use case flow (kind usecase): trigger, preconditions, main steps, alternatives, postconditions').optional(),
  constraints: z.array(z.string()).describe('Invariants and constraints, without braces').optional(),
  tags: z.record(z.string(), z.string()).describe('Tagged values, e.g. {"owner": "Team Payments"}').optional(),
  classifier: IdSchema.describe('Type of an instance, part or collaboration use (element id), e.g. the class of an object or the node of a node instance').optional(),
  slots: z.array(z.object({ name: z.string().min(1), value: z.string() })).describe('Slot values of an instance (object diagrams)').optional(),
  multiplicity: z.string().describe('Multiplicity of a part, e.g. "1..*"').optional(),
  reference: z.boolean().describe('A part that is a reference, not owned (drawn dashed)').optional(),
  extensionPoints: z.array(z.string()).describe('Extension points of a use case (kind usecase)').optional(),
  detail: z
    .string()
    .describe('The diagram that shows this element in detail, e.g. "order-service-internals" or "diagrams/order-service-internals.uml.json". Other diagrams then mark the element and link to it (drill-down).')
    .optional(),
};

/** The same fields for update_element: null clears a field. */
const nullable = <T extends Record<string, z.ZodOptional<z.ZodTypeAny>>>(fields: T) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.unwrap().nullable().optional()])) as { [K in keyof T]: z.ZodOptional<z.ZodNullable<ReturnType<T[K]['unwrap']>>> };

/** Tools a batch cannot run: they act outside the session (versions, export) or are batches themselves. */
const NOT_BATCHED = new Set(['batch', 'list_versions', 'release_version', 'restore_version', 'export_document', 'export_diagram', 'import_reqif', 'export_reqif']);

/** A place that refers to a diagram file: where it is, and how to drop it or point it elsewhere. */
interface DiagramReference {
  where: string;
  remove(): void;
  retarget(path: string): void;
}

/** Chapters that embed a diagram, elements that link to it (detail), interaction overview nodes that stand for it. */
function diagramReferences(session: ArcherySession, path: string): DiagramReference[] {
  const out: DiagramReference[] = [];
  const project = parseProject(session.read('archery.yaml') ?? '').value;
  // `<!-- archery:diagram <path>[#part] [width=… height=… collapsed caption="…"] -->`: the path ends at
  // a space or at `-->`, and attributes may follow it (comments do not nest, so `[\s\S]*?-->` is the rest).
  const directive = new RegExp(`<!--\\s*archery:diagram\\s+${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:#[^\\s]*)?(?:\\s[\\s\\S]*?)?-->`, 'g');
  for (const s of project?.sections ?? []) {
    const text = session.read(s.file);
    if (!text || !text.match(directive)) continue;
    out.push({
      where: `chapter ${findSection(s.id)?.number ?? s.id} (${s.file})`,
      remove: () => session.write(s.file, session.read(s.file)!.replace(new RegExp(`[ \\t]*${directive.source}[ \\t]*\\n?`, 'g'), '')),
      retarget: (to) => session.write(s.file, session.read(s.file)!.replace(directive, (m) => m.replace(path, to))),
    });
  }
  const model = session.model();
  for (const e of model.elements) {
    if (e.detail !== path) continue;
    const setDetail = (value: string | undefined) => {
      const doc = session.modelDocument();
      const i = seqIndex(doc, 'elements', 'id', e.id);
      if (value) doc.setIn(['elements', i, 'detail'], value);
      else doc.deleteIn(['elements', i, 'detail']);
      session.writeDocument('model.yaml', doc);
    };
    out.push({ where: `element ${e.id} (detail)`, remove: () => setDetail(undefined), retarget: (to) => setDetail(to) });
  }
  const short = path.replace(/^diagrams\//, '');
  for (const { path: other, diagram } of canvasDiagrams(session)) {
    if (other === path) continue;
    const linked = diagram.local.nodes.filter((n) => n.diagram && (n.diagram === path || n.diagram === short || `diagrams/${n.diagram}` === path));
    if (!linked.length) continue;
    const update = (to: string | undefined) => {
      const d = session.canvasDiagram(other);
      const nodes = d.local.nodes.map((n) => (linked.some((l) => l.id === n.id) ? (compact({ ...n, diagram: to }) as LocalNode) : n));
      session.writeJson(other, { ...d, local: { ...d.local, nodes } });
    };
    out.push({ where: `${session.display(other)} (${linked.map((l) => l.id).join(', ')})`, remove: () => update(undefined), retarget: (to) => update(to) });
  }
  return out;
}

/** A decision by number ("3", "0003", "ADR-3") or file name. */
function resolveDecision(session: ArcherySession, ref: string): string {
  const files = session.files('decisions').filter((f) => f.endsWith('.md') && /\/\d{4}-/.test(f));
  const number = /^\D*(\d{1,4})$/.exec(ref.trim())?.[1];
  const found = number ? files.find((f) => f.includes(`/${number.padStart(4, '0')}-`)) : files.find((f) => f === ref || f.endsWith(`/${ref}`) || f.endsWith(`/${ref}.md`) || session.display(f) === ref);
  if (!found) throw new OpError(`Unknown decision "${ref}". Decisions: ${files.map((f) => f.slice('decisions/'.length)).join(', ') || '(none)'}.`);
  return found;
}

/** An ADR file: its YAML front matter and its Markdown body. */
function splitAdr(text: string): { front: ReturnType<typeof parseYamlDocument>; body: string } {
  const { front, body } = splitAdrText(text);
  return { front: parseYamlDocument(front ?? ''), body };
}

function joinAdr(front: ReturnType<typeof parseYamlDocument>, body: string): string {
  const yaml = front.contents ? front.toString({ lineWidth: 0 }).trimEnd() : '';
  return `---\n${yaml}\n---\n\n${body.replace(/^\s+/, '')}`;
}

/** The optional ADR parts (MADR 4.0) as tool inputs; the core parts are `context`, `decision`/`decision_text`, `consequences`. */
const adrPartInputs = {
  drivers: z.string().describe('"Decision Drivers": the forces and concerns that shaped the decision (optional)').optional(),
  options: z.string().describe('"Considered Options": the alternatives looked at (optional)').optional(),
  confirmation: z.string().describe('"Confirmation": how compliance with the decision is checked (optional)').optional(),
};

function markSuperseded(session: ArcherySession, file: string): void {
  const old = splitAdr(session.read(file)!);
  old.front.set('status', 'superseded');
  session.write(file, joinAdr(old.front, old.body));
}

/** Sets a front matter list; an empty list removes the key unless `keepEmpty`. */
function setFrontList(front: ReturnType<typeof parseYamlDocument>, key: string, value: string[] | undefined, keepEmpty: boolean): void {
  if (value === undefined) return;
  if (!value.length && !keepEmpty) front.delete(key);
  else front.set(key, front.createNode(value, { flow: true }));
}

export const TOOLS: ToolDef<any>[] = [
  tool({
    name: 'overview',
    title: 'Documentation overview',
    description:
      'Summary of the architecture documentation: root folder, system name, the sections and their Markdown files, diagrams, data lists, ADRs, model size and the number of validation problems. Call this first.',
    input: z.object({}),
    readOnly: true,
    async run(session) {
      const { workspace, issues } = await validateWorkspace(sessionReader(session));
      const byKind: Record<string, number> = {};
      for (const e of workspace.model.elements) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      return {
        root: session.rootLabel || '.',
        system: workspace.project?.system,
        title: workspace.project?.title,
        sections: (workspace.project?.sections ?? []).map((s) => ({
          number: findSection(s.id)?.number,
          id: s.id,
          title: s.title ?? findSection(s.id)?.title ?? s.id,
          file: session.display(s.file),
          enabled: s.enabled,
        })),
        diagrams: workspace.diagrams.map((d) => ({ file: session.display(d.file), type: d.type, title: d.title })),
        dataLists: Object.keys(DATA_LISTS),
        decisions: workspace.decisions.map((f) => session.display(f)),
        model: { elements: byKind, relationships: workspace.model.relationships.length },
        problems: {
          errors: issues.filter((i) => i.severity === 'error').length,
          warnings: issues.filter((i) => i.severity === 'warning').length,
        },
        conventions:
          'Change chapters with get_section / edit_section / write_section / insert_text (call get_section_guide first) and place diagrams and tables with insert_into_section: the open document follows these edits live. Change model.yaml, diagrams and data/*.yaml only through these tools. Directives like <!-- archery:diagram ... --> embed generated content; keep them.',
      };
    },
  }),

  tool({
    name: 'get_section_guide',
    title: 'arc42 section guide',
    description:
      'What belongs in an arc42 section according to the official template (contents, motivation, form) plus its file path. Call before writing or reviewing section prose.',
    input: z.object({
      section: z.string().describe('Section number ("5"), id ("building-block-view") or title ("Building Block View")'),
    }),
    readOnly: true,
    run(session, { section }) {
      const q = section.trim().toLowerCase().replace(/\.$/, '');
      const def = SECTIONS.find((s) => String(s.number) === q || s.id === q || s.title.toLowerCase() === q);
      if (!def) throw new OpError(`Unknown section "${section}". Use 1-12, e.g. "5" for the building block view.`);
      return {
        number: def.number,
        id: def.id,
        title: def.title,
        file: session.display(`sections/${def.file}`),
        docs: def.docsUrl,
        guide: def.help,
        subsections: def.subsections.map((s, i) => ({ number: `${def.number}.${i + 1}`, title: s.title, guide: s.help })),
      };
    },
  }),

  tool({
    name: 'get_model',
    title: 'Get architecture model',
    description: 'Elements and relationships of the shared architecture model (model.yaml). Diagrams reference these ids.',
    input: z.object({ kind: ElementKindSchema.describe('Only return elements of this kind').optional() }),
    readOnly: true,
    run(session, { kind }) {
      const model = session.model();
      const elements = kind ? model.elements.filter((e) => e.kind === kind) : model.elements;
      const ids = new Set(elements.map((e) => e.id));
      return {
        elements,
        relationships: kind ? model.relationships.filter((r) => ids.has(r.from) || ids.has(r.to)) : model.relationships,
      };
    },
  }),

  tool({
    name: 'add_element',
    title: 'Add model element',
    description:
      'Add an element (component, actor, external system, use case, node, class, port, ...) to the shared model. The id is derived from the name unless given and never changes later. Use parent for nesting (component in package/component, port on component, artifact or execution environment in node). With `diagram` it is also placed on that canvas diagram (at x/y if given), or added as the last lifeline of that sequence diagram.',
    input: z.object({
      name: z.string().min(1),
      kind: ElementKindSchema,
      id: IdSchema.describe('Optional stable id; default: camelCase of the name').optional(),
      parent: IdSchema.describe('Id of the containing element').optional(),
      ...ElementFields,
      typeParams: z.array(z.string()).describe('Generic type parameters (classes/interfaces)').optional(),
      diagram: z.string().describe('Also show it on this canvas diagram').optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
    }),
    readOnly: false,
    confirm: (i) => `Add ${i.kind} "${i.name}" to the model${i.diagram ? ` and ${i.diagram}` : ''}?`,
    run(session, input) {
      const model = session.model();
      const taken = new Set([...model.elements.map((e) => e.id), ...model.relationships.map((r) => r.id)]);
      if (input.id && taken.has(input.id)) throw new OpError(`Id "${input.id}" is already used.`);
      if (input.parent) requireElement(model, input.parent);
      if (input.classifier) requireElement(model, input.classifier);
      if (input.detail) input.detail = session.resolveDiagram(input.detail);
      const id = input.id ?? uniqueId(camelSlug(input.name), taken);
      const { name, kind, parent, diagram: diagramName, x, y, w, h, ...rest } = input;
      const path = diagramName ? session.resolveDiagram(diagramName) : undefined;
      const doc = session.modelDocument();
      appendItem(doc, ['elements'], compact({ id, kind, name, parent, ...rest }));
      session.writeDocument('model.yaml', doc);
      if (path?.endsWith('.seq.json')) {
        // On a sequence diagram the new element becomes the last lifeline.
        const seq = session.sequenceDiagram(path);
        if (!seq.lifelines.some((l) => l.ref === id)) session.writeJson(path, { ...seq, lifelines: [...seq.lifelines, { ref: id }] });
      } else if (path?.endsWith('.timing.json')) {
        // On a timing diagram it becomes the last lifeline (no states yet).
        const timing = session.timingDiagram(path);
        if (!timing.lifelines.some((l) => l.ref === id)) session.writeJson(path, { ...timing, lifelines: [...timing.lifelines, { ref: id, states: [], changes: [] }] });
      } else if (path) {
        const diagram = session.canvasDiagram(path);
        const [node] = placeNodes(diagram.nodes, [id]);
        diagram.nodes.push(compact({ ...node!, x: x ?? node!.x, y: y ?? node!.y, w: w ?? node!.w, h: h ?? node!.h }) as DiagramNode);
        session.writeJson(path, diagram);
        return { id, message: `Added ${kind} "${name}" with id "${id}" to ${session.display(path)}.`, box: drawnBoxes(diagram, session.model(), [id])[id] };
      }
      return { id, message: `Added ${kind} "${name}" with id "${id}"${path ? ` to ${session.display(path)}` : ''}.` };
    },
  }),

  tool({
    name: 'update_element',
    title: 'Update model element',
    description:
      'Rename or otherwise change an element. Renaming updates every diagram automatically because diagrams reference the id. Pass null to clear an optional field.',
    input: z.object({
      id: IdSchema,
      name: z.string().min(1).optional(),
      kind: ElementKindSchema.optional(),
      parent: IdSchema.nullable().optional(),
      ...nullable(ElementFields),
      typeParams: z.array(z.string()).describe('Generic type parameters (classes/interfaces)').nullable().optional(),
    }),
    readOnly: false,
    confirm: (i) => `Update element "${i.id}"${i.name ? ` (rename to "${i.name}")` : ''}?`,
    run(session, { id, ...changes }) {
      const model = session.model();
      requireElement(model, id);
      if (changes.classifier) requireElement(model, changes.classifier);
      if (changes.detail) changes.detail = session.resolveDiagram(changes.detail);
      if (changes.parent) {
        // Reject cycles: the new parent must not be the element itself or one of its descendants.
        const parents = new Map(model.elements.map((e) => [e.id, e.parent]));
        for (let p: string | undefined = changes.parent; p; p = parents.get(p)) {
          requireElement(model, p);
          if (p === id) throw new OpError(`"${changes.parent}" is inside "${id}"; nesting would create a cycle.`);
        }
      }
      const doc = session.modelDocument();
      const index = seqIndex(doc, 'elements', 'id', id);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) continue;
        if (value === null) doc.deleteIn(['elements', index, key]);
        else doc.setIn(['elements', index, key], doc.createNode(value));
      }
      session.writeDocument('model.yaml', doc);
      return { id, message: `Updated "${id}".` };
    },
  }),

  tool({
    name: 'delete_element',
    title: 'Delete model element',
    description:
      'Delete an element from the model. Fails if it is still used (relationships, diagrams, sequence lifelines, children) unless cascade is true, which also removes those relationships, diagram nodes/edges, lifelines and their messages, and moves children to the deleted element\'s parent.',
    input: z.object({ id: IdSchema, cascade: z.boolean().default(false) }),
    readOnly: false,
    confirm: (i) => `Delete element "${i.id}" from the model${i.cascade ? ' and everything that uses it' : ''}?`,
    run(session, { id, cascade }) {
      const model = session.model();
      const element = requireElement(model, id);
      const relationships = model.relationships.filter((r) => r.from === id || r.to === id).map((r) => r.id);
      const children = model.elements.filter((e) => e.parent === id).map((e) => e.id);
      const canvas = canvasDiagrams(session).filter(({ diagram }) => diagram.nodes.some((n) => n.ref === id));
      const sequences = sequenceDiagrams(session).filter(({ diagram }) => diagram.lifelines.some((l) => l.ref === id));
      const timings = timingDiagrams(session).filter(({ diagram }) => diagram.lifelines.some((l) => l.ref === id));
      const satisfied = requirementsSatisfiedBy(session, id);
      const usages = [
        ...relationships.map((r) => `relationship ${r}`),
        ...children.map((c) => `child element ${c}`),
        ...canvas.map((d) => session.display(d.path)),
        ...sequences.map((d) => session.display(d.path)),
        ...timings.map((d) => session.display(d.path)),
        ...satisfied.map((r) => `requirement ${r} (satisfied by)`),
      ];
      if (usages.length > 0 && !cascade) {
        throw new OpError(`"${id}" is still used by: ${usages.join(', ')}. Pass cascade: true to remove it everywhere.`);
      }

      const doc = session.modelDocument();
      for (const child of children) {
        const i = seqIndex(doc, 'elements', 'id', child);
        if (element.parent) doc.setIn(['elements', i, 'parent'], element.parent);
        else doc.deleteIn(['elements', i, 'parent']);
      }
      for (const r of relationships) doc.deleteIn(['relationships', seqIndex(doc, 'relationships', 'id', r)]);
      doc.deleteIn(['elements', seqIndex(doc, 'elements', 'id', id)]);
      session.writeDocument('model.yaml', doc);

      const removedRels = new Set(relationships);
      for (const { path, diagram } of canvasDiagrams(session)) {
        const nodes = diagram.nodes.filter((n) => n.ref !== id);
        const edges = diagram.edges.filter((e) => !removedRels.has(e.ref));
        if (nodes.length !== diagram.nodes.length || edges.length !== diagram.edges.length) {
          session.writeJson(path, { ...diagram, nodes, edges });
        }
      }
      for (const { path, diagram } of sequences) {
        session.writeJson(path, {
          ...diagram,
          lifelines: diagram.lifelines.filter((l) => l.ref !== id),
          steps: removeMessages(diagram.steps, (x) => x === id),
        });
      }
      for (const { path, diagram } of timings) session.writeJson(path, withoutTimingLifeline(diagram, id));
      if (satisfied.length) {
        const { def, doc } = dataDocument(session, 'requirements');
        const items = doc.get(def.key, true);
        if (isSeq(items)) {
          for (const item of items.items) {
            const list = isMap(item) ? item.get('satisfiedBy', true) : undefined;
            if (isSeq(list)) list.items = list.items.filter((v) => !(isScalar(v) && String(v.value) === id));
          }
        }
        session.writeDocument(def.file, doc);
      }
      return { message: `Deleted "${id}".`, alsoRemoved: usages };
    },
  }),

  tool({
    name: 'add_relationship',
    title: 'Add relationship',
    description:
      'Add a relationship between two model elements. Kinds: dependency/usage (dashed arrow; use cases: stereotype "include" or "extend", an extend with condition and extensionPoint), association, aggregation, composition, generalization, realization, connector, deploy, manifest, link. By default the edge is also added to every canvas diagram that shows both elements.',
    input: z.object({
      kind: RelationshipKindSchema,
      from: IdSchema,
      to: IdSchema,
      label: z.string().describe('E.g. an operation "charge()" or protocol "REST/HTTPS"').optional(),
      multiplicity: z.object({ from: z.string().optional(), to: z.string().optional() }).describe('Associations only, e.g. {from: "1", to: "*"}').optional(),
      stereotype: z.string().describe('e.g. "include", "use", "HTTPS"').optional(),
      roles: Ends(z.string()).describe('Association end (role) names').optional(),
      qualifier: Ends(z.string()).describe('Qualifier at an association end, e.g. {from: "isbn"}').optional(),
      navigable: Ends(z.boolean()).describe('Navigable association ends (arrowheads)').optional(),
      associationClass: IdSchema.describe('Class that is the association class of this association').optional(),
      condition: z.string().describe('«extend» (dependency with stereotype "extend"): when the extension applies').optional(),
      extensionPoint: z.string().describe('«extend»: the extension point of the extended use case').optional(),
      description: z.string().optional(),
      id: IdSchema.describe('Optional stable id; default: "<from>-<to>"').optional(),
      addToDiagrams: z.boolean().default(true),
    }),
    readOnly: false,
    confirm: (i) => `Add ${i.kind} ${i.from} → ${i.to}${i.label ? ` "${i.label}"` : ''}?`,
    run(session, { addToDiagrams, ...input }) {
      const model = session.model();
      requireElement(model, input.from);
      requireElement(model, input.to);
      if (input.associationClass) requireElement(model, input.associationClass);
      const taken = new Set([...model.elements.map((e) => e.id), ...model.relationships.map((r) => r.id)]);
      if (input.id && taken.has(input.id)) throw new OpError(`Id "${input.id}" is already used.`);
      const id = input.id ?? uniqueId(`${input.from}-${input.to}`, taken);
      const doc = session.modelDocument();
      const { id: _requested, ...fields } = input;
      appendItem(doc, ['relationships'], compact({ id, ...fields }));
      session.writeDocument('model.yaml', doc);

      const diagrams: string[] = [];
      if (addToDiagrams) {
        const updated = session.model();
        for (const { path, diagram } of canvasDiagrams(session)) {
          // Only this relationship, and not where a part of an end already has it (mostSpecific).
          if (addMissingEdges({ ...diagram, edges: [...diagram.edges] }, updated).includes(id)) {
            diagram.edges.push({ ref: id, waypoints: [] });
            session.writeJson(path, diagram);
            diagrams.push(session.display(path));
          }
        }
      }
      return { id, message: `Added ${input.kind} "${id}".`, shownOn: diagrams };
    },
  }),

  tool({
    name: 'delete_relationship',
    title: 'Delete relationship',
    description: 'Delete a relationship from the model and remove its edge from all diagrams.',
    input: z.object({ id: IdSchema }),
    readOnly: false,
    confirm: (i) => `Delete relationship "${i.id}"?`,
    run(session, { id }) {
      const doc = session.modelDocument();
      const index = seqIndex(doc, 'relationships', 'id', id);
      if (index < 0) throw new OpError(`Unknown relationship "${id}".`);
      doc.deleteIn(['relationships', index]);
      session.writeDocument('model.yaml', doc);
      const diagrams: string[] = [];
      for (const { path, diagram } of canvasDiagrams(session)) {
        const edges = diagram.edges.filter((e) => e.ref !== id);
        if (edges.length !== diagram.edges.length) {
          session.writeJson(path, { ...diagram, edges });
          diagrams.push(session.display(path));
        }
      }
      return { message: `Deleted relationship "${id}".`, removedFrom: diagrams };
    },
  }),

  tool({
    name: 'get_diagram',
    title: 'Get diagram',
    description: 'Contents of a diagram with element names resolved from the model (canvas: nodes and edges; sequence: lifelines and steps; timing: lifelines with states and changes, messages, constraints). Canvas nodes come with their drawn box (x, y, w, h): text and children can make a box larger than the size it was given.',
    input: z.object({ diagram: z.string().describe('File name with or without extension, e.g. "building-blocks-l1"') }),
    readOnly: true,
    run(session, { diagram: name }) {
      const path = session.resolveDiagram(name);
      const model = session.model();
      const elements = new Map(model.elements.map((e) => [e.id, e]));
      if (path.endsWith('.timing.json')) {
        const d = session.timingDiagram(path);
        return { file: session.display(path), ...d, lifelines: d.lifelines.map((l) => ({ ...l, name: elements.get(l.ref)?.name ?? '(missing)' })) };
      }
      if (path.endsWith('.seq.json')) {
        const d = session.sequenceDiagram(path);
        return {
          file: session.display(path),
          ...d,
          lifelines: d.lifelines.map((l) => ({ ref: l.ref, name: elements.get(l.ref)?.name ?? '(missing)' })),
        };
      }
      const d = session.canvasDiagram(path);
      const rels = new Map(model.relationships.map((r) => [r.id, r]));
      const boxes = drawnBoxes(d, model);
      return {
        file: session.display(path),
        type: d.type,
        title: d.title,
        // With the defaults, so an agent sees what it can switch (update_diagram show).
        show: { tags: d.show?.tags ?? false, keywords: d.show?.keywords ?? 'auto' },
        nodes: d.nodes.map((n) => ({ ...n, ...boxes[n.ref], name: elements.get(n.ref)?.name ?? '(missing)', kind: elements.get(n.ref)?.kind })),
        edges: d.edges.map((e) => {
          const r = rels.get(e.ref);
          return {
            ref: e.ref,
            kind: r?.kind,
            from: r?.from,
            to: r?.to,
            label: r?.label,
            ...(e.style ? { style: e.style } : {}),
            ...(e.waypoints.length ? { waypoints: e.waypoints } : {}),
            ...(e.labelOffset ? { labelOffset: e.labelOffset } : {}),
          };
        }),
        local: { ...d.local, nodes: d.local.nodes.map((n) => ({ ...n, ...boxes[n.id] })) },
      };
    },
  }),

  tool({
    name: 'create_diagram',
    title: 'Create canvas diagram',
    description:
      'Create a canvas diagram (diagrams/<name>.uml.json) showing existing model elements. Relationships between the shown elements are added automatically. Types: component, package, deployment, class, object, composite (composite structure), state, activity, interactionOverview, context (use cases). Sequence and communication diagrams: write_sequence_diagram; timing diagrams: write_timing_diagram. Embed it in a section with <!-- archery:diagram diagrams/<name>.uml.json -->.',
    input: z.object({
      title: z.string().min(1),
      type: CanvasDiagramTypeSchema,
      name: z.string().describe('File name without extension; default: kebab-case of the title').optional(),
      elements: z.array(IdSchema).default([]),
      includeRelationships: z.boolean().default(true),
      relationships: RelationshipPolicySchema.default('mostSpecific').describe('mostSpecific (default): leave out a container\'s relationship when one of its shown parts has the same relationship to the same partner (or a part of it); all: every relationship between shown elements'),
      show: DiagramShowSchema.describe('What the diagram shows: tags (tagged values in the boxes, default false), keywords (relationship keywords such as «use» on the lines: true on every line, false on none, "auto" (default) on every line except «use» on a line that has a label). Change it later with update_diagram').optional(),
    }),
    readOnly: false,
    confirm: (i) => `Create ${i.type} diagram "${i.title}"?`,
    run(session, input) {
      const base = kebabSlug(input.name ?? input.title);
      if (!base) throw new OpError('Please give the diagram a name.');
      const path = `diagrams/${base}.uml.json`;
      if (session.has(path)) throw new OpError(`${session.display(path)} already exists. Use add_to_diagram instead.`);
      const model = session.model();
      input.elements.forEach((id) => requireElement(model, id));
      const diagram: CanvasDiagram = {
        version: 1,
        type: input.type,
        title: input.title,
        ...(input.show && Object.keys(compact(input.show)).length ? { show: compact(input.show) } : {}),
        nodes: placeNodes([], [...new Set(input.elements)]),
        edges: [],
        local: { nodes: [], edges: [] },
      };
      const edges = input.includeRelationships ? addMissingEdges(diagram, model, input.relationships) : [];
      session.writeJson(path, diagram);
      return {
        file: session.display(path),
        nodes: diagram.nodes.length,
        edges: edges.length,
        embed: `<!-- archery:diagram ${path} -->`,
      };
    },
  }),

  tool({
    name: 'add_to_diagram',
    title: 'Add elements to diagram',
    description: 'Show existing model elements on a canvas diagram (placed below the current content) and add the relationships between shown elements.',
    input: z.object({
      diagram: z.string(),
      elements: z.array(IdSchema).min(1),
      includeRelationships: z.boolean().default(true),
      relationships: RelationshipPolicySchema.default('mostSpecific').describe('mostSpecific (default): leave out a container\'s relationship when one of its shown parts has the same relationship to the same partner (or a part of it); all: every relationship between shown elements'),
    }),
    readOnly: false,
    confirm: (i) => `Add ${i.elements.join(', ')} to ${i.diagram}?`,
    run(session, input) {
      const path = session.resolveDiagram(input.diagram);
      if (!path.endsWith('.uml.json')) throw new OpError('add_to_diagram works on canvas diagrams; use write_sequence_diagram for sequences.');
      const model = session.model();
      input.elements.forEach((id) => requireElement(model, id));
      const diagram = session.canvasDiagram(path);
      const present = new Set(diagram.nodes.map((n) => n.ref));
      const added = [...new Set(input.elements)].filter((id) => !present.has(id));
      diagram.nodes.push(...placeNodes(diagram.nodes, added));
      const edges = input.includeRelationships ? addMissingEdges(diagram, model, input.relationships) : [];
      session.writeJson(path, diagram);
      return { file: session.display(path), addedNodes: added, addedEdges: edges };
    },
  }),

  tool({
    name: 'remove_from_diagram',
    title: 'Remove from diagram',
    description:
      'Remove items from a canvas diagram only (the model is unchanged): element refs, relationship refs, and diagram-local node/edge ids (notes, states, actions, transitions, flows). Removing a node also removes the edges attached to it; children of a removed local container move to its parent.',
    input: z.object({ diagram: z.string(), refs: z.array(IdSchema).min(1).describe('Element, relationship, local node or local edge ids') }),
    readOnly: false,
    confirm: (i) => `Remove ${i.refs.join(', ')} from ${i.diagram}?`,
    run(session, input) {
      const path = session.resolveDiagram(input.diagram);
      if (!path.endsWith('.uml.json')) throw new OpError('remove_from_diagram works on canvas diagrams.');
      const model = session.model();
      const refs = new Set(input.refs);
      const rels = new Map(model.relationships.map((r) => [r.id, r]));
      const diagram = session.canvasDiagram(path);
      const nodes = diagram.nodes.filter((n) => !refs.has(n.ref));
      const edges = diagram.edges.filter((e) => {
        const r = rels.get(e.ref);
        return !refs.has(e.ref) && !(r && (refs.has(r.from) || refs.has(r.to)));
      });
      const removedLocal = new Map(diagram.local.nodes.filter((n) => refs.has(n.id)).map((n) => [n.id, n]));
      const localNodes = diagram.local.nodes
        .filter((n) => !removedLocal.has(n.id))
        .map((n) => {
          let parent = n.parent;
          while (parent && removedLocal.has(parent)) parent = removedLocal.get(parent)!.parent;
          return compact({ ...n, parent }) as LocalNode;
        });
      const localEdges = diagram.local.edges.filter((e) => !refs.has(e.id) && !refs.has(e.from) && !refs.has(e.to));
      session.writeJson(path, { ...diagram, nodes, edges, local: { nodes: localNodes, edges: localEdges } });
      return {
        file: session.display(path),
        removedNodes: diagram.nodes.length - nodes.length + diagram.local.nodes.length - localNodes.length,
        removedEdges: diagram.edges.length - edges.length + diagram.local.edges.length - localEdges.length,
      };
    },
  }),

  tool({
    name: 'write_sequence_diagram',
    title: 'Write sequence diagram',
    description:
      'Create (or with overwrite: true, replace) a sequence diagram for a runtime scenario (section 6). Lifelines are model element ids (actors, components, external systems); elements used in messages are added as lifelines automatically. Steps: {msg: {from, to, label, kind: sync|async|reply|create|destroy|self|lost|found, async?: true for an asynchronous self/lost/found message, gate?: true when the missing end of a lost/found message is a gate on the frame (from / to outside the interaction)}}, {fragment: alt|opt|loop|par|break|critical|neg|strict|seq|ignore|consider|assert, branches: [{guard, steps}], min?, max? (loop iterations: loop(min,max), max "*" = unlimited)}, {fragment: "ref", label, over: [ids]}, {note, over: [ids]}. UML 2: answer every sync call with a reply from its receiver to its sender (label: the returned value) once the receiver\'s own calls are answered, in the same fragment operand; the sender sends nothing meanwhile. async, self, create, destroy, lost and found messages get no reply. Broken rules come back as problems. Embed with <!-- archery:diagram diagrams/<name>.seq.json -->.',
    input: z.object({
      title: z.string().min(1),
      name: z.string().describe('File name without extension; default: kebab-case of the title').optional(),
      lifelines: z.array(IdSchema).default([]),
      roles: z.record(IdSchema, z.string()).describe('Role names per lifeline id, shown as "role : Type" (default ":Type")').optional(),
      notation: z.enum(['sequence', 'communication']).describe('Draw the interaction as a sequence diagram (default) or a communication diagram (participants with links and numbered messages)').optional(),
      positions: z.record(IdSchema, z.object({ x: z.number(), y: z.number() })).describe('Communication diagrams: participant box positions').optional(),
      steps: z.array(SequenceStepSchema),
      overwrite: z.boolean().default(false),
    }),
    readOnly: false,
    confirm: (i) => `${i.overwrite ? 'Write' : 'Create'} sequence diagram "${i.title}"?`,
    run(session, input) {
      const base = kebabSlug(input.name ?? input.title);
      if (!base) throw new OpError('Please give the diagram a name.');
      const path = `diagrams/${base}.seq.json`;
      if (session.has(path) && !input.overwrite) {
        throw new OpError(`${session.display(path)} already exists. Pass overwrite: true to replace it (read it first with get_diagram).`);
      }
      const model = session.model();
      const lifelines = [...input.lifelines];
      const addLifeline = (id: string) => {
        requireElement(model, id);
        if (!lifelines.includes(id)) lifelines.push(id);
      };
      input.lifelines.forEach((id) => requireElement(model, id));
      forEachMessage(input.steps, (m) => [m.from, m.to].forEach((id) => id && addLifeline(id)));
      const diagram: SequenceDiagram = {
        version: 1,
        type: 'sequence',
        title: input.title,
        lifelines: lifelines.map((ref) => (input.roles?.[ref] ? { ref, role: input.roles[ref] } : { ref })),
        steps: input.steps,
        ...(input.notation === 'communication' ? { notation: 'communication' as const } : {}),
        ...(input.positions && Object.keys(input.positions).length ? { positions: input.positions } : {}),
      };
      session.writeJson(path, diagram);
      let messages = 0;
      forEachMessage(diagram.steps, () => messages++);
      const problems = sequenceProblems(diagram.steps);
      return { file: session.display(path), lifelines, messages, embed: `<!-- archery:diagram ${path} -->`, ...(problems.length ? { problems } : {}) };
    },
  }),

  tool({
    name: 'write_timing_diagram',
    title: 'Write timing diagram',
    description:
      'Create (or with overwrite: true, replace) a timing diagram: how the state of participants changes over time (section 6 runtime, or section 10 quality scenarios with deadlines). Lifelines: {ref: model element id, role?, form?: "state" (state timeline, default) | "value" (compact value lifeline), states: [top to bottom], changes: [{at, state}]}. Messages: {from, to, at, arrive?, label, kind: sync|async|reply}; leave out from (or to) for a message from (or to) a gate on the frame; from = to is a self message. Constraints: {on: lifeline id, from, to?, label}: a duration constraint from..to such as "0..2s", or a time constraint / observation at `from` (e.g. "t = now") when `to` is missing. Times are numbers in `unit` (e.g. "ms"). Embed with <!-- archery:diagram diagrams/<name>.timing.json -->.',
    input: z.object({
      title: z.string().min(1),
      name: z.string().describe('File name without extension; default: kebab-case of the title').optional(),
      unit: z.string().describe('Time unit shown on the axis, e.g. "ms"').optional(),
      end: z.number().positive().describe('End of the time axis (default: after the last event)').optional(),
      tick: z.number().positive().describe('Distance between axis ticks (default: automatic)').optional(),
      lifelines: z.array(TimingLifelineSchema),
      messages: z.array(TimingMessageSchema).default([]),
      constraints: z.array(TimingConstraintSchema).default([]),
      overwrite: z.boolean().default(false),
    }),
    readOnly: false,
    confirm: (i) => `${i.overwrite ? 'Write' : 'Create'} timing diagram "${i.title}"?`,
    run(session, input) {
      const base = kebabSlug(input.name ?? input.title);
      if (!base) throw new OpError('Please give the diagram a name.');
      const path = `diagrams/${base}.timing.json`;
      if (session.has(path) && !input.overwrite) {
        throw new OpError(`${session.display(path)} already exists. Pass overwrite: true to replace it (read it first with get_diagram).`);
      }
      const model = session.model();
      const refs = new Set<string>();
      for (const l of input.lifelines) {
        requireElement(model, l.ref);
        if (refs.has(l.ref)) throw new OpError(`"${l.ref}" has two lifelines.`);
        refs.add(l.ref);
      }
      for (const m of input.messages) for (const end of [m.from, m.to]) if (end && !refs.has(end)) throw new OpError(`Message "${m.label}" uses "${end}", which is not a lifeline.`);
      for (const c of input.constraints) if (!refs.has(c.on)) throw new OpError(`Constraint "${c.label}" is on "${c.on}", which is not a lifeline.`);
      const diagram: TimingDiagram = {
        version: 1,
        type: 'timing',
        title: input.title,
        unit: input.unit ?? '',
        ...(input.end ? { end: input.end } : {}),
        ...(input.tick ? { tick: input.tick } : {}),
        lifelines: input.lifelines.map((l) => ({
          ref: l.ref,
          ...(l.role ? { role: l.role } : {}),
          ...(l.form === 'value' ? { form: 'value' as const } : {}),
          states: l.states,
          changes: l.changes,
        })),
        messages: input.messages,
        constraints: input.constraints,
      };
      session.writeJson(path, diagram);
      return { file: session.display(path), lifelines: diagram.lifelines.length, messages: diagram.messages.length, embed: `<!-- archery:diagram ${path} -->` };
    },
  }),

  tool({
    name: 'get_data',
    title: 'Get structured section data',
    description: `Items of a structured arc42 list stored in data/*.yaml. Lists:\n${DATA_LIST_HELP}`,
    input: z.object({ list: DataListSchema }),
    readOnly: true,
    run(session, { list }) {
      const { def, doc } = dataDocument(session, list);
      return { file: session.display(def.file), items: (doc.get(def.key) as { toJSON(): unknown } | undefined)?.toJSON() ?? [] };
    },
  }),

  tool({
    name: 'upsert_data_item',
    title: 'Add or update structured item',
    description: `Add an item to a structured arc42 list, or update the item with the same key field (only the given fields change; null removes a field). The result is validated before it is written. Lists:\n${DATA_LIST_HELP}`,
    input: z.object({
      list: DataListSchema,
      item: z.record(z.string(), z.unknown()).describe('Fields of the item, including its key field'),
    }),
    readOnly: false,
    confirm: (i) => `Save item to ${i.list}?`,
    run(session, { list, item }) {
      const { def, doc } = dataDocument(session, list);
      const key = item[def.idField];
      if (typeof key !== 'string' || !key) throw new OpError(`The item needs its key field "${def.idField}".`);
      const index = seqIndex(doc, def.key, def.idField, key);
      if (index >= 0) {
        for (const [field, value] of Object.entries(item)) {
          if (value === null) doc.deleteIn([def.key, index, field]);
          else if (value !== undefined) doc.setIn([def.key, index, field], doc.createNode(value));
        }
      } else {
        appendItem(doc, [def.key], Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== undefined)));
      }
      const check = def.schema.safeParse(doc.toJS());
      if (!check.success) {
        const problems = check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new OpError(`Not saved, the item is invalid: ${problems}. Fields: ${def.fields}`);
      }
      session.writeDocument(def.file, doc);
      return { file: session.display(def.file), message: `${index >= 0 ? 'Updated' : 'Added'} "${key}".` };
    },
  }),

  tool({
    name: 'delete_data_item',
    title: 'Delete structured item',
    description: 'Delete an item from a structured arc42 list by its key field value (id, role, category or term).',
    input: z.object({ list: DataListSchema, key: z.string().min(1) }),
    readOnly: false,
    confirm: (i) => `Delete "${i.key}" from ${i.list}?`,
    run(session, { list, key }) {
      const { def, doc } = dataDocument(session, list);
      const index = seqIndex(doc, def.key, def.idField, key);
      if (index < 0) throw new OpError(`No item with ${def.idField} "${key}" in ${list}.`);
      doc.deleteIn([def.key, index]);
      session.writeDocument(def.file, doc);
      return { file: session.display(def.file), message: `Deleted "${key}".` };
    },
  }),

  tool({
    name: 'validate',
    title: 'Validate architecture documentation',
    description: 'Check all documentation files: schemas, references between model, diagrams and data (unknown ids, hidden edges, invalid lifelines, scenarios pointing to unknown quality goals, requirements pointing to unknown parents, elements or quality goals), UML 2 rules (sync calls without replies, misused pseudostates and control nodes), chapter directives (missing diagrams or lists, a file with several lists named without #list, tables without rows), the layout of canvas diagrams (overlapping shapes, shapes over a container they are not in, labels covering shapes or labels; with coordinates) and, with a browser installed, the layout of the tables the chapters show (words wider than their column, columns that wrap much more than the rest). Call after making changes.',
    input: z.object({}),
    readOnly: true,
    async run(session) {
      const { issues } = await validateWorkspace(sessionReader(session));
      // The tables the chapters show, measured in a browser when there is one: words wider than their
      // column, columns that wrap much more than the rest.
      const tables = await tableLayoutProblems(session).catch(() => []);
      return {
        ok: !issues.some((i) => i.severity === 'error'),
        problems: [
          ...issues.map((i) => ({
            severity: i.severity,
            file: session.display(i.file),
            line: i.line,
            message: i.message,
          })),
          ...tables.map((t) => ({ severity: 'warning' as const, file: session.display(t.file), line: undefined, message: t.message })),
        ],
      };
    },
  }),
  tool({
    name: 'update_relationship',
    title: 'Update relationship',
    description:
      'Change a relationship: kind, label, «stereotype», multiplicities, role names, qualifiers, navigability (association arrowheads), association class, or the condition / extension point of an «extend». Pass null to clear a field. reverse: true swaps its ends (from / to, with their multiplicities, roles, qualifiers and navigability).',
    input: z.object({
      id: IdSchema,
      kind: RelationshipKindSchema.optional(),
      label: z.string().nullable().optional(),
      stereotype: z.string().nullable().optional(),
      multiplicity: Ends(z.string()).nullable().optional(),
      roles: Ends(z.string()).nullable().optional(),
      qualifier: Ends(z.string()).nullable().optional(),
      navigable: Ends(z.boolean()).nullable().optional(),
      associationClass: IdSchema.nullable().optional(),
      condition: z.string().nullable().optional(),
      extensionPoint: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      reverse: z.boolean().optional(),
    }),
    readOnly: false,
    confirm: (i) => `${i.reverse ? 'Reverse' : 'Update'} relationship "${i.id}"?`,
    run(session, { id, reverse, ...changes }) {
      const model = session.model();
      const rel = model.relationships.find((r) => r.id === id);
      if (!rel) throw new OpError(`Unknown relationship "${id}".`);
      if (changes.associationClass) requireElement(model, changes.associationClass);
      const doc = session.modelDocument();
      const index = seqIndex(doc, 'relationships', 'id', id);
      if (reverse) {
        doc.setIn(['relationships', index, 'from'], rel.to);
        doc.setIn(['relationships', index, 'to'], rel.from);
        for (const key of ['multiplicity', 'roles', 'qualifier', 'navigable'] as const) {
          const ends = rel[key] as { from?: unknown; to?: unknown } | undefined;
          if (ends && !(key in changes)) doc.setIn(['relationships', index, key], doc.createNode(compact({ from: ends.to, to: ends.from })));
        }
      }
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) continue;
        if (value === null || (typeof value === 'object' && Object.values(value).every((v) => v === undefined || v === ''))) doc.deleteIn(['relationships', index, key]);
        else doc.setIn(['relationships', index, key], doc.createNode(typeof value === 'object' ? compact(value as object) : value));
      }
      session.writeDocument('model.yaml', doc);
      return { id, message: `Updated relationship "${id}".` };
    },
  }),

  tool({
    name: 'update_diagram',
    title: 'Update diagram',
    description:
      'Change the title of any diagram (the file name stays: rename_diagram), the type of a canvas diagram (its content stays; the type decides what the editor offers to add), or what a canvas diagram shows: show.tags (tagged values in the boxes, default false) and show.keywords (relationship keywords such as «use» on the lines: true on every line, false on none, "auto" (default) on every line except «use» on a line that has a label).',
    input: z.object({
      diagram: z.string(),
      title: z.string().optional(),
      type: CanvasDiagramTypeSchema.describe('New diagram type (canvas diagrams only)').optional(),
      show: DiagramShowSchema.describe('Canvas diagrams only; given fields are changed, the others stay').optional(),
    }),
    readOnly: false,
    confirm: (i) => `Update diagram ${i.diagram}${i.title !== undefined ? ` (title "${i.title}")` : ''}${i.type ? ` (type ${i.type})` : ''}?`,
    run(session, { diagram: name, title, type, show }) {
      const path = session.resolveDiagram(name);
      if ((type || show) && !path.endsWith('.uml.json')) throw new OpError('Only canvas diagrams have a type and display options.');
      const diagram = path.endsWith('.seq.json') ? session.sequenceDiagram(path) : path.endsWith('.timing.json') ? session.timingDiagram(path) : session.canvasDiagram(path);
      const shown = show && compact({ ...(diagram as CanvasDiagram).show, ...show });
      session.writeJson(path, { ...diagram, ...(title !== undefined ? { title } : {}), ...(type ? { type } : {}), ...(shown ? { show: shown } : {}) });
      return { file: session.display(path), title: title ?? diagram.title, ...(type ? { type } : {}), ...(shown ? { show: shown } : {}) };
    },
  }),

  tool({
    name: 'move_nodes',
    title: 'Move or resize diagram nodes',
    description:
      'Set the position (absolute diagram coordinates, top-left corner) and optionally the size of nodes on a canvas diagram. `id` is an element ref or a diagram-local node id.',
    input: z.object({
      diagram: z.string(),
      nodes: z.array(z.object({ id: IdSchema, x: z.number(), y: z.number(), w: z.number().positive().optional(), h: z.number().positive().optional() })).min(1),
    }),
    readOnly: false,
    confirm: (i) => `Move ${i.nodes.length} node(s) on ${i.diagram}?`,
    run(session, input) {
      const path = canvasPath(session, input.diagram);
      const diagram = session.canvasDiagram(path);
      const moves = new Map(input.nodes.map((n) => [n.id, n]));
      const round = (v: number) => Math.round(v);
      const apply = <T extends { x: number; y: number; w?: number; h?: number }>(n: T, id: string): T => {
        const m = moves.get(id);
        if (!m) return n;
        moves.delete(id);
        return { ...n, x: round(m.x), y: round(m.y), ...(m.w ? { w: round(m.w) } : {}), ...(m.h ? { h: round(m.h) } : {}) };
      };
      const nodes = diagram.nodes.map((n) => apply(n, n.ref));
      const localNodes = diagram.local.nodes.map((n) => apply(n, n.id));
      if (moves.size > 0) throw new OpError(`Not on ${session.display(path)}: ${[...moves.keys()].join(', ')}`);
      const moved = { ...diagram, nodes, local: { ...diagram.local, nodes: localNodes } };
      session.writeJson(path, moved);
      return { file: session.display(path), moved: input.nodes.length, boxes: drawnBoxes(moved, session.model(), input.nodes.map((n) => n.id)) };
    },
  }),

  tool({
    name: 'set_node_style',
    title: 'Set node presentation',
    description:
      'Presentation options of an element on one canvas diagram, e.g. { notation: "lollipop" } to draw an interface as a ball (provided via realization, required via usage = socket). Pass null to reset.',
    input: z.object({ diagram: z.string(), ref: IdSchema, style: z.record(z.string(), z.string()).nullable() }),
    readOnly: false,
    confirm: (i) => `Change how ${i.ref} is drawn on ${i.diagram}?`,
    run(session, { diagram: name, ref, style }) {
      const path = canvasPath(session, name);
      const diagram = session.canvasDiagram(path);
      if (!diagram.nodes.some((n) => n.ref === ref)) throw new OpError(`"${ref}" is not on ${session.display(path)}.`);
      const nodes = diagram.nodes.map((n) => {
        if (n.ref !== ref) return n;
        const { style: _old, ...rest } = n;
        return style && Object.keys(style).length > 0 ? { ...rest, style } : rest;
      });
      session.writeJson(path, { ...diagram, nodes });
      return { file: session.display(path), ref, style };
    },
  }),

  tool({
    name: 'add_local_node',
    title: 'Add diagram-local node',
    description: `Add a node that exists only on this diagram: a note, or a state machine / activity node. Kinds: ${LocalNodeKinds.join(', ')}. States take "text" for internal activities (one per line, e.g. "entry / start timer"); partitions (swimlanes), states, regions and interruptible regions contain other local nodes via parent; parent can also be an element shown on the diagram (a note inside a component). Orthogonal regions: "region" nodes with a state as parent (they fill the state, separated by dashed lines). entryPoint / exitPoint sit on the border of their parent state; a "pin" sits on the border of its parent action; acceptTimeEvent is the hourglass (name e.g. "every 5 min").`,
    input: z.object({
      diagram: z.string(),
      kind: LocalNodeKindSchema,
      name: z.string().optional(),
      text: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
      parent: IdSchema.optional(),
      id: IdSchema.optional(),
      diagram_ref: z.string().describe('interactionUse / interaction nodes: the diagram they stand for, e.g. "diagrams/checkout.seq.json"').optional(),
    }),
    readOnly: false,
    confirm: (i) => `Add ${i.kind}${i.name ? ` "${i.name}"` : ''} to ${i.diagram}?`,
    run(session, input) {
      const path = canvasPath(session, input.diagram);
      const diagram = session.canvasDiagram(path);
      const taken = new Set([...diagram.local.nodes.map((n) => n.id), ...diagram.local.edges.map((e) => e.id), ...diagram.nodes.map((n) => n.ref)]);
      if (input.id && taken.has(input.id)) throw new OpError(`Id "${input.id}" is already used on this diagram.`);
      if (input.parent && !diagram.local.nodes.some((n) => n.id === input.parent) && !diagram.nodes.some((n) => n.ref === input.parent)) {
        throw new OpError(`Unknown parent "${input.parent}": not a local node or an element on ${session.display(path)}.`);
      }
      const id = input.id ?? uniqueId(camelSlug(input.name || input.kind), taken);
      const [placed] = placeNodes([...diagram.nodes, ...diagram.local.nodes], [id]);
      const node = compact({
        id,
        kind: input.kind,
        name: input.name,
        text: input.text,
        x: Math.round(input.x ?? placed!.x),
        y: Math.round(input.y ?? placed!.y),
        w: input.w,
        h: input.h,
        parent: input.parent,
        diagram: input.diagram_ref,
      }) as LocalNode;
      session.writeJson(path, { ...diagram, local: { ...diagram.local, nodes: [...diagram.local.nodes, node] } });
      return { id, file: session.display(path) };
    },
  }),

  tool({
    name: 'update_local_node',
    title: 'Update diagram-local node',
    description: 'Change a note, state or activity node: name, text, kind or parent (null clears).',
    input: z.object({
      diagram: z.string(),
      id: IdSchema,
      name: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
      kind: LocalNodeKindSchema.optional(),
      parent: IdSchema.nullable().optional(),
      diagram_ref: z.string().nullable().describe('interactionUse / interaction nodes: the diagram they stand for (null clears)').optional(),
    }),
    readOnly: false,
    confirm: (i) => `Update ${i.id} on ${i.diagram}?`,
    run(session, { diagram: name, id, diagram_ref, ...rest }) {
      const changes: Record<string, unknown> = { ...rest, ...(diagram_ref !== undefined ? { diagram: diagram_ref } : {}) };
      const path = canvasPath(session, name);
      const diagram = session.canvasDiagram(path);
      if (!diagram.local.nodes.some((n) => n.id === id)) throw new OpError(`Unknown local node "${id}".`);
      if (changes.parent && (changes.parent === id || (!diagram.local.nodes.some((n) => n.id === changes.parent) && !diagram.nodes.some((n) => n.ref === changes.parent)))) throw new OpError(`Invalid parent "${changes.parent}".`);
      const nodes = diagram.local.nodes.map((n) => {
        if (n.id !== id) return n;
        const next: Record<string, unknown> = { ...n };
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) delete next[k];
          else if (v !== undefined) next[k] = v;
        }
        return next as LocalNode;
      });
      session.writeJson(path, { ...diagram, local: { ...diagram.local, nodes } });
      return { id, file: session.display(path) };
    },
  }),

  tool({
    name: 'add_local_edge',
    title: 'Add transition / flow / note link',
    description:
      'Connect two nodes on a canvas diagram with a diagram-local edge: "transition" (state machines, label "trigger [guard] / effect"), "flow" (activities, label "[guard]"), "interrupt" (an interrupting edge leaving an interruptible region, drawn as a lightning bolt), or "anchor" (dashed line from a note to anything). Ends are local node ids or element refs on the diagram. UML 2: nothing enters an initial node (in a state machine: one per region, one transition out, no trigger or guard); nothing leaves a final; fork: 1 in, 2+ out; join: 2+ in, 1 out; decision: 1 in; merge: 1 out; every edge out of a choice / decision has a [guard] or [else]. validate reports breaks.',
    input: z.object({ diagram: z.string(), kind: LocalEdgeKindSchema, from: IdSchema, to: IdSchema, label: z.string().optional(), id: IdSchema.optional() }),
    readOnly: false,
    confirm: (i) => `Add ${i.kind} ${i.from} → ${i.to}?`,
    run(session, input) {
      const path = canvasPath(session, input.diagram);
      const diagram = session.canvasDiagram(path);
      const ends = new Set([...diagram.local.nodes.map((n) => n.id), ...diagram.nodes.map((n) => n.ref)]);
      for (const end of [input.from, input.to]) if (!ends.has(end)) throw new OpError(`"${end}" is not on ${session.display(path)}.`);
      const taken = new Set([...diagram.local.nodes.map((n) => n.id), ...diagram.local.edges.map((e) => e.id)]);
      if (input.id && taken.has(input.id)) throw new OpError(`Id "${input.id}" is already used on this diagram.`);
      const id = input.id ?? uniqueId(`${input.from}-${input.to}`, taken);
      const edge = compact({ id, kind: input.kind, from: input.from, to: input.to, label: input.label, waypoints: [] }) as LocalEdge;
      session.writeJson(path, { ...diagram, local: { ...diagram.local, edges: [...diagram.local.edges, edge] } });
      return { id, file: session.display(path) };
    },
  }),

  tool({
    name: 'update_local_edge',
    title: 'Update transition / flow',
    description: 'Change the label or kind of a diagram-local edge (null clears the label).',
    input: z.object({ diagram: z.string(), id: IdSchema, label: z.string().nullable().optional(), kind: LocalEdgeKindSchema.optional() }),
    readOnly: false,
    confirm: (i) => `Update ${i.id} on ${i.diagram}?`,
    run(session, { diagram: name, id, label, kind }) {
      const path = canvasPath(session, name);
      const diagram = session.canvasDiagram(path);
      if (!diagram.local.edges.some((e) => e.id === id)) throw new OpError(`Unknown local edge "${id}".`);
      const edges = diagram.local.edges.map((e) => {
        if (e.id !== id) return e;
        const next: Record<string, unknown> = { ...e, ...(kind ? { kind } : {}) };
        if (label === null || label === '') delete next.label;
        else if (label !== undefined) next.label = label;
        return next as LocalEdge;
      });
      session.writeJson(path, { ...diagram, local: { ...diagram.local, edges } });
      return { id, file: session.display(path) };
    },
  }),

  tool({
    name: 'set_edge_waypoints',
    title: 'Route an edge',
    description: 'Set the bend points of an edge on a canvas diagram (absolute coordinates; [] for a straight line). `id` is a relationship ref or a local edge id.',
    input: z.object({ diagram: z.string(), id: IdSchema, waypoints: z.array(z.object({ x: z.number(), y: z.number() })) }),
    readOnly: false,
    confirm: (i) => `Re-route ${i.id} on ${i.diagram}?`,
    run(session, { diagram: name, id, waypoints }) {
      const path = canvasPath(session, name);
      const diagram = session.canvasDiagram(path);
      const points = waypoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      let found = false;
      const edges = diagram.edges.map((e) => (e.ref === id ? ((found = true), { ...e, waypoints: points }) : e));
      const localEdges = diagram.local.edges.map((e) => (e.id === id ? ((found = true), { ...e, waypoints: points }) : e));
      if (!found) throw new OpError(`No edge "${id}" on ${session.display(path)}.`);
      session.writeJson(path, { ...diagram, edges, local: { ...diagram.local, edges: localEdges } });
      return { id, file: session.display(path), waypoints: points.length };
    },
  }),

  tool({
    name: 'set_label_offset',
    title: 'Move a label',
    description:
      'Move a label on a canvas diagram away from its default place: the label of an edge (`id` is a relationship ref or a local edge id) or the outer name of a local node (entry / exit point, pin, decision, accept time event). `offset` is relative to the default place; null puts the label back. A moved label is tied to its line or shape by a dotted line.',
    input: z.object({ diagram: z.string(), id: IdSchema, offset: z.object({ x: z.number(), y: z.number() }).nullable() }),
    readOnly: false,
    confirm: (i) => `Move the label of ${i.id} on ${i.diagram}?`,
    run(session, { diagram: name, id, offset }) {
      const path = canvasPath(session, name);
      const diagram = session.canvasDiagram(path);
      const value = offset && (Math.round(offset.x) || Math.round(offset.y)) ? { x: Math.round(offset.x), y: Math.round(offset.y) } : undefined;
      const apply = <T extends { labelOffset?: { x: number; y: number } }>(e: T): T => {
        found = true;
        const { labelOffset: _, ...rest } = e;
        return (value ? { ...rest, labelOffset: value } : rest) as T;
      };
      let found = false;
      const edges = diagram.edges.map((e) => (e.ref === id ? apply(e) : e));
      const localEdges = diagram.local.edges.map((e) => (e.id === id ? apply(e) : e));
      const localNodes = diagram.local.nodes.map((n) => (n.id === id ? apply(n) : n));
      if (!found) throw new OpError(`No edge or local node "${id}" on ${session.display(path)}.`);
      session.writeJson(path, { ...diagram, edges, local: { ...diagram.local, nodes: localNodes, edges: localEdges } });
      return { id, file: session.display(path), moved: value !== undefined };
    },
  }),

  tool({
    name: 'auto_layout',
    title: 'Auto-layout diagram',
    description:
      'Arrange all nodes of a canvas diagram automatically (ELK layered layout): clients above what they use, superclasses / interfaces above their specializations, initial nodes first and final nodes last, few crossings, room for edge labels; containers fit their children, regions stack in their state, ports stay on their component; bend points and moved labels are reset. direction: DOWN, RIGHT, UP, LEFT (default: RIGHT for use case diagrams, else DOWN). Returns `warnings`: the layout warnings validate would still give for this diagram (empty when there are none).',
    input: z.object({ diagram: z.string(), direction: z.enum(['DOWN', 'RIGHT', 'UP', 'LEFT']).optional() }),
    readOnly: false,
    confirm: (i) => `Re-arrange ${i.diagram} automatically?`,
    async run(session, { diagram: name, direction }) {
      const path = canvasPath(session, name);
      const laid = await autoLayout(session.canvasDiagram(path), session.model(), direction);
      session.writeJson(path, laid);
      return { file: session.display(path), nodes: laid.nodes.length + laid.local.nodes.length, warnings: layoutProblems(laid, session.model(), 'classic', { afterAutoLayout: true }) };
    },
  }),

  tool({
    name: 'write_data_table',
    title: 'Write structured table',
    description: `Replace all rows of a structured arc42 list (data/*.yaml) at once, and/or its column layout (visible columns, their order, labels and widths; extra columns become custom fields on the items). Omit rows to change only the layout: the rows stay exactly as they are. Rows are objects of field -> text; numbers, comma-separated lists and "key: value" maps are converted per field. Rows without an id get one. fit: "auto" makes the export fit the column widths to the content (columns with a width keep it); fit_table_columns fits them once. Lists:\n${DATA_LIST_HELP}`,
    input: z.object({
      list: DataListSchema,
      rows: z.array(z.record(z.string(), z.string())).describe('All rows; omit to keep the current rows').optional(),
      columns: z
        .array(
          z.object({
            field: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'column fields are identifiers like "owner"'),
            label: z.string(),
            width: z.number().positive().max(100).optional().describe('Column width in percent of the table; omit for automatic'),
          }),
        )
        .describe('Visible columns in order; omit to keep the current layout')
        .optional(),
      merges: z
        .array(z.object({ row: z.string().describe('Key of the top row'), field: z.string(), rows: z.number().int().positive(), cols: z.number().int().positive() }))
        .describe('Merged cells (spreadsheet style); omit to keep the current ones')
        .optional(),
      fit: z.enum(['auto']).nullable().describe('"auto": the export fits the column widths to the content; null: widths as set; omit to keep').optional(),
    }),
    readOnly: false,
    confirm: (i) => (i.rows ? `Save the ${i.list} table (${i.rows.length} rows)?` : `Change the layout of the ${i.list} table?`),
    run(session, { list, rows: givenRows, columns, merges, fit }) {
      const def = listByName(list)!;
      const schema = DATA_LISTS[list].schema;
      const doc = parseDocument(session.read(def.file) ?? `${def.key}: []\n`);
      if (doc.errors.length > 0) throw new OpError(`${def.file} has syntax errors: ${doc.errors[0]!.message}`);
      if (!givenRows && !columns && !merges && fit === undefined) throw new OpError('Nothing to change: pass rows, columns, merges or fit.');
      const rows = givenRows ?? [];
      const fields = new Map(def.fields.map((f) => [f.field, f]));
      const label = (field: string) => fields.get(field)?.label ?? columns?.find((c) => c.field === field)?.label ?? field;
      const taken = new Set(rows.map((r) => r[def.keyField]?.trim()).filter((v): v is string => !!v));

      const items = rows.map((row, i) => {
        const item: Record<string, unknown> = {};
        for (const [field, text] of Object.entries(row)) {
          try {
            const value = parseCell(text, fields.get(field)?.type);
            if (value !== undefined) item[field] = value;
          } catch (e) {
            throw new OpError(`Row ${i + 1}, ${label(field)}: ${e instanceof Error ? e.message : e}`);
          }
        }
        if (item[def.keyField] === undefined) {
          if (!def.idPrefix) throw new OpError(`Row ${i + 1} needs a ${label(def.keyField)}.`);
          // Numbered like the decision records: QG-1, C-2, ... (the next free number from the row's).
          let n = i + 1;
          while (taken.has(`${def.idPrefix}${n}`)) n++;
          const id = `${def.idPrefix}${n}`;
          taken.add(id);
          item[def.keyField] = id;
        }
        for (const f of def.fields) {
          if (f.required && item[f.field] === undefined) throw new OpError(`Row ${i + 1}: "${f.label}" is required.`);
        }
        // Readable YAML: key field, then the list's fields in catalog order, then custom fields.
        const order = [def.keyField, ...def.fields.map((f) => f.field)];
        return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)));
      });
      const keys = items.map((it) => String(it[def.keyField]));
      const dup = keys.find((k, i) => keys.indexOf(k) !== i);
      if (dup) throw new OpError(`Two rows have the ${label(def.keyField)} "${dup}".`);

      // Without rows the items are left as they are (byte for byte).
      if (givenRows) {
        doc.set(def.key, doc.createNode(items));
        const seq = doc.get(def.key, true);
        if (isSeq(seq)) seq.flow = false;
      }
      if (columns || merges || fit !== undefined) {
        // The table layout (custom columns, order, labels, widths, merged cells, fit) lives in `views.<list key>`.
        const current = ((doc.toJS() as Record<string, any>)?.views?.[def.key] ?? {}) as { columns?: unknown; merges?: unknown; fit?: unknown };
        const defaults = defaultColumns(def);
        const cols = columns ?? (current.columns as typeof columns);
        const isDefault =
          !cols || (cols.length === defaults.length && cols.every((c, i) => c.field === defaults[i]!.field && c.label === defaults[i]!.label && c.width === undefined));
        const mergeList = merges ?? (current.merges as typeof merges) ?? [];
        const fitMode = fit === undefined ? (current.fit === 'auto' ? 'auto' : undefined) : (fit ?? undefined);
        const view: Record<string, unknown> = {};
        if (fitMode) view.fit = fitMode;
        if (!isDefault) view.columns = cols;
        if (mergeList.length > 0) view.merges = mergeList;
        if (Object.keys(view).length > 0) doc.setIn(['views', def.key], doc.createNode(view));
        else if (doc.hasIn(['views', def.key])) doc.deleteIn(['views', def.key]);
        const views = doc.get('views', true);
        if (isMap(views) && views.items.length === 0) doc.delete('views');
      }

      const check = schema.safeParse(doc.toJS());
      if (!check.success) {
        const problems = check.error.issues.map((issue) => {
          const [, index, field] = issue.path;
          return typeof index === 'number' ? `Row ${index + 1}${field ? `, ${label(String(field))}` : ''}: ${issue.message}` : issue.message;
        });
        throw new OpError(`Not saved: ${problems.join('; ')}`);
      }
      session.writeDocument(def.file, doc);
      const stored = (doc.toJS() as Record<string, unknown> | null)?.[def.key];
      return { file: session.display(def.file), rows: givenRows ? items.length : Array.isArray(stored) ? stored.length : 0 };
    },
  }),

  tool({
    name: 'fit_table_columns',
    title: 'Fit table column widths',
    description:
      'Balance the column widths of a data table (data/*.yaml): as few wrapped lines as possible and no word wider than its column. The table is measured in a browser (Edge, Chrome or Chromium) with the export\'s own fonts and layout, on the exported page (screen) and on the printed page (print: page size, orientation and margins from the export settings). Starting from the current widths, width moves between columns while the table gets shorter. Returns the widths in percent before and after (in the order of `fields`), `lines` (the lines all body cells are drawn with; a cell is as tall as its row) and `tallestCell` per target as [before, after], and the cells whose own text still takes 3 or more lines. apply: true saves the widths in the table\'s view (only the column widths change); fitting again gives the same widths. columns: limits per field in percent { min (default 3), max, fixed (keeps its current width) }.',
    input: z.object({
      list: DataListSchema,
      targets: TargetsSchema,
      columns: z
        .record(z.string(), z.object({ min: z.number().min(1).max(100).optional(), max: z.number().min(1).max(100).optional(), fixed: z.boolean().optional() }))
        .describe('Limits per field, in percent')
        .optional(),
      apply: z.boolean().describe('true: save the widths; false (default): only propose them').optional(),
    }),
    readOnly: false,
    confirm: (i) => (i.apply ? `Fit and save the column widths of the ${i.list} table?` : `Measure the ${i.list} table?`),
    async run(session, { list, targets, columns: limits, apply }) {
      const src = tableSource(session);
      const table = measurableTable(src, list);
      for (const [field, l] of Object.entries(limits ?? {})) {
        const col = table.columns.find((c) => c.field === field);
        if (!col) throw new OpError(`The ${list} table has no column "${field}"; its columns: ${table.columns.map((c) => c.field).join(', ')}.`);
        if (l.fixed && !col.width) throw new OpError(`Column "${field}" has no width to keep; drop "fixed" or give it a width.`);
        if (l.min !== undefined && l.max !== undefined && l.min > l.max) throw new OpError(`Column "${field}": min is above max.`);
      }
      const [r] = await measure(await browsersFor(session), src, [{ table, mode: 'fit', limits }], targets);
      if (!r || r.error) throw new OpError(r?.error ?? 'The table could not be measured.');
      if (!r.fitted || !r.fittedLayouts) {
        const cells = (r.tooWide ?? []).map((c) => `row ${c.row}, ${c.field}: a word needs ${c.wordPx}px, the column gets at most ${c.maxPx}px`);
        throw new OpError(`No widths fit every word within the limits${cells.length ? `: ${cells.join('; ')}` : ''}. Shorten those words, allow the columns more width, or show fewer columns.`);
      }
      const before = table.columns.every((c) => c.width) ? table.columns.map((c) => c.width!) : r.current.map((p) => Math.round(p));
      const per = (f: (l: TargetLayout) => number) => Object.fromEntries(r.layouts.map((l, i) => [l.target, [f(l), f(r.fittedLayouts![i]!)]]));
      const changed = r.fitted.some((w, i) => w !== table.columns[i]!.width);
      if (apply && changed) saveColumnWidths(session, list, table, r.fitted);
      return {
        list,
        fields: r.fields,
        before,
        after: r.fitted,
        lines: per(totalLines),
        tallestCell: per(tallestCell),
        stillWrapping: r.fittedLayouts.flatMap(stillWrapping),
        applied: !!apply && changed,
      };
    },
  }),

  tool({
    name: 'get_table_layout',
    title: 'Get table layout',
    description:
      'How a data table (data/*.yaml) is laid out with its current column widths, measured in a browser with the export\'s fonts and layout: per target (screen: the exported page; print: the printed page) the table height in px, each column\'s width in px and percent, the lines of each body cell\'s own text (by row key and field), cells whose content overflows, and columns the browser made wider than their width to fit a word. The table counterpart of get_diagram; fit_table_columns balances the widths.',
    input: z.object({ list: DataListSchema, targets: TargetsSchema }),
    readOnly: true,
    async run(session, { list, targets }) {
      const src = tableSource(session);
      const table = measurableTable(src, list);
      const [r] = await measure(await browsersFor(session), src, [{ table, mode: 'layout' }], targets);
      if (!r || r.error) throw new OpError(r?.error ?? 'The table could not be measured.');
      return {
        list,
        widths: table.columns.map((c) => c.width ?? null),
        targets: r.layouts.map((l) => {
          const rows = new Map<string, Record<string, number>>();
          for (const c of l.cells) rows.set(c.row, { ...rows.get(c.row), [c.field]: c.textLines });
          return {
            target: l.target,
            height: Math.round(l.height),
            columns: l.columns,
            lines: [...rows].map(([row, lines]) => ({ row, lines })),
            overflow: l.overflow,
            widenedForAWord: l.forced,
          };
        }),
      };
    },
  }),


  // -------------------------------------------------------------------------------------------
  // chapters (the document's text): read, write, edit, place diagrams / tables in them

  tool({
    name: 'get_section',
    title: 'Read a chapter',
    description:
      'The Markdown of an arc42 chapter (its file in sections/), with the generated parts as directives: <!-- archery:diagram diagrams/x.uml.json caption="..." -->, <!-- archery:table data/x.yaml caption="..." -->, <!-- archery:caption "..." --> before a Markdown table, <!-- archery:decisions decisions -->, <!-- archery:help ... --> (arc42 guidance, keep it).',
    input: z.object({ section: z.string().describe('Chapter number ("5"), id ("building-block-view") or title') }),
    readOnly: true,
    run(session, { section }) {
      const s = resolveSection(session, section);
      return { number: s.number, id: s.id, title: s.title, file: session.display(s.file), markdown: session.read(s.file) ?? '' };
    },
  }),

  tool({
    name: 'write_section',
    title: 'Write a chapter',
    description:
      'Replace the whole Markdown of a chapter (keep its "# Title" line, the archery:help guidance and the directives you do not mean to remove). Prefer edit_section for changes to part of a chapter. The open document shows the chapter while it changes.',
    input: z.object({ section: z.string(), markdown: z.string() }),
    readOnly: false,
    confirm: (i) => `Rewrite chapter ${i.section}?`,
    run(session, { section, markdown }) {
      const s = resolveSection(session, section);
      session.write(s.file, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
      return { file: session.display(s.file), message: `Wrote chapter ${s.number ?? ''} ${s.title}.`.replace('  ', ' ') };
    },
  }),

  tool({
    name: 'edit_section',
    title: 'Edit a chapter',
    description:
      'Change part of a chapter: replace the exact text `find` with `replace` (once; `all` for every occurrence). `find` must occur in the chapter (get_section shows it). To add text, find the line it goes after and replace it with that line plus the new text. The open document scrolls to the chapter and highlights the change.',
    input: z.object({
      section: z.string(),
      find: z.string().min(1),
      replace: z.string(),
      all: z.boolean().default(false),
    }),
    readOnly: false,
    confirm: (i) => `Edit chapter ${i.section}?`,
    run(session, { section, find, replace, all }) {
      const s = resolveSection(session, section);
      const text = session.read(s.file) ?? '';
      const count = text.split(find).length - 1;
      if (count === 0) throw new OpError(`The text to replace was not found in chapter ${s.number ?? s.id}. Call get_section and copy it exactly.`);
      if (count > 1 && !all) throw new OpError(`The text occurs ${count} times in chapter ${s.number ?? s.id}; give more context or set all: true.`);
      session.write(s.file, all ? text.split(find).join(replace) : text.replace(find, () => replace));
      return { file: session.display(s.file), replaced: all ? count : 1 };
    },
  }),

  tool({
    name: 'insert_into_section',
    title: 'Place a diagram or table in a chapter',
    description:
      'Show a diagram, a data table or the list of architecture decisions in a chapter, with an optional caption: at the end of the part under `after_heading` (a heading text of the chapter), else at the end of the chapter. To remove one again, use edit_section on its <!-- archery:... --> line.',
    input: z.object({
      section: z.string(),
      kind: z.enum(['diagram', 'table', 'decisions']),
      src: z.string().optional().describe('diagram: its name or file, e.g. "order-flow"; table: a data list name (requirements, quality-goals, stakeholders, constraints, quality-overview, quality-scenarios, risks, glossary)'),
      caption: z.string().optional(),
      after_heading: z.string().optional(),
    }),
    readOnly: false,
    confirm: (i) => `Show ${i.kind}${i.src ? ` ${i.src}` : ''} in chapter ${i.section}?`,
    run(session, input) {
      const s = resolveSection(session, input.section);
      let directive: string;
      if (input.kind === 'diagram') {
        if (!input.src) throw new OpError('Which diagram? Give its name in src.');
        const path = session.resolveDiagram(input.src);
        directive = `<!-- archery:diagram ${path}${input.caption ? ` caption=${JSON.stringify(input.caption.replaceAll('-->', '- ->'))}` : ''} -->`;
      } else if (input.kind === 'table') {
        const list = DataListSchema.safeParse(input.src);
        if (!list.success) throw new OpError(`Unknown data list "${input.src}". Lists: ${Object.keys(DATA_LISTS).join(', ')}.`);
        const def = DATA_LISTS[list.data];
        const shared = Object.values(DATA_LISTS).filter((d) => d.file === def.file).length > 1;
        const src = shared ? `${def.file}#${def.key}` : def.file;
        directive = `<!-- archery:table ${src}${input.caption ? ` caption=${JSON.stringify(input.caption.replaceAll('-->', '- ->'))}` : ''} -->`;
      } else directive = '<!-- archery:decisions decisions -->';
      insertInChapter(session, s, [directive], input.after_heading);
      return { file: session.display(s.file), inserted: directive };
    },
  }),

  tool({
    name: 'insert_text',
    title: 'Add text to a chapter',
    description:
      'Add Markdown to a chapter: at the end of the part under `after_heading` (a heading text of the chapter; the part ends at the next heading of the same or a higher level), else at the end of the chapter. The rest of the chapter, its archery:help comments included, stays as it is.',
    input: z.object({
      section: z.string(),
      markdown: z.string().min(1),
      after_heading: z.string().optional(),
    }),
    readOnly: false,
    confirm: (i) => `Add text to chapter ${i.section}${i.after_heading ? ` under "${i.after_heading}"` : ''}?`,
    run(session, input) {
      const s = resolveSection(session, input.section);
      const text = input.markdown.replace(/\r\n/g, '\n').trim();
      if (!text) throw new OpError('markdown is empty.');
      insertInChapter(session, s, text.split('\n'), input.after_heading);
      return { file: session.display(s.file), where: input.after_heading ? `end of "${input.after_heading}"` : 'end of the chapter' };
    },
  }),

  tool({
    name: 'create_decision',
    title: 'Record an architecture decision',
    description: 'Create an architecture decision record (decisions/NNNN-title.md, chapter 9) with status, context, decision and consequences, and optionally the decision drivers, considered options and confirmation (MADR). Change it later with update_decision.',
    input: z.object({
      title: z.string().min(1).describe('What was decided, e.g. "Use PostgreSQL for order data"'),
      status: AdrFrontMatterSchema.shape.status.optional(),
      date: z.string().describe('YYYY-MM-DD; default today').optional(),
      deciders: z.array(z.string()).describe('Who made the decision').optional(),
      context: z.string().optional(),
      decision: z.string().optional(),
      consequences: z.string().optional(),
      ...adrPartInputs,
      qualityGoals: z.array(IdSchema).optional().describe('Ids of the quality goals it addresses'),
      constraints: z.array(IdSchema).optional().describe('Ids of the constraints it addresses'),
      requirements: z.array(IdSchema).optional().describe('Ids of the requirements it addresses'),
      supersedes: z.string().describe('Number of the decision this one replaces (that one then gets status superseded)').optional(),
    }),
    readOnly: false,
    confirm: (i) => `Record decision "${i.title}"?`,
    run(session, input) {
      const numbers = session.files('decisions').map((p) => Number(/\/(\d{4})-/.exec(p)?.[1] ?? 0));
      const number = String(Math.max(0, ...numbers) + 1).padStart(4, '0');
      const slug = fileSlug(input.title, 60) || 'decision';
      const file = `decisions/${number}-${slug}.md`;
      const superseded = input.supersedes?.trim() ? resolveDecision(session, input.supersedes) : undefined;
      const front = parseYamlDocument('');
      front.set('status', input.status ?? 'proposed');
      front.set('date', input.date?.trim() || new Date().toISOString().slice(0, 10));
      setFrontList(front, 'deciders', input.deciders?.map((d) => d.trim()).filter(Boolean), false);
      if (superseded) front.set('supersedes', /(\d{4})-/.exec(superseded)![1]!);
      setFrontList(front, 'qualityGoals', input.qualityGoals ?? [], true);
      setFrontList(front, 'constraints', input.constraints ?? [], true);
      setFrontList(front, 'requirements', input.requirements ?? [], false);
      let body = `# ${input.title.trim()}\n\n## Context\n\n## Decision\n\n## Consequences\n`;
      const parts: [AdrPart, string | undefined][] = [
        ['context', input.context],
        ['drivers', input.drivers],
        ['options', input.options],
        ['decision', input.decision],
        ['consequences', input.consequences],
        ['confirmation', input.confirmation],
      ];
      for (const [key, text] of parts) if (text?.trim()) body = setAdrPart(body, key, text);
      session.write(file, joinAdr(front, body));
      if (superseded) markSuperseded(session, superseded);
      return { file: session.display(file), number, ...(superseded ? { superseded: session.display(superseded) } : {}) };
    },
  }),

  // -------------------------------------------------------------------------------------------
  // diagrams: arrange

  tool({
    name: 'align_nodes',
    title: 'Align or distribute diagram nodes',
    description:
      'Line up shapes on a canvas diagram: left / centerH (centers on a vertical line) / right / top / middle (centers on a horizontal line) / bottom edges, or distributeH / distributeV (equal gaps, needs 3 or more). `ids` are element refs or diagram-local node ids; ports, pins and entry / exit points stay on their parent.',
    input: z.object({ diagram: z.string(), ids: z.array(IdSchema).min(2), mode: z.enum(ALIGN_MODES as [AlignMode, ...AlignMode[]]) }),
    readOnly: false,
    confirm: (i) => `Arrange ${i.ids.length} nodes on ${i.diagram} (${i.mode})?`,
    run(session, { diagram: name, ids, mode }) {
      const path = canvasPath(session, name);
      const diagram = session.canvasDiagram(path);
      const laid = layoutNodes(diagram, session.model());
      const missing = ids.filter((id) => !laid.has(id));
      if (missing.length) throw new OpError(`Not on ${session.display(path)}: ${missing.join(', ')}`);
      const boxes = ids.map((id) => laid.get(id)!).filter((n) => !n.side).map((n) => ({ id: n.id, ...n.box }));
      if (mode.startsWith('distribute') && boxes.length < 3) throw new OpError('Distributing needs 3 or more shapes.');
      const moves = new Map(alignBoxes(boxes, mode).map((m) => [m.id, m]));
      const at = <T extends { x: number; y: number }>(n: T, id: string): T => {
        const m = moves.get(id);
        return m ? { ...n, x: m.x, y: m.y } : n;
      };
      session.writeJson(path, { ...diagram, nodes: diagram.nodes.map((n) => at(n, n.ref)), local: { ...diagram.local, nodes: diagram.local.nodes.map((n) => at(n, n.id)) } });
      return { file: session.display(path), moved: moves.size };
    },
  }),

  // -------------------------------------------------------------------------------------------
  // versions and export (need VS Code with Archery: Copilot runs in it; the MCP server reaches it)

  tool({
    name: 'list_versions',
    title: 'Versions and releases',
    description: 'The current version of the documentation and its releases (and backups made before a restore).',
    input: z.object({}),
    readOnly: true,
    run: (session) => needHost(session).versions(),
  }),

  tool({
    name: 'release_version',
    title: 'Release a version',
    description: 'Release the current state as the next major version (e.g. v3.0) with a change log entry; it is added to the change history at the end of the document. Only when something changed since the last release.',
    input: z.object({ note: z.string().min(1).describe('Change log entry, e.g. "Added the deployment view"') }),
    readOnly: false,
    confirm: (i) => `Release a new version ("${i.note}")?`,
    run: async (session, { note }) => ({ version: await needHost(session).release(note.trim()) }),
  }),

  tool({
    name: 'restore_version',
    title: 'Restore a release',
    description: 'Replace all documentation files by an earlier release (list_versions). The current state is kept as a backup version first, so this can be undone by restoring that one.',
    input: z.object({ version: z.string().describe('e.g. "2.0"') }),
    readOnly: false,
    confirm: (i) => `Restore v${i.version}? All documentation files are replaced (the current state is kept as a backup).`,
    run: async (session, { version }) => ({ version: await needHost(session).restore(version.replace(/^v/, '')) }),
  }),

  tool({
    name: 'export_document',
    title: 'Export the document (PDF or HTML)',
    description:
      'Export the whole architecture document as PDF (needs Edge, Chrome or Chromium) or as one self-contained HTML file. `file`: where to write it, relative to the workspace (default: next to the documentation folder). `settings`: export options (font, fontSize, pageSize, orientation, margins, header, footer, pageNumbers, tocDepth, variables: name -> value of the variables the text, header and footer use besides the built-in ones, ...); they are saved for the next export, and options not given stay as saved.',
    input: z.object({ format: z.enum(['pdf', 'html']), file: z.string().optional(), settings: ExportSettingsSchema.optional() }),
    readOnly: false,
    confirm: (i) => `Export the document as ${i.format.toUpperCase()}${i.file ? ` to ${i.file}` : ''}?`,
    run: async (session, { format, file, settings }) => ({ file: await needHost(session).exportDocument(format, file, settings as Record<string, unknown> | undefined) }),
  }),

  tool({
    name: 'import_reqif',
    title: 'Import requirements (ReqIF)',
    description:
      "Import requirements from a ReqIF file (.reqif, or a .reqifz archive; the OMG Requirements Interchange Format of DOORS, Polarion, Jama, codebeamer, Capella, ReqIF Studio and others) into the requirements list (data/requirements.yaml, shown in chapter 1.1). Every requirement of the file's specifications becomes a row in document order: id (from ReqIF.ForeignID), heading (ReqIF.ChapterName), title (ReqIF.Name), text (ReqIF.Text, as Markdown), type, status, priority, parent (its place in the hierarchy), specification, and its other attributes. Importing again updates the requirements from the file and drops the ones the file no longer has; Archery's trace links (satisfiedBy, goals) and requirements added in Archery stay. The file is kept as data/requirements.reqif, so export_reqif writes it back with only Archery's changes. `file`: relative to the workspace, or absolute.",
    input: z.object({ file: z.string().min(1) }),
    readOnly: false,
    confirm: (i) => `Import requirements from ${i.file}?`,
    async run(session, { file }) {
      const xml = reqifXml(await needDisk(session).read(file), file);
      let reqif: Reqif;
      try {
        reqif = Reqif.parse(xml);
      } catch (e) {
        throw new OpError(`${file} is not a readable ReqIF file: ${e instanceof Error ? e.message : e}`);
      }
      const { items, specifications } = readRequirements(reqif);
      const { def, doc } = dataDocument(session, 'requirements');
      const current = (doc.toJS() as { requirements?: unknown } | null)?.requirements;
      const merged = mergeRequirements(Array.isArray(current) ? current.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object') : [], items);
      doc.set(def.key, doc.createNode(merged.items));
      // First import: show the columns the file fills.
      if (!doc.hasIn(['views', def.key])) {
        const filled = (field: string) => merged.items.some((i) => i[field] !== undefined && i[field] !== '');
        const fields = listByName('requirements')!.fields;
        const columns = ['id', 'heading', 'title', 'text', 'status', 'satisfiedBy']
          .filter((f) => !['heading', 'title', 'status'].includes(f) || filled(f))
          .map((f) => ({ field: f, label: fields.find((d) => d.field === f)!.label }));
        doc.setIn(['views', def.key, 'columns'], doc.createNode(columns));
      }
      const check = RequirementsSchema.safeParse(doc.toJS());
      if (!check.success) throw new OpError(`Not imported, the requirements would be invalid: ${check.error.issues[0]?.path.join('.')}: ${check.error.issues[0]?.message}`);
      session.writeDocument(def.file, doc);
      session.write(REQIF_BASE, xml);
      renameRequirementsInDecisions(session, merged.renamed);
      const shownIn = showRequirementsTable(session);
      return {
        file: session.display(def.file),
        specifications,
        requirements: merged.items.length,
        added: merged.added.length,
        updated: merged.updated.length,
        unchanged: merged.unchanged,
        removed: merged.removed,
        keptFromArchery: merged.kept,
        ...(merged.renamed.size ? { renamed: Object.fromEntries(merged.renamed) } : {}),
        ...(shownIn ? { tableAddedTo: shownIn } : {}),
      };
    },
  }),

  tool({
    name: 'export_reqif',
    title: 'Export requirements (ReqIF)',
    description:
      "Export the requirements (data/requirements.yaml) as a ReqIF file for a requirements tool, with the architecture they trace to: quality goals, quality scenarios, constraints, decisions and the building blocks that satisfy requirements, each as a specification of its own, and the trace links as relations (Satisfies: building block -> requirement; Refines: requirement or scenario -> quality goal; Addresses: decision -> requirement, quality goal or constraint). After import_reqif, the imported file is written back with only Archery's changes: identifiers, unchanged values (with their formatting), types and the tool's own data stay. `file`: relative to the workspace, or absolute; .reqifz writes a ZIP archive (default: <system>.reqif next to the documentation folder).",
    input: z.object({ file: z.string().optional() }),
    readOnly: false,
    confirm: (i) => `Export the requirements as ReqIF${i.file ? ` to ${i.file}` : ''}?`,
    async run(session, { file }) {
      const data = architectureData(session);
      let result;
      try {
        result = exportReqif(data, { base: session.read(REQIF_BASE) });
      } catch (e) {
        throw new OpError(`Not exported: ${e instanceof Error ? e.message : e}`);
      }
      const name = `${kebabSlug(data.system) || 'requirements'}.reqif`;
      const zip = /\.reqifz$/i.test(file ?? '');
      const bytes = new TextEncoder().encode(result.xml);
      const inner = (file ?? name).replace(/\\/g, '/').split('/').pop()!.replace(/\.reqifz$/i, '.reqif');
      const written = await needDisk(session).write(file, name, zip ? writeZip([{ name: inner, data: bytes }]) : bytes);
      return { file: written, requirements: result.requirements, added: result.added, changed: result.changed, removed: result.removed, architecture: result.architecture, links: result.links };
    },
  }),

  tool({
    name: 'export_diagram',
    title: 'Export a diagram (SVG or PNG)',
    description: 'Export one diagram as an SVG or PNG image. `file`: where to write it, relative to the workspace (default: next to the diagram file).',
    input: z.object({ diagram: z.string(), format: z.enum(['svg', 'png']), theme: z.enum(['light', 'dark']).default('light'), file: z.string().optional() }),
    readOnly: false,
    confirm: (i) => `Export ${i.diagram} as ${i.format.toUpperCase()}?`,
    run: async (session, { diagram, format, theme, file }) => ({ file: await needHost(session).exportDiagram(session.resolveDiagram(diagram), format, theme, file) }),
  }),

  // -------------------------------------------------------------------------------------------
  // lines, batches, project and diagram files, decisions

  tool({
    name: 'set_line_shape',
    title: 'Set line shape',
    description:
      'How lines are drawn on a canvas diagram: straight, orthogonal (right angles), curved, horizontalFirst / verticalFirst (one corner: across first, or up / down first), or auto (the default: straight). `ids`: relationship refs or local edge ids; omit them for every line of the diagram.',
    input: z.object({ diagram: z.string(), ids: z.array(IdSchema).optional(), line: z.enum([...LineShapes, 'auto']) }),
    readOnly: false,
    confirm: (i) => `Draw ${i.ids?.length ? i.ids.join(', ') : 'all lines'} on ${i.diagram} ${i.line === 'auto' ? 'in the diagram style' : i.line}?`,
    run(session, { diagram: name, ids, line }) {
      const path = canvasPath(session, name);
      const diagram = session.canvasDiagram(path);
      const want = ids && new Set(ids);
      const found = new Set<string>();
      const apply = <T extends { style?: Record<string, string> }>(e: T, id: string): T => {
        if (want && !want.has(id)) return e;
        found.add(id);
        const { line: _, ...rest } = e.style ?? {};
        const style = line === 'auto' ? rest : { ...rest, line };
        const { style: _old, ...bare } = e;
        return (Object.keys(style).length ? { ...bare, style } : bare) as T;
      };
      const edges = diagram.edges.map((e) => apply(e, e.ref));
      const localEdges = diagram.local.edges.map((e) => apply(e, e.id));
      const missing = ids?.filter((id) => !found.has(id)) ?? [];
      if (missing.length) throw new OpError(`No edge ${missing.map((m) => `"${m}"`).join(', ')} on ${session.display(path)}.`);
      session.writeJson(path, { ...diagram, edges, local: { ...diagram.local, edges: localEdges } });
      return { file: session.display(path), lines: found.size, line };
    },
  }),

  tool({
    name: 'batch',
    title: 'Run several operations at once',
    description:
      'Run several Archery operations in one call, in order, as one change: when one fails, nothing is changed and the error says which. Each operation is {tool, input}, e.g. {tool: "add_element", input: {name: "Orders", kind: "component"}}; later operations see what earlier ones did. Use it to add many elements, relationships, local nodes or edges at once. Versions and export cannot be batched.',
    input: z.object({
      operations: z
        .array(z.object({ tool: z.string().describe('Tool name, e.g. add_element'), input: z.record(z.string(), z.unknown()).default({}) }))
        .min(1)
        .max(500),
    }),
    readOnly: false,
    confirm: (i) => `Run ${i.operations.length} operations (${[...new Set(i.operations.map((o) => o.tool))].join(', ')})?`,
    async run(session, { operations }) {
      const results: unknown[] = [];
      for (const [i, op] of operations.entries()) {
        const def = TOOLS.find((t) => t.name === op.tool);
        if (!def || NOT_BATCHED.has(op.tool)) throw new OpError(`Operation ${i + 1}: "${op.tool}" ${def ? 'cannot be batched' : 'is not an Archery tool'}. Nothing was changed.`);
        const parsed = def.input.safeParse(op.input);
        if (!parsed.success) throw new OpError(`Operation ${i + 1} (${op.tool}): invalid input: ${parsed.error.issues.map((x: z.core.$ZodIssue) => `${x.path.join('.') || 'input'}: ${x.message}`).join('; ')}. Nothing was changed.`);
        try {
          results.push(await def.run(session, parsed.data));
        } catch (e) {
          if (e instanceof OpError) throw new OpError(`Operation ${i + 1} (${op.tool}) failed: ${e.message} Nothing was changed.`);
          throw e;
        }
      }
      return { done: operations.length, results };
    },
  }),

  tool({
    name: 'set_project',
    title: 'Set project details',
    description: 'Change the system name, the document title or the authors in archery.yaml (shown on the title page and in exports).',
    input: z.object({
      system: z.string().min(1).optional(),
      title: z.string().optional(),
      authors: z.array(z.string()).optional(),
    }),
    readOnly: false,
    confirm: (i) => `Change the project details${i.system ? ` (system "${i.system}")` : ''}?`,
    run(session, input) {
      const text = session.read('archery.yaml');
      if (text === undefined) throw new OpError('archery.yaml not found. Call initialize first.');
      const doc = parseYamlDocument(text);
      if (doc.errors.length) throw new OpError(`archery.yaml has syntax errors: ${doc.errors[0]!.message}`);
      if (input.system !== undefined) doc.set('system', input.system.trim());
      if (input.title !== undefined) {
        if (input.title.trim()) doc.set('title', input.title.trim());
        else doc.delete('title');
      }
      if (input.authors !== undefined) doc.set('authors', doc.createNode(input.authors));
      session.writeDocument('archery.yaml', doc);
      const project = parseProject(session.read('archery.yaml')!).value;
      return { system: project?.system, title: project?.title, authors: project?.authors };
    },
  }),

  tool({
    name: 'delete_diagram',
    title: 'Delete diagram',
    description:
      'Delete a diagram file. Fails while a chapter shows it or an element links to it (detail), unless force is true, which also removes those chapter directives and links.',
    input: z.object({ diagram: z.string(), force: z.boolean().default(false) }),
    readOnly: false,
    confirm: (i) => `Delete diagram ${i.diagram}${i.force ? ' and every reference to it' : ''}?`,
    run(session, { diagram: name, force }) {
      const path = session.resolveDiagram(name);
      const uses = diagramReferences(session, path);
      if (uses.length && !force) throw new OpError(`${session.display(path)} is still used by: ${uses.map((u) => u.where).join(', ')}. Pass force: true to remove those references too.`);
      for (const u of uses) u.remove();
      session.remove(path);
      return { deleted: session.display(path), removedReferences: uses.map((u) => u.where) };
    },
  }),

  tool({
    name: 'rename_diagram',
    title: 'Rename diagram file',
    description:
      'Give a diagram a new file name (diagrams/<name>.<type>.json); chapter directives, element detail links and interaction overview references follow. The title stays (change it with update_diagram).',
    input: z.object({ diagram: z.string(), name: z.string().min(1).describe('New file name without extension, e.g. "deployment-bench"') }),
    readOnly: false,
    confirm: (i) => `Rename ${i.diagram} to ${i.name}?`,
    run(session, { diagram: name, name: next }) {
      const path = session.resolveDiagram(name);
      const ext = /\.(uml|seq|timing)\.json$/.exec(path)![0];
      const base = kebabSlug(next.replace(/\.(uml|seq|timing)\.json$/, '').replace(/^.*\//, ''));
      if (!base) throw new OpError('Please give the diagram a name.');
      const target = `diagrams/${base}${ext}`;
      if (target === path) return { file: session.display(path), renamed: false };
      if (session.has(target)) throw new OpError(`${session.display(target)} already exists.`);
      const uses = diagramReferences(session, path);
      session.write(target, session.read(path)!);
      session.remove(path);
      for (const u of uses) u.retarget(target);
      return { file: session.display(target), renamed: true, updatedReferences: uses.map((u) => u.where) };
    },
  }),

  tool({
    name: 'update_decision',
    title: 'Update an architecture decision',
    description:
      'Change an architecture decision record: its status, date, deciders, title, context, decision, consequences, decision drivers, considered options, confirmation, the quality goals / constraints it addresses, or which earlier decision it supersedes (that one then gets status superseded; "" removes the link). An empty drivers / options / confirmation removes that part. `decision`: its number ("3", "0003") or file name.',
    input: z.object({
      decision: z.string().min(1),
      status: AdrFrontMatterSchema.shape.status.optional(),
      date: z.string().describe('YYYY-MM-DD').optional(),
      deciders: z.array(z.string()).describe('Who made the decision').optional(),
      title: z.string().min(1).optional(),
      context: z.string().optional(),
      decision_text: z.string().describe('The "Decision" section').optional(),
      consequences: z.string().optional(),
      ...adrPartInputs,
      qualityGoals: z.array(IdSchema).optional(),
      constraints: z.array(IdSchema).optional(),
      requirements: z.array(IdSchema).optional(),
      supersedes: z.string().describe('Number of the decision this one replaces; "" for none').optional(),
    }),
    readOnly: false,
    confirm: (i) => `Update decision ${i.decision}?`,
    run(session, input) {
      const file = resolveDecision(session, input.decision);
      const adr = splitAdr(session.read(file)!);
      if (input.status) adr.front.set('status', input.status);
      if (input.date !== undefined) {
        if (input.date.trim()) adr.front.set('date', input.date.trim());
        else adr.front.delete('date');
      }
      setFrontList(adr.front, 'deciders', input.deciders?.map((d) => d.trim()).filter(Boolean), false);
      setFrontList(adr.front, 'qualityGoals', input.qualityGoals, true);
      setFrontList(adr.front, 'constraints', input.constraints, true);
      setFrontList(adr.front, 'requirements', input.requirements, false);
      let superseded: string | undefined;
      if (input.supersedes !== undefined && !input.supersedes.trim()) adr.front.delete('supersedes');
      else if (input.supersedes) {
        superseded = resolveDecision(session, input.supersedes);
        if (superseded === file) throw new OpError('A decision cannot supersede itself.');
        adr.front.set('supersedes', /(\d{4})-/.exec(superseded)![1]!);
      }
      let body = adr.body;
      if (input.title) body = setAdrTitle(body, input.title);
      const parts: [AdrPart, string | undefined][] = [
        ['context', input.context],
        ['drivers', input.drivers],
        ['options', input.options],
        ['decision', input.decision_text],
        ['consequences', input.consequences],
        ['confirmation', input.confirmation],
      ];
      for (const [key, text] of parts) if (text !== undefined) body = setAdrPart(body, key, text);
      session.write(file, joinAdr(adr.front, body));
      if (superseded) markSuperseded(session, superseded);
      return { file: session.display(file), ...(superseded ? { superseded: session.display(superseded) } : {}) };
    },
  }),
];

/** Not session-based: creates the docs/architecture folder. Each front-end implements it with `scaffold()`. */
export const INITIALIZE_TOOL = {
  name: 'initialize',
  title: 'Initialize architecture documentation',
  description:
    'Create the architecture documentation skeleton (docs/architecture: archery.yaml, model.yaml, 12 section files, data lists, starter diagrams) when none exists yet, or another documentation in its own folder. Existing files are never overwritten.',
  input: z.object({
    system: z.string().min(1).describe('Name of the system being documented'),
    includeHelp: z.boolean().default(true).describe('Embed the arc42 help texts as hidden comments in the section files'),
    folder: z.string().optional().describe('Folder for the documentation, relative to the project (default docs/architecture). Required when the project already has one, e.g. "services/billing/docs/architecture".'),
  }),
};

export const ALL_TOOL_NAMES = [INITIALIZE_TOOL.name, ...TOOLS.map((t) => t.name)];

export const SERVER_INSTRUCTIONS = `Tools for architecture documentation (docs-as-code, https://arc42.org).
- Start with overview. Before writing a chapter, call get_section_guide for it; read and change chapters with get_section, edit_section and write_section (the open document then shows each change live), add text under a heading with insert_text, and place diagrams and tables in them with insert_into_section.
- Change model.yaml, diagrams/*.json and data/*.yaml only through these tools: they keep ids stable, update references across files and validate the result.
- Model elements are defined once and referenced by id from diagrams; renaming an element (update_element) renames it everywhere.
- Section 6 runtime scenarios: write_sequence_diagram (or an activity diagram). Sections 5/7: create_diagram with type component/deployment; place elements with add_element(diagram, x, y) or add_to_diagram, nest with parent, then auto_layout.
- State machines and activity diagrams are diagram-local: create_diagram(type state|activity), add_local_node, add_local_edge (transition/flow), then auto_layout.
- Class diagrams: classes with attributes/operations/typeParams via add_element/update_element; associations with multiplicity, roles, qualifier, navigable and associationClass via add_relationship/update_relationship.
- Many elements, relationships or local nodes / edges at once: batch (one call, all or nothing).
- Container and parts on one diagram: create_diagram / add_to_diagram leave out a container's relationship when a part has it (relationships: "all" to keep them).
- Check a layout without an image: get_diagram returns every node's drawn box; validate reports overlapping shapes and labels with coordinates.
- Table column widths: fit_table_columns balances them (measured as exported, on screen and in print), get_table_layout shows how a table wraps; write_data_table without rows changes only the layout, fit: "auto" keeps them fitted at every export.
- Requirements (chapter 1.1) are the requirements data list: link them to the building blocks that satisfy them (satisfiedBy) and the quality goals they refine (goals); import_reqif / export_reqif exchange them with requirements tools as ReqIF.
- Variables: {title} {system} {version} {date} {chapter} and the documentation's own (export settings "variables", e.g. {docNumber}) are filled in by the PDF / HTML export in the text, headings, tables, captions, header and footer; inside code they stay as written.
- Call validate after a series of changes and fix reported problems.
- A project can hold several documentations (one folder with archery.yaml each): overview lists them, and every tool takes doc (the folder or the system name) to work on one other than the one open in VS Code.`;

export type { DataListName };
export { DATA_LISTS };
