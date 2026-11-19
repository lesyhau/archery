// Shows what AI agents (Copilot's tools, Claude Code through the MCP bridge) change, while they change it:
//  - a chapter: the document scrolls to the chapter (the part being edited), then the edit lands and is
//    highlighted;
//  - a diagram: the document scrolls to the chapter that shows it, the diagram opens in its editor tab,
//    then the edit lands and the changed shapes are selected;
//  - a data table: the document scrolls to the table, then it changes;
//  - only the model: an open diagram that shows the changed elements highlights them.
// Files that change on disk without going through Archery (an agent editing a chapter's Markdown file
// directly) are followed afterwards. Setting: archery.followAgent.
import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import { outlineOf } from '../doc/outline';
import { DocumentPanel } from '../document/documentPanel';
import { WebviewDiagramEditorProvider } from '../editors/webviewEditor';
import { applyRecorded } from '../editors/history';
import { parseProject } from '../model/load';
import { readText } from '../workspace';
import { isOwnWrite } from '../workspaceEdit';

const PAUSE_MS = 550;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enabled = () => vscode.workspace.getConfiguration('archery').get<boolean>('followAgent', true);
const uriOf = (root: vscode.Uri, path: string) => vscode.Uri.joinPath(root, ...path.split('/'));

let queue: Promise<unknown> = Promise.resolve();

/** Applies an agent's changes (one undoable step), showing them live. */
export function applyLive(root: vscode.Uri, changes: Map<string, string>): Promise<void> {
  const run = queue.then(() => (enabled() ? showAndApply(root, changes) : applyRecorded(root, changes)));
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

/** Element, relationship and diagram-local ids whose definition differs. */
function changedIds(before: string | undefined, after: string | undefined, json: boolean): string[] {
  const parse = (t: string | undefined): Record<string, unknown> => {
    try {
      return (t ? (json ? JSON.parse(t) : parseYaml(t)) : {}) ?? {};
    } catch {
      return {};
    }
  };
  const a = parse(before);
  const b = parse(after);
  const index = (o: Record<string, unknown>) => {
    const m = new Map<string, string>();
    const add = (list: unknown, key: string) => {
      if (Array.isArray(list)) for (const x of list) if (x && typeof x === 'object' && typeof (x as Record<string, unknown>)[key] === 'string') m.set((x as Record<string, string>)[key]!, JSON.stringify(x));
    };
    if (json) {
      add(o.nodes, 'ref');
      add(o.edges, 'ref');
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

async function openDiagram(uri: vscode.Uri): Promise<void> {
  await WebviewDiagramEditorProvider.openPanel(uri, { viewColumn: vscode.ViewColumn.Active, preserveFocus: true });
  for (let i = 0; i < 40 && !WebviewDiagramEditorProvider.open.get(uri.toString())?.ready; i++) await wait(100);
  await wait(250);
}

async function showAndApply(root: vscode.Uri, changes: Map<string, string>): Promise<void> {
  const before = new Map<string, string | undefined>();
  for (const path of changes.keys()) before.set(path, await readText(uriOf(root, path)));
  const paths = [...changes.keys()].filter((p) => before.get(p) !== changes.get(p));
  const diagram = paths.find((p) => /^diagrams\/.+\.json$/.test(p));
  const section = paths.find((p) => /^sections\/.+\.md$/.test(p));
  const data = paths.find((p) => /^data\/.+\.yaml$/.test(p));
  const decision = paths.find((p) => /^decisions\/.+\.md$/.test(p));

  if (diagram) {
    const uri = uriOf(root, diagram);
    const exists = before.get(diagram) !== undefined;
    const editor = WebviewDiagramEditorProvider.open.get(uri.toString());
    if (!editor?.panel.active) {
      // The chapter that shows it first, then its editor.
      const chapter = await placement(root, diagram);
      if (chapter) {
        await DocumentPanel.follow(root, { sectionId: chapter, src: diagram });
        await wait(PAUSE_MS);
      }
      if (exists) await openDiagram(uri);
    }
    await applyRecorded(root, changes);
    if (!exists) await openDiagram(uri);
    const refs = [...changedIds(before.get(diagram), changes.get(diagram), true), ...(changes.has('model.yaml') ? changedIds(before.get('model.yaml'), changes.get('model.yaml'), false) : [])];
    if (refs.length) WebviewDiagramEditorProvider.open.get(uri.toString())?.highlight(refs);
    return;
  }

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

  await applyRecorded(root, changes);
  if (changes.has('model.yaml')) {
    const ids = changedIds(before.get('model.yaml'), changes.get('model.yaml'), false);
    for (const editor of WebviewDiagramEditorProvider.open.values()) if (editor.panel.active && ids.length) editor.highlight(ids);
  }
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
  if (!enabled() || isOwnWrite(uri) || !DocumentPanel.isOpen()) return;
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
