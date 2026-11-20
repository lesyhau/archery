// Shows what AI agents (Copilot's tools, Claude Code through the MCP bridge) change, while they change it:
//  - a chapter: the document scrolls to the chapter (the part being edited), then the edit lands and is
//    highlighted;
//  - a diagram: the document scrolls to the chapter that shows it, the diagram opens in its editor tab,
//    then the edit lands and the changed shapes are selected;
//  - only the model (add / rename / change an element or relationship): the diagram that shows it does
//    the same - the one in view, else the one followed last, else any open one, else the first one;
//  - a data table: the document scrolls to the table, then it changes.
// Files that change on disk without going through Archery (an agent editing a chapter's Markdown file
// directly) are followed afterwards.
//
// Hybrid follow (src/live/userActivity.ts): following pauses while the user works in Archery's views
// and resumes 30 seconds after their last action; the changes still land meanwhile. Setting:
// archery.followAgent turns following off altogether.
import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import { outlineOf } from '../doc/outline';
import { DocumentPanel } from '../document/documentPanel';
import { WebviewDiagramEditorProvider } from '../editors/webviewEditor';
import { applyRecorded } from '../editors/history';
import { parseProject } from '../model/load';
import { createReader, readText } from '../workspace';
import { isOwnWrite } from '../workspaceEdit';
import { followPaused } from './userActivity';
import { DELETED } from '../ops/session';

const PAUSE_MS = 550;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enabled = () => vscode.workspace.getConfiguration('archery').get<boolean>('followAgent', true);
/** Whether to bring the agent's changes into view now. */
const following = () => enabled() && !followPaused();
const uriOf = (root: vscode.Uri, path: string) => vscode.Uri.joinPath(root, ...path.split('/'));
const DIAGRAM_FILE = /^diagrams\/.+\.json$/;

let queue: Promise<unknown> = Promise.resolve();
/** The diagram shown last for an agent's change (path relative to the root). */
let lastDiagram: string | undefined;

/** Applies an agent's changes (one undoable step), showing them live. */
export function applyLive(root: vscode.Uri, changes: Map<string, string>): Promise<void> {
  const run = queue.then(() => (following() ? showAndApply(root, changes) : applyRecorded(root, changes)));
  queue = run.catch(() => undefined);
  return run;
}

