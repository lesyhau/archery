// Loads everything the document shows (sections, diagrams, data tables, decisions, change history)
// from an documentation root. Used by the document panel and by the HTML / PDF export.
import { diagramName } from '../model/usage';
import { documentTitle } from '../doc/title';
import * as vscode from 'vscode';
import { parse as parseYamlText } from 'yaml';
import { findSection } from '../template/template';
import { LISTS } from '../doc/dataLists';
import { adrTitle, readAdrParts, splitAdrText } from '../doc/adr';
import type { DocDecision, DocDiagram, DocumentData } from '../doc/protocol';
import { buildTables } from '../doc/tables';
import { parseCanvasDiagram, parseModel, parseProject, parseSequenceDiagram, parseTimingDiagram } from '../model/load';
import { changeHistory } from '../versions/history';
import type { VersionTracker } from '../versions/tracker';
import { createReader, readText } from '../workspace';

/** The document without the webview-only parts. */
export type DocumentContent = Omit<DocumentData, 'canvasSettings' | 'sectionsBaseUri' | 'generator' | 'exportCredit'>;

export async function loadDocumentContent(root: vscode.Uri, tracker?: VersionTracker): Promise<DocumentContent> {
  const read = (path: string) => readText(vscode.Uri.joinPath(root, ...path.split('/')));
  const list = (dir: string) => createReader(root).list(dir);

  const project = parseProject((await read('archery.yaml')) ?? '').value;
  const model = parseModel((await read('model.yaml')) ?? '').value ?? { elements: [], relationships: [] };

  const sections: DocumentData['sections'] = [];
  for (const s of project?.sections ?? []) {
    if (!s.enabled) continue;
    const def = findSection(s.id);
    sections.push({
      id: s.id,
      number: def?.number,
      title: s.title ?? def?.title ?? s.id,
      file: s.file,
      markdown: (await read(s.file)) ?? `# ${s.title ?? def?.title ?? s.id}\n`,
      enabled: s.enabled,
    });
  }

  const diagrams: Record<string, DocDiagram> = {};
  const diagramFiles: DocumentData['diagramFiles'] = [];
  for (const name of (await list('diagrams')).sort()) {
    const file = `diagrams/${name}`;
    const text = (await read(file)) ?? '';
    if (name.endsWith('.uml.json')) {
      const parsed = parseCanvasDiagram(text, file);
      diagrams[file] = parsed.value
        ? { kind: 'canvas', title: parsed.value.title, diagram: parsed.value, text }
        : { kind: 'missing', message: parsed.issues[0]?.message ?? 'invalid diagram' };
      if (parsed.value) diagramFiles.push({ file, title: parsed.value.title || diagramName(file), type: parsed.value.type });
    } else if (name.endsWith('.seq.json')) {
      const parsed = parseSequenceDiagram(text, file);
      diagrams[file] = parsed.value
        ? { kind: 'sequence', title: parsed.value.title, diagram: parsed.value, text }
        : { kind: 'missing', message: parsed.issues[0]?.message ?? 'invalid diagram' };
      if (parsed.value) diagramFiles.push({ file, title: parsed.value.title || diagramName(file), type: parsed.value.notation === 'communication' ? 'communication' : 'sequence' });
    } else if (name.endsWith('.timing.json')) {
      const parsed = parseTimingDiagram(text, file);
      diagrams[file] = parsed.value
        ? { kind: 'timing', title: parsed.value.title, diagram: parsed.value, text }
        : { kind: 'missing', message: parsed.issues[0]?.message ?? 'invalid diagram' };
      if (parsed.value) diagramFiles.push({ file, title: parsed.value.title || diagramName(file), type: 'timing' });
    }
  }

  const data = new Map<string, unknown>();
  for (const file of new Set(LISTS.map((l) => l.file))) {
    const text = await read(file);
    if (text === undefined) continue;
    try {
      data.set(file, parseYamlText(text) ?? {});
    } catch {
      data.set(file, {});
    }
  }

  const decisions: DocDecision[] = [];
  for (const name of (await list('decisions')).filter((n) => /^\d{4}-.+\.md$/.test(n)).sort()) {
    const file = `decisions/${name}`;
    const { front, body } = splitAdrText((await read(file)) ?? '');
    let meta: Record<string, unknown> = {};
    try {
      meta = (front ? parseYamlText(front) : {}) ?? {};
    } catch {
      meta = {};
    }
    const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()) : []);
    const date = meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : meta.date != null ? String(meta.date) : undefined;
    decisions.push({
      file,
      number: name.slice(0, 4),
      title: adrTitle(body) ?? name.slice(5, -3).replace(/-/g, ' '),
      status: typeof meta.status === 'string' ? meta.status : undefined,
      date,
      deciders: strings(meta.deciders ?? meta['decision-makers']),
      supersedes: meta.supersedes != null && String(meta.supersedes).trim() ? String(meta.supersedes).trim().padStart(4, '0') : undefined,
      qualityGoals: strings(meta.qualityGoals),
      constraints: strings(meta.constraints),
      requirements: strings(meta.requirements),
      parts: readAdrParts(body),
    });
  }

  const history = tracker ? await tracker.history() : undefined;
  return {
    system: project?.system ?? 'Untitled system',
    title: documentTitle(project?.system ?? 'Untitled system', project?.title),
    version: history?.current ?? '0.0',
    canRelease: tracker ? await tracker.canRelease() : false,
    changeHistory: history ? changeHistory(history) : [],
    sections,
    diagrams,
    diagramFiles,
    model,
    tables: buildTables(data),
    decisions,
    exportSettings: project?.export ?? {},
  };
}
