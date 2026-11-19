// Load + validate an documentation workspace. Pure TS: file access is injected so this
// runs in the extension host, in tests, and (for single files) in the webview.
import { LineCounter, parseDocument } from 'yaml';
import type { z } from 'zod';
import {
  CanvasDiagramSchema,
  DataFileSchemas,
  ModelSchema,
  ProjectSchema,
  SequenceDiagramSchema,
  TimingDiagramSchema,
  type CanvasDiagram,
  type DataFileName,
  type Model,
  type Project,
  type SequenceDiagram,
  type TimingDiagram,
} from './schema';

export interface Issue {
  /** Path relative to the documentation root. */
  file: string;
  message: string;
  /** 1-based; undefined when the position is unknown. */
  line?: number;
  col?: number;
  severity: 'error' | 'warning';
}

export interface Parsed<T> {
  value?: T;
  issues: Issue[];
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '');
}

export function parseYaml<S extends z.ZodType>(file: string, text: string, schema: S): Parsed<z.infer<S>> {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const issues: Issue[] = [];
  for (const err of doc.errors) {
    const pos = lineCounter.linePos(err.pos[0]);
    issues.push({ file, message: err.message, line: pos?.line, col: pos?.col, severity: 'error' });
  }
  if (issues.length > 0) return { issues };

  const result = schema.safeParse(doc.toJS() ?? {});
  if (result.success) return { value: result.data, issues };

  for (const issue of result.error.issues) {
    // Point at the deepest node that exists for this path.
    let line: number | undefined;
    let col: number | undefined;
    for (let n = issue.path.length; n >= 0; n--) {
      const node = doc.getIn(issue.path.slice(0, n) as unknown[], true) as { range?: [number, number, number] } | undefined;
      if (node?.range) {
        const pos = lineCounter.linePos(node.range[0]);
        line = pos.line;
        col = pos.col;
        break;
      }
    }
    const where = issue.path.length > 0 ? `${formatPath(issue.path)}: ` : '';
    issues.push({ file, message: `${where}${issue.message}`, line, col, severity: 'error' });
  }
  return { issues };
}

export function parseJson<S extends z.ZodType>(file: string, text: string, schema: S): Parsed<z.infer<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const m = /line (\d+) column (\d+)/.exec(message);
    return {
      issues: [{ file, message, line: m ? Number(m[1]) : undefined, col: m ? Number(m[2]) : undefined, severity: 'error' }],
    };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { value: result.data, issues: [] };
  return {
    issues: result.error.issues.map((issue) => ({
      file,
      message: `${issue.path.length > 0 ? `${formatPath(issue.path)}: ` : ''}${issue.message}`,
      severity: 'error' as const,
    })),
  };
}

export const parseProject = (text: string, file = 'archery.yaml') => parseYaml(file, text, ProjectSchema);
export const parseModel = (text: string, file = 'model.yaml') => parseYaml(file, text, ModelSchema);
export const parseCanvasDiagram = (text: string, file = 'diagram.uml.json') => parseJson(file, text, CanvasDiagramSchema);
export const parseSequenceDiagram = (text: string, file = 'diagram.seq.json') => parseJson(file, text, SequenceDiagramSchema);
export const parseTimingDiagram = (text: string, file = 'diagram.timing.json') => parseJson(file, text, TimingDiagramSchema);

/** Diagram files: *.uml.json (canvas), *.seq.json (sequence / communication), *.timing.json (timing). */
export const isDiagramFile = (name: string) => /\.(uml|seq|timing)\.json$/.test(name);

// ---------------------------------------------------------------------------

export interface WorkspaceReader {
  /** Returns undefined if the file does not exist. Paths are relative to the documentation root. */
  readText(path: string): Promise<string | undefined>;
  /** File names (not paths) directly inside `dir`; empty if the directory does not exist. */
  list(dir: string): Promise<string[]>;
}

export interface LoadedWorkspace {
  project?: Project;
  model: Model;
  /** Section files listed in archery.yaml that do not exist. */
  missingSections: string[];
  diagrams: { file: string; type: CanvasDiagram['type'] | SequenceDiagram['type'] | TimingDiagram['type'] | 'communication' | undefined; title?: string }[];
  dataFiles: string[];
  decisions: string[];
  issues: Issue[];
}

export async function loadWorkspace(reader: WorkspaceReader): Promise<LoadedWorkspace> {
  const issues: Issue[] = [];

  const projectText = await reader.readText('archery.yaml');
  let project: Project | undefined;
  if (projectText === undefined) {
    issues.push({ file: 'archery.yaml', message: 'archery.yaml not found', severity: 'error' });
  } else {
    const parsed = parseProject(projectText);
    project = parsed.value;
    issues.push(...parsed.issues);
  }

  let model: Model = { elements: [], relationships: [] };
  const modelText = await reader.readText('model.yaml');
  if (modelText !== undefined) {
    const parsed = parseModel(modelText);
    if (parsed.value) model = parsed.value;
    issues.push(...parsed.issues);
  }

  const missingSections: string[] = [];
  if (project) {
    for (const section of project.sections) {
      if ((await reader.readText(section.file)) === undefined) {
        missingSections.push(section.file);
        issues.push({ file: 'archery.yaml', message: `Section file not found: ${section.file}`, severity: 'warning' });
      }
    }
  }

  const diagrams: LoadedWorkspace['diagrams'] = [];
  for (const name of (await reader.list('diagrams')).sort()) {
    const file = `diagrams/${name}`;
    if (!isDiagramFile(name)) continue;
    const text = (await reader.readText(file)) ?? '';
    const parsed = name.endsWith('.uml.json') ? parseCanvasDiagram(text, file) : name.endsWith('.timing.json') ? parseTimingDiagram(text, file) : parseSequenceDiagram(text, file);
    issues.push(...parsed.issues);
    const value = parsed.value;
    const type = value && 'notation' in value && value.notation === 'communication' ? 'communication' : value?.type;
    diagrams.push({ file, type, title: value?.title || undefined });
  }

  const dataFiles: string[] = [];
  for (const name of (await reader.list('data')).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = `data/${name}`;
    dataFiles.push(file);
    const schema = DataFileSchemas[name as DataFileName];
    if (schema) {
      const parsed = parseYaml(file, (await reader.readText(file)) ?? '', schema);
      issues.push(...parsed.issues);
    }
  }

  const decisions = (await reader.list('decisions'))
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .sort()
    .map((name) => `decisions/${name}`);

  return { project, model, missingSections, diagrams, dataFiles, decisions, issues };
}
