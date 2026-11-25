// An in-memory snapshot of an documentation workspace that operations read and modify.
// Front-ends (MCP server, VS Code language model tools, later the webview) load a
// session, run one operation, and then persist `session.changes` their own way:
// the MCP server writes to disk, VS Code applies one undoable WorkspaceEdit.
import { isMap, isSeq, parseDocument, type Document } from 'yaml';
import { parseCanvasDiagram, parseSequenceDiagram, parseTimingDiagram, type WorkspaceReader } from '../model/load';
import { ModelSchema, type CanvasDiagram, type Model, type SequenceDiagram, type TimingDiagram } from '../model/schema';

/** Appends to a YAML sequence, switching `key: []` (flow style) to a block list. */
export function appendItem(doc: Document, path: (string | number)[], value: unknown): void {
  doc.addIn(path, doc.createNode(value));
  const seq = doc.getIn(path, true);
  if (isSeq(seq)) seq.flow = false;
}

/**
 * The content of a change that deletes its file. Front-ends delete such a file instead of writing it
 * (src/workspaceEdit.ts, src/mcp/server.ts).
 */
export const DELETED = '\u0000archery:deleted\u0000';

/** An error whose message is meant for the agent/user (bad input, unknown id, ...). */
export class OpError extends Error {}

/**
 * What only the VS Code extension can do (versions, PDF/PNG export). Copilot's tools get it in
 * process; the MCP server gets it through the bridge to an open VS Code window (src/live/bridge.ts).
 * Paths are relative to the workspace folder (VS Code) / the project directory (MCP).
 */
export interface ToolHost {
  versions(): Promise<{ current: string; releases: { version: string; kind: string; date: string; note?: string }[] }>;
  release(note: string): Promise<string>;
  restore(version: string): Promise<string>;
  exportDocument(format: 'html' | 'pdf', file?: string, settings?: Record<string, unknown>): Promise<string>;
  exportDiagram(diagram: string, format: 'svg' | 'png', theme: 'light' | 'dark', file?: string): Promise<string>;
  /** Browsers for measuring tables, with VS Code's archery.export.browserPath first. */
  browsers?(): Promise<string[]>;
}

/**
 * Files outside the documentation (ReqIF import and export). Paths are relative to the workspace
 * folder (VS Code) / the project directory (MCP), or absolute.
 */
export interface DiskAccess {
  read(path: string): Promise<Uint8Array>;
  /** Writes a file; without a path, as `name` next to the documentation folder. Returns the path written, as shown to the user. */
  write(path: string | undefined, name: string, data: Uint8Array): Promise<string>;
}

export class ArcherySession {
  /** Path -> new content of every file created or modified by operations. */
  readonly changes = new Map<string, string>();
  /** Set by front-ends that run inside (or next to) VS Code. */
  host?: ToolHost;
  /** Set by front-ends that can read and write files outside the documentation. */
  disk?: DiskAccess;

  private constructor(
    private readonly texts: Map<string, string>,
    /** How to display the documentation root to the agent, e.g. `docs/architecture`. */
    readonly rootLabel: string,
  ) {}

  static async load(reader: WorkspaceReader, rootLabel: string): Promise<ArcherySession> {
    const texts = new Map<string, string>();
    const add = async (path: string) => {
      const text = await reader.readText(path);
      if (text !== undefined) texts.set(path, text);
    };
    await add('archery.yaml');
    await add('model.yaml');
    for (const dir of ['diagrams', 'data', 'decisions', 'sections']) {
      for (const name of await reader.list(dir)) await add(`${dir}/${name}`);
    }
    return new ArcherySession(texts, rootLabel);
  }

  /** Display path for the agent, relative to the workspace/cwd. */
  display(path: string): string {
    return this.rootLabel ? `${this.rootLabel}/${path}` : path;
  }

  has(path: string): boolean {
    return this.read(path) !== undefined;
  }

  read(path: string): string | undefined {
    const changed = this.changes.get(path);
    if (changed === DELETED) return undefined;
    return changed ?? this.texts.get(path);
  }

  write(path: string, text: string): void {
    if (this.texts.get(path) === text) this.changes.delete(path);
    else this.changes.set(path, text);
  }

  /** Deletes a file. */
  remove(path: string): void {
    if (this.texts.has(path)) this.changes.set(path, DELETED);
    else this.changes.delete(path);
  }

  files(dir: string): string[] {
    const prefix = `${dir}/`;
    const all = new Set([...this.texts.keys(), ...this.changes.keys()]);
    return [...all].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/') && this.has(p)).sort();
  }

  // --- model.yaml ------------------------------------------------------------

  /** The model as a yaml Document, so edits keep comments and formatting. */
  modelDocument(): Document {
    const text = this.read('model.yaml');
    if (text === undefined) throw new OpError('model.yaml not found. Initialize the architecture documentation first.');
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw new OpError(`model.yaml has syntax errors: ${doc.errors[0]!.message}`);
    if (!isMap(doc.contents) && doc.contents !== null) {
      throw new OpError('model.yaml must be a mapping with `elements` and `relationships`.');
    }
    for (const key of ['elements', 'relationships']) {
      const seq = doc.get(key);
      if (seq === undefined || seq === null) doc.set(key, doc.createNode([]));
    }
    if (!isMap(doc.contents)) throw new OpError('model.yaml must be a mapping with `elements` and `relationships`.');
    return doc;
  }

  model(): Model {
    const text = this.read('model.yaml');
    if (text === undefined) return { elements: [], relationships: [] };
    const result = ModelSchema.safeParse(parseDocument(text).toJS() ?? {});
    if (!result.success) {
      throw new OpError(`model.yaml is invalid (${result.error.issues[0]?.message}). Run validate for details.`);
    }
    return result.data;
  }

  writeDocument(path: string, doc: Document): void {
    this.write(path, doc.toString({ lineWidth: 0 }));
  }

  // --- diagrams --------------------------------------------------------------

  /** Accepts `building-blocks-l1`, `building-blocks-l1.uml.json` or `diagrams/building-blocks-l1.uml.json`. */
  resolveDiagram(name: string): string {
    const base = name.replace(/\\/g, '/').replace(/^.*diagrams\//, '');
    const candidates = [base, `${base}.uml.json`, `${base}.seq.json`, `${base}.timing.json`].map((n) => `diagrams/${n}`);
    const found = candidates.find((p) => this.has(p));
    if (!found) {
      const known = this.files('diagrams').map((p) => p.slice('diagrams/'.length));
      throw new OpError(`Diagram "${name}" not found. Existing diagrams: ${known.join(', ') || '(none)'}`);
    }
    return found;
  }

  canvasDiagram(path: string): CanvasDiagram {
    const parsed = parseCanvasDiagram(this.read(path) ?? '', path);
    if (!parsed.value) throw new OpError(`${path} is not a valid canvas diagram: ${parsed.issues[0]?.message}`);
    return parsed.value;
  }

  sequenceDiagram(path: string): SequenceDiagram {
    const parsed = parseSequenceDiagram(this.read(path) ?? '', path);
    if (!parsed.value) throw new OpError(`${path} is not a valid sequence diagram: ${parsed.issues[0]?.message}`);
    return parsed.value;
  }

  timingDiagram(path: string): TimingDiagram {
    const parsed = parseTimingDiagram(this.read(path) ?? '', path);
    if (!parsed.value) throw new OpError(`${path} is not a valid timing diagram: ${parsed.issues[0]?.message}`);
    return parsed.value;
  }

  writeJson(path: string, value: unknown): void {
    this.write(path, JSON.stringify(value, null, 2) + '\n');
  }
}
