import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bridgeFile } from '../src/live/bridgeProtocol';
import { createArcheryMcpServer } from '../src/mcp/server';
import { ALL_TOOL_NAMES } from '../src/ops/tools';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

async function connect() {
  const cwd = mkdtempSync(join(tmpdir(), 'archery-mcp-'));
  dirs.push(cwd);
  const server = createArcheryMcpServer({ cwd });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0]!.text;
    return { isError: !!result.isError, text, json: result.isError ? undefined : JSON.parse(text) };
  };
  return { cwd, client, call };
}

describe('MCP server', () => {
  it('lists every tool with an input schema and instructions', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    for (const t of tools) expect(t.inputSchema.type).toBe('object');
    expect(client.getInstructions()).toContain('get_section_guide');
  });

  it('asks to initialize when there is no documentation, then works on disk', async () => {
    const { cwd, call } = await connect();
    const before = await call('overview');
    expect(before.isError).toBe(true);
    expect(before.text).toContain('initialize');
    // Reading creates nothing (M-7).
    expect(readdirSync(cwd)).toEqual([]);

    const init = await call('initialize', { system: 'Webshop' });
    expect(init.json.root).toBe('docs/architecture');

    const added = await call('add_element', { name: 'Order Service', kind: 'component' });
    expect(added.json.id).toBe('orderService');
    expect(readFileSync(join(cwd, 'docs', 'architecture', 'model.yaml'), 'utf8')).toContain('name: Order Service');

    const overview = await call('overview');
    expect(overview.json.root).toBe('docs/architecture');
    expect(overview.json.model.elements).toEqual({ component: 1 });
  });

  it('returns tool errors (not protocol errors) for bad input', async () => {
    const { call } = await connect();
    await call('initialize', { system: 'Webshop' });
    const unknown = await call('update_element', { id: 'ghost', name: 'Boo' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('Unknown element "ghost"');
  });

  it('deletes a file the window said it deleted but left on disk (N-6)', async () => {
    const { cwd, call } = await connect();
    await call('initialize', { system: 'Webshop' });
    await call('create_diagram', { title: 'Tmp', name: 'tmp-del', type: 'component' });
    const root = join(cwd, 'docs', 'architecture');
    const file = join(root, 'diagrams', 'tmp-del.uml.json');
    expect(existsSync(file)).toBe(true);
    // A window that answers "applied" and changes nothing.
    const window = createServer((req, res) => {
      req.resume();
      req.on('end', () => res.end(JSON.stringify({ ok: true })));
    });
    await new Promise<void>((r) => window.listen(0, '127.0.0.1', r));
    const announce = bridgeFile(root);
    mkdirSync(dirname(announce), { recursive: true });
    writeFileSync(announce, JSON.stringify({ port: (window.address() as { port: number }).port, token: 't', pid: process.pid }));
    try {
      const deleted = await call('delete_diagram', { diagram: 'tmp-del' });
      expect(deleted.isError).toBe(false);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(announce, { force: true });
      window.close();
    }
  });
});
