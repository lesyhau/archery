// MCP server for Archery (stdio). Used by Claude Code and any other MCP client.
// Runs as a standalone Node process: reads the workspace files; changes go to the VS Code window that
// has the documentation open (shown live there, undoable), else straight to the files.
//
//   node dist/mcp.js [--root <path to folder containing archery.yaml>]
//
// Without --root (or ARCHERY_ROOT) it looks for archery.yaml below the current directory,
// which is the project directory when launched by Claude Code.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { scaffold } from '../template/scaffold';
import type { WorkspaceReader } from '../model/load';
import { ArcherySession, DELETED, OpError, type DiskAccess } from '../ops/session';
import { INITIALIZE_TOOL, SERVER_INSTRUCTIONS, TOOLS } from '../ops/tools';
import { DOC_PARAM, docsListing, pickDoc, type DocRef } from '../ops/docs';
import { parseProject } from '../model/load';
import { readBridge } from '../live/bridgeProtocol';
import { connectBridge } from './bridgeClient';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.vscode-test']);

/** Files outside the documentation: paths relative to the project directory, or absolute. */
export function fsDisk(cwd: string, root: string): DiskAccess {
  const at = (path: string) => (isAbsolute(path) ? path : resolve(cwd, path));
  return {
    async read(path) {
      try {
        return new Uint8Array(readFileSync(at(path)));
      } catch {
        throw new OpError(`Cannot read ${path}.`);
      }
    },
    async write(path, name, data) {
      const target = path ? at(path) : join(dirname(root), name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      const shown = relative(cwd, target);
      return toPosix(shown.startsWith('..') ? target : shown);
    },
  };
}

/** Finds the folder containing archery.yaml: `docs/architecture` first, then a shallow search. */
export function findRoot(cwd: string): string | undefined {
  return findRoots(cwd)[0];
}

/** Every folder containing archery.yaml below cwd: `docs/architecture` first, then the shallowest. */
export function findRoots(cwd: string): string[] {
  const found: string[] = [];
  const preferred = join(cwd, 'docs', 'architecture');
  if (existsSync(join(preferred, 'archery.yaml'))) found.push(preferred);
  const queue: { dir: string; depth: number }[] = [{ dir: cwd, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    // A documentation's own folders (diagrams, sections, ...) hold no other documentation.
    if (entries.includes('archery.yaml')) {
      if (dir !== preferred) found.push(dir);
      continue;
    }
    if (depth >= 4) continue;
    for (const name of entries.sort()) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory()) queue.push({ dir: path, depth: depth + 1 });
      } catch {
        // unreadable entry
      }
    }
  }
  return found;
}

/** The documentations below cwd with their system names. */
function docsIn(cwd: string): (DocRef & { root: string })[] {
  return findRoots(cwd).map((root) => {
    let system: string | undefined;
    try {
      system = parseProject(readFileSync(join(root, 'archery.yaml'), 'utf8')).value?.system;
    } catch {
      // unreadable archery.yaml
    }
    return { root, path: toPosix(relative(cwd, root)), system };
  });
}

