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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { scaffold } from '../template/scaffold';
import type { WorkspaceReader } from '../model/load';
import { ArcherySession, OpError } from '../ops/session';
import { INITIALIZE_TOOL, SERVER_INSTRUCTIONS, TOOLS } from '../ops/tools';
import { connectBridge } from './bridgeClient';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.vscode-test']);

/** Finds the folder containing archery.yaml: `docs/architecture` first, then a shallow search. */
export function findRoot(cwd: string): string | undefined {
  for (const candidate of [join(cwd, 'docs', 'architecture'), cwd]) {
    if (existsSync(join(candidate, 'archery.yaml'))) return candidate;
  }
  const queue: { dir: string; depth: number }[] = [{ dir: cwd, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    if (entries.includes('archery.yaml')) return dir;
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
  return undefined;
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
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
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

  const locateRoot = () => (options.root ? resolve(options.cwd, options.root) : findRoot(options.cwd));

  server.registerTool(
    INITIALIZE_TOOL.name,
    {
      title: INITIALIZE_TOOL.title,
      description: INITIALIZE_TOOL.description,
      inputSchema: INITIALIZE_TOOL.input.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const existing = locateRoot();
      if (existing && existsSync(join(existing, 'archery.yaml'))) {
        return fail(`architecture documentation already exists in ${toPosix(relative(options.cwd, existing)) || '.'}.`);
      }
      const root = existing ?? join(options.cwd, 'docs', 'architecture');
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
        inputSchema: def.input.shape,
        annotations: { readOnlyHint: def.readOnly, destructiveHint: def.name.startsWith('delete') || def.name.startsWith('remove') },
      },
      async (args: unknown) => {
        const root = locateRoot();
        if (!root || !existsSync(join(root, 'archery.yaml'))) {
          return fail(`No architecture documentation found below ${options.cwd}. Call ${INITIALIZE_TOOL.name} to create docs/architecture.`);
        }
        try {
          const session = await ArcherySession.load(fsReader(root), toPosix(relative(options.cwd, root)));
          // With the documentation open in VS Code, the window shows the change live and applies it.
          const bridge = connectBridge(root);
          session.host = bridge?.host;
          const input = def.input.parse(args ?? {});
          const result = await def.run(session, input);
          if (session.changes.size && !(bridge && (await bridge.apply(session.changes)))) writeFiles(root, session.changes);
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
