import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