export function fsReader(root: string): WorkspaceReader {
  return {
    async readText(path) {
      try {
        return readFileSync(join(root, path), 'utf8');
      } catch {
        return undefined;
      }
    },
    async list(dir) {
      try {
        return readdirSync(join(root, dir), { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name);
      } catch {
        return [];
      }
    },
  };
}

function writeFiles(root: string, changes: Map<string, string>): void {
  for (const [path, text] of changes) {
    const target = join(root, path);
    if (text === DELETED) {
      rmSync(target, { force: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

/**
 * Deletes what the window was asked to delete but left on disk: a window may answer "applied" and
 * still keep the file (an older extension even wrote the delete marker into it). Throws when a file
 * cannot be deleted, so the agent is never told a file is gone while it is there.
 */
function ensureDeleted(root: string, changes: Map<string, string>): void {
  for (const [path, text] of changes) {
    if (text !== DELETED) continue;
    const target = join(root, path);
    if (existsSync(target)) rmSync(target, { force: true });
    if (existsSync(target)) throw new OpError(`Could not delete ${toPosix(path)}; it is still on disk.`);
  }
}

const toPosix = (p: string) => p.split(sep).join('/');

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export interface ServerOptions {
  cwd: string;
  /** Explicit documentation root; otherwise searched below cwd on every call. */
  root?: string;
}

export function createArcheryMcpServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: 'archery', version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  /**
   * The documentation a call works on: the one `doc` names, else --root, else the only one, else the
   * one a VS Code window shows, else the first (docs/architecture).
   */
  const locate = (doc: string | undefined): { root?: string; error?: string; docs: (DocRef & { root: string })[] } => {
    const docs = docsIn(options.cwd);
    if (doc) {
      const picked = pickDoc(docs, doc);
      return typeof picked === 'string' ? { error: picked, docs } : { root: picked.root, docs };
    }
    if (options.root) return { root: resolve(options.cwd, options.root), docs };
    const shown = docs.length > 1 ? docs.find((d) => readBridge(d.root)?.active) : undefined;
    return { root: (shown ?? docs[0])?.root, docs };
  };

  server.registerTool(
    INITIALIZE_TOOL.name,
    {
      title: INITIALIZE_TOOL.title,
      description: INITIALIZE_TOOL.description,
      inputSchema: INITIALIZE_TOOL.input.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const { docs } = locate(undefined);
      if (!args.folder && docs.length) {
        return fail(`architecture documentation already exists in ${docs.map((d) => d.path || '.').join(', ')}. To add another one, pass folder.`);
      }
      const root = args.folder ? resolve(options.cwd, args.folder) : options.root ? resolve(options.cwd, options.root) : join(options.cwd, 'docs', 'architecture');
      if (relative(options.cwd, root).startsWith('..')) return fail('folder must be inside the project.');
      if (existsSync(join(root, 'archery.yaml'))) return fail(`architecture documentation already exists in ${toPosix(relative(options.cwd, root)) || '.'}.`);
      const files = scaffold({ system: args.system, includeHelp: args.includeHelp ?? true });
      const created: string[] = [];
      for (const [path, text] of files) {
        if (existsSync(join(root, path))) continue;
        writeFiles(root, new Map([[path, text]]));
        created.push(path);
      }
      return ok({ root: toPosix(relative(options.cwd, root)), created });
    },
  );

  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: { ...def.input.shape, doc: DOC_PARAM },
        annotations: { readOnlyHint: def.readOnly, destructiveHint: def.name.startsWith('delete') || def.name.startsWith('remove') },
      },
      async (args: unknown) => {
        const doc = (args as { doc?: unknown } | undefined)?.doc;
        const { root, error, docs } = locate(typeof doc === 'string' && doc.trim() ? doc : undefined);
        if (error) return fail(error);
        if (!root || !existsSync(join(root, 'archery.yaml'))) {
          return fail(`No architecture documentation found below ${options.cwd}. Call ${INITIALIZE_TOOL.name} to create docs/architecture.`);
        }
        try {
          const session = await ArcherySession.load(fsReader(root), toPosix(relative(options.cwd, root)));
          // With the documentation open in VS Code, the window shows the change live and applies it.
          const bridge = connectBridge(root);
          session.host = bridge?.host;
          session.disk = fsDisk(options.cwd, root);
          const input = def.input.parse(args ?? {});
          const result = await def.run(session, input);
          if (session.changes.size && !(bridge && (await bridge.apply(session.changes)))) writeFiles(root, session.changes);
          ensureDeleted(root, session.changes);
          const current = docs.find((d) => resolve(d.root) === resolve(root));
          if (def.name === 'overview' && docs.length > 1 && current && result && typeof result === 'object') return ok({ ...result, ...docsListing(docs, current) });
          return ok(result);
        } catch (e) {
          if (e instanceof OpError) return fail(e.message);
          if (e instanceof Error && e.name === 'ZodError') return fail(`Invalid arguments: ${e.message}`);
          throw e;
        }
      },
    );
  }

  return server;
}

function parseArgs(argv: string[]): { root?: string } {
  const i = argv.indexOf('--root');
  return { root: i >= 0 ? argv[i + 1] : process.env.ARCHERY_ROOT || undefined };
}

// Only start when run as a script (not when imported by tests).
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const { root } = parseArgs(process.argv.slice(2));
  const server = createArcheryMcpServer({ cwd: process.cwd(), root });
  server.connect(new StdioServerTransport()).catch((e: unknown) => {
    console.error('Archery MCP server failed to start:', e);
    process.exit(1);
  });
}
