// Tools for what users do in the document (chapters, placing diagrams / tables, decisions, arranging
// shapes), the tools that need VS Code, the MCP bridge, and the PDF contents' page numbers.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pdfString, tocPages } from '../src/export/pdfOutline';
import { bridgeFile } from '../src/live/bridgeProtocol';
import type { WorkspaceReader } from '../src/model/load';
import { createArcheryMcpServer } from '../src/mcp/server';
import { ArcherySession } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import { scaffold } from '../src/template/scaffold';

const memoryReader = (files: Map<string, string>): WorkspaceReader => ({
  readText: async (path) => files.get(path),
  list: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
});

function workspace() {
  const files = scaffold({ system: 'Webshop', includeHelp: false });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const def = TOOLS.find((t) => t.name === name)!;
    const session = await ArcherySession.load(memoryReader(files), '');
    const result = await def.run(session, def.input.parse(args));
    for (const [path, text] of session.changes) files.set(path, text);
    return result;
  };
  return { files, call };
}

describe('chapter tools', () => {
  it('reads, edits and rewrites a chapter by number, id or title', async () => {
    const { files, call } = workspace();
    const s = await call('get_section', { section: '4' });
    expect(s.id).toBe('solution-strategy');
    expect(s.markdown).toMatch(/^# /);
    await call('edit_section', { section: 'Solution Strategy', find: s.markdown.split('\n')[0], replace: `${s.markdown.split('\n')[0]}\n\nWe build a modular monolith.` });
    expect(files.get(s.file)).toContain('We build a modular monolith.');
    await expect(call('edit_section', { section: 'solution-strategy', find: 'not there', replace: 'x' })).rejects.toThrow(/not found/);
    await call('write_section', { section: '4', markdown: '# Solution Strategy\n\nShort.' });
    expect(files.get(s.file)).toBe('# Solution Strategy\n\nShort.\n');
    await expect(call('get_section', { section: '42' })).rejects.toThrow(/Unknown chapter/);
  });

  it('places a diagram and a data table under a heading, with captions', async () => {
    const { files, call } = workspace();
    await call('write_section', { section: '5', markdown: '# Building Block View\n\n## Level 1\n\nText one.\n\n## Level 2\n\nText two.\n' });
    await call('insert_into_section', { section: '5', kind: 'diagram', src: 'building-blocks-l1', caption: 'Overview', after_heading: 'Level 1' });
    await call('insert_into_section', { section: '5', kind: 'table', src: 'quality-scenarios' });
    const md = (await call('get_section', { section: '5' })).markdown as string;
    expect(md).toContain('## Level 1\n\nText one.\n\n<!-- archery:diagram diagrams/building-blocks-l1.uml.json caption="Overview" -->\n\n## Level 2');
    expect(md.trimEnd().endsWith('<!-- archery:table data/quality-requirements.yaml#scenarios -->')).toBe(true);
    void files;
  });

  it('records an architecture decision', async () => {
    const { files, call } = workspace();
    const r = await call('create_decision', { title: 'Use PostgreSQL for orders', status: 'accepted', decision: 'PostgreSQL 16.' });
    const text = files.get(r.file)!;
    expect(r.file).toMatch(/^decisions\/\d{4}-use-postgresql-for-orders\.md$/);
    expect(text).toContain('status: accepted');
    expect(text).toContain('## Decision\n\nPostgreSQL 16.');
  });
});

describe('align_nodes', () => {
  it('aligns left edges and distributes with equal gaps', async () => {
    const { call } = workspace();
    for (const [name, x, y] of [['A', 10, 0], ['B', 200, 50], ['C', 600, 120]] as const) await call('add_element', { name, kind: 'component', diagram: 'building-blocks-l1', x, y });
    await call('align_nodes', { diagram: 'building-blocks-l1', ids: ['a', 'b', 'c'], mode: 'top' });
    let d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    expect(new Set(d.nodes.map((n: any) => n.y)).size).toBe(1);
    await call('align_nodes', { diagram: 'building-blocks-l1', ids: ['a', 'b', 'c'], mode: 'distributeH' });
    d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    const xs = d.nodes.map((n: any) => n.x).sort((p: number, q: number) => p - q);
    expect(xs[1] - xs[0]).toBe(xs[2] - xs[1]);
    await expect(call('align_nodes', { diagram: 'building-blocks-l1', ids: ['a', 'b'], mode: 'distributeV' })).rejects.toThrow(/3 or more/);
  });
});

describe('tools that need VS Code', () => {
  it('say so without a host', async () => {
    const { call } = workspace();
    await expect(call('list_versions')).rejects.toThrow(/VS Code/);
    await expect(call('export_document', { format: 'pdf' })).rejects.toThrow(/VS Code/);
  });
});

describe('MCP bridge', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('hands changes and host calls to the VS Code window that has the documentation open', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'archery-bridge-'));
    dirs.push(cwd);
    const root = join(cwd, 'docs', 'architecture');
    for (const [path, text] of scaffold({ system: 'Webshop', includeHelp: false })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    // A fake window: records what it gets, writes applied changes itself.
    const got: any[] = [];
    const token = 'secret';
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const msg = JSON.parse(Buffer.concat(chunks).toString());
        got.push({ token: req.headers['x-archery-token'], ...msg });
        if (msg.kind === 'apply') for (const [p, t] of msg.changes) writeFileSync(join(root, p), `${t}# via window\n`);
        res.end(JSON.stringify(msg.kind === 'apply' ? { ok: true } : { ok: true, result: { current: '1.0', releases: [] } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const file = bridgeFile(root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ port: (server.address() as { port: number }).port, token, pid: process.pid }));
    try {
      const mcp = createArcheryMcpServer({ cwd });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await mcp.connect(b);
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(a);
      const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]!.text);
      await call('add_element', { name: 'Order Service', kind: 'component' });
      expect(got[0]).toMatchObject({ token, kind: 'apply' });
      expect(readFileSync(join(root, 'model.yaml'), 'utf8')).toContain('# via window');
      expect(await call('list_versions')).toEqual({ current: '1.0', releases: [] });
      expect(got[1]).toMatchObject({ kind: 'host', method: 'versions' });
    } finally {
      server.close();
      rmSync(file, { force: true });
    }
  });
});

describe('PDF contents page numbers', () => {
  it('decodes PDF strings', () => {
    expect(pdfString('(1.2 Quality \\(Goals\\))')).toBe('1.2 Quality (Goals)');
    expect(pdfString('<FEFF00C40062>')).toBe('Äb');
    expect(pdfString('(caf\\351)')).toBe('café');
  });

  it('gives each entry the next bookmark that ends with its title', () => {
    const entries = [
      { id: 'a', number: '1', title: 'Introduction' },
      { id: 'b', number: '1.1', title: 'Goals' },
      { id: 'c', number: '2', title: 'Constraints' },
    ];
    const outline = [
      { title: 'Webshop', page: 1 },
      { title: '1 Introduction', page: 3 },
      { title: '1.1 Goals', page: 4 },
      { title: '2 Constraints', page: 6 },
    ];
    expect(tocPages(entries, outline)).toEqual({ a: 3, b: 4, c: 6 });
  });
});