/** The first line that differs between two texts. */
function firstChangedLine(before: string, after: string): number {
  const a = before.split('\n');
  const b = after.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** The chapter that shows a diagram or a data table (by its directive). */
async function placement(root: vscode.Uri, src: string): Promise<string | undefined> {
  const project = parseProject((await readText(uriOf(root, 'archery.yaml'))) ?? '').value;
  for (const s of project?.sections ?? []) {
    if (!s.enabled) continue;
    const text = (await readText(uriOf(root, s.file))) ?? '';
    for (const m of text.matchAll(/<!--\s*archery:(?:diagram|table)\s+(\S+)/g)) {
      if (m[1] === src || m[1]!.split('#')[0] === src) return s.id;
    }
  }
  return undefined;
}

async function sectionOf(root: vscode.Uri, file: string): Promise<string | undefined> {
  const project = parseProject((await readText(uriOf(root, 'archery.yaml'))) ?? '').value;
  return project?.sections.find((s) => s.file === file)?.id;
}

const parse = (t: string | undefined, json: boolean): Record<string, unknown> => {
  try {
    return (t ? (json ? JSON.parse(t) : parseYaml(t)) : {}) ?? {};
  } catch {
    return {};
  }
};

/** Element, relationship and diagram-local ids whose definition differs. */
function changedIds(before: string | undefined, after: string | undefined, json: boolean): string[] {
  const a = parse(before, json);
  const b = parse(after, json);
  const index = (o: Record<string, unknown>) => {
    const m = new Map<string, string>();
    const add = (list: unknown, key: string) => {
      if (Array.isArray(list)) for (const x of list) if (x && typeof x === 'object' && typeof (x as Record<string, unknown>)[key] === 'string') m.set((x as Record<string, string>)[key]!, JSON.stringify(x));
    };
    if (json) {
      add(o.nodes, 'ref');
      add(o.edges, 'ref');
      add(o.lifelines, 'ref');
      const local = (o.local ?? {}) as Record<string, unknown>;
      add(local.nodes, 'id');
      add(local.edges, 'id');
    } else {
      add(o.elements, 'id');
      add(o.relationships, 'id');
    }
    return m;
  };
  const ia = index(a);
  const ib = index(b);
  return [...ib].filter(([id, v]) => ia.get(id) !== v).map(([id]) => id);
}

/** The model ids a diagram file shows (canvas nodes and edges, sequence / timing lifelines). */
function shownIds(text: string | undefined): Set<string> {
  const d = parse(text, true);
  const ids = new Set<string>();
  for (const key of ['nodes', 'edges', 'lifelines']) {
    const list = d[key];
    if (Array.isArray(list)) for (const x of list) if (x && typeof (x as { ref?: unknown }).ref === 'string') ids.add((x as { ref: string }).ref);
  }
  return ids;
}

const editorOf = (root: vscode.Uri, path: string) => WebviewDiagramEditorProvider.open.get(uriOf(root, path).toString());

/** Of several diagrams, the best one to show: the one in view, the one shown last, an open one, the first one. */
function preferred(root: vscode.Uri, paths: string[]): string | undefined {
  return (
    paths.find((p) => editorOf(root, p)?.panel.visible) ??
    paths.find((p) => p === lastDiagram) ??
    paths.find((p) => editorOf(root, p)) ??
    paths[0]
  );
}

/** The diagram to show for a change of the model only: one that shows the changed elements or relationships. */
async function diagramShowing(root: vscode.Uri, ids: string[]): Promise<string | undefined> {
  if (!ids.length) return undefined;
  const candidates: string[] = [];
  for (const name of (await createReader(root).list('diagrams')).sort()) {
    const path = `diagrams/${name}`;
    if (!DIAGRAM_FILE.test(path)) continue;
    const shown = shownIds(await readText(uriOf(root, path)));
    if (ids.some((id) => shown.has(id))) candidates.push(path);
  }
  return preferred(root, candidates);
}

/** Where a newly opened diagram goes: next to the document (its tab group), else where diagrams are. */
function columnForNewDiagram(): vscode.ViewColumn {
  const document = DocumentPanel.viewColumn();
  if (document) return document;
  for (const e of WebviewDiagramEditorProvider.open.values()) if (e.panel.viewColumn) return e.panel.viewColumn;
  return vscode.ViewColumn.One;
}

/** Opens a diagram (or brings its tab to the front, where it is) without taking the focus. */
async function openDiagram(root: vscode.Uri, path: string): Promise<void> {
  const uri = uriOf(root, path);
  const open = WebviewDiagramEditorProvider.open.get(uri.toString());
  await WebviewDiagramEditorProvider.openPanel(uri, { viewColumn: open ? undefined : columnForNewDiagram(), preserveFocus: true });
  for (let i = 0; i < 40 && !WebviewDiagramEditorProvider.open.get(uri.toString())?.ready; i++) await wait(100);
  if (!open) await wait(250);
}

/** Shows a diagram (its chapter first when it is not in view), applies the changes and selects what changed. */
async function showDiagramChange(root: vscode.Uri, path: string, changes: Map<string, string>, before: Map<string, string | undefined>): Promise<void> {
  lastDiagram = path;
  const exists = (await readText(uriOf(root, path))) !== undefined;
  if (!editorOf(root, path)?.panel.visible) {
    const chapter = await placement(root, path);
    if (chapter) {
      await DocumentPanel.follow(root, { sectionId: chapter, src: path });
      await wait(PAUSE_MS);
    }
    if (exists) await openDiagram(root, path);
  }
  await applyRecorded(root, changes);
  if (!exists) await openDiagram(root, path);
  const refs = [
    ...(changes.has(path) ? changedIds(before.get(path), changes.get(path), true) : []),
    ...(changes.has('model.yaml') ? changedIds(before.get('model.yaml'), changes.get('model.yaml'), false) : []),
  ];
  if (refs.length) editorOf(root, path)?.highlight(refs);
}

async function showAndApply(root: vscode.Uri, changes: Map<string, string>): Promise<void> {
  const before = new Map<string, string | undefined>();
  for (const path of changes.keys()) before.set(path, await readText(uriOf(root, path)));
  const paths = [...changes.keys()].filter((p) => before.get(p) !== changes.get(p) && !(changes.get(p) === DELETED && before.get(p) === undefined));
  // A deleted diagram is not shown.
  const diagram = preferred(root, paths.filter((p) => DIAGRAM_FILE.test(p) && changes.get(p) !== DELETED));
  const section = paths.find((p) => /^sections\/.+\.md$/.test(p));
  const data = paths.find((p) => /^data\/.+\.yaml$/.test(p));
  const decision = paths.find((p) => /^decisions\/.+\.md$/.test(p));

  if (diagram) return showDiagramChange(root, diagram, changes, before);

  if (section || decision) {
    const sectionId = section ? await sectionOf(root, section) : 'architecture-decisions';
    if (sectionId) {
      // The heading above the first changed line.
      const line = section ? firstChangedLine(before.get(section) ?? '', changes.get(section)!) : 0;
      const headings = section ? outlineOf(changes.get(section)!) : [];
      let index: number | undefined;
      headings.forEach((h, i) => h.line <= line && (index = i));
      await DocumentPanel.follow(root, { sectionId, index, edit: !!section });
      await wait(PAUSE_MS);
    }
    await applyRecorded(root, changes);
    if (section) known.set(uriOf(root, section).toString(), changes.get(section)!);
    return;
  }

  if (data) {
    const chapter = await placement(root, data);
    if (chapter) {
      await DocumentPanel.follow(root, { sectionId: chapter, src: data });
      await wait(PAUSE_MS);
    }
    await applyRecorded(root, changes);
    return;
  }

  // Only the model: the diagram that shows the changed elements / relationships.
  if (paths.includes('model.yaml')) {
    const shown = await diagramShowing(root, changedIds(before.get('model.yaml'), changes.get('model.yaml'), false));
    if (shown) return showDiagramChange(root, shown, changes, before);
  }
  await applyRecorded(root, changes);
}

/** Last known text of each chapter file, to find what changed in it. */
const known = new Map<string, string>();

/** Remembers the chapters' text (call when the documentation folder is opened). */
export async function primeChapters(root: vscode.Uri): Promise<void> {
  const project = parseProject((await readText(uriOf(root, 'archery.yaml'))) ?? '').value;
  for (const s of project?.sections ?? []) {
    const uri = uriOf(root, s.file);
    const text = await readText(uri);
    if (text !== undefined) known.set(uri.toString(), text);
  }
}

/** A file changed on disk without Archery (e.g. an agent edited a chapter's Markdown file): show where. */
export async function followExternal(root: vscode.Uri, uri: vscode.Uri): Promise<void> {
  const base = root.path.endsWith('/') ? root.path : `${root.path}/`;
  if (!uri.path.startsWith(base)) return;
  const path = uri.path.slice(base.length);
  const chapter = /^sections\/.+\.md$/.test(path);
  const previous = known.get(uri.toString());
  const text = chapter ? await readText(uri) : undefined;
  if (chapter && text !== undefined) known.set(uri.toString(), text);
  if (!following() || isOwnWrite(uri) || !DocumentPanel.isOpen()) return;
  if (chapter) {
    if (text === undefined || text === previous) return;
    const sectionId = await sectionOf(root, path);
    if (!sectionId) return;
    const line = firstChangedLine(previous ?? '', text);
    let index: number | undefined;
    outlineOf(text).forEach((h, i) => h.line <= line && (index = i));
    await DocumentPanel.follow(root, { sectionId, index, edit: true });
  } else if (/^(diagrams\/.+\.json|data\/.+\.yaml)$/.test(path)) {
    const where = await placement(root, path);
    if (where) await DocumentPanel.follow(root, { sectionId: where, src: path });
  }
}
