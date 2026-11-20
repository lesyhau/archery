// Fixes for the findings of a real documentation session (batch, line shapes, display options,
// diagram files, decisions, layout warnings, ...).
import { describe, expect, it } from 'vitest';
import { scaffold } from '../src/template/scaffold';
import { fileSlug } from '../src/ops/ids';
import { documentTitle } from '../src/doc/title';
import { ArcherySession, DELETED } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import { edgeLayouts, edgePoints, layoutCanvas, layoutNodes, noteSize, type Shape } from '../src/render/canvasLayout';
import { parseCanvasDiagram } from '../src/model/load';
import type { WorkspaceReader } from '../src/model/load';

function memoryReader(files: Map<string, string>): WorkspaceReader {
  return {
    readText: async (path) => files.get(path),
    list: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
  };
}

async function workspace() {
  const files = scaffold({ system: 'Webshop', includeHelp: false });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const def = TOOLS.find((t) => t.name === name)!;
    const session = await ArcherySession.load(memoryReader(files), 'docs/architecture');
    const result = await def.run(session, def.input.parse(args));
    for (const [path, text] of session.changes) text === DELETED ? files.delete(path) : files.set(path, text);
    return result;
  };
  return { files, call };
}

const texts = (scene: { prims: { t: string; text?: string }[] }) => scene.prims.filter((p) => p.t === 'text').map((p) => p.text!);
const shape = (x: number, y: number, w = 100, h = 50): Shape => ({ box: { x, y, w, h }, outline: 'rect' });

describe('batch (M-6)', () => {
  it('runs operations in order, later ones seeing earlier ones', async () => {
    const { call } = await workspace();
    const r = await call('batch', {
      operations: [
        { tool: 'add_element', input: { name: 'Orders', kind: 'component' } },
        { tool: 'add_element', input: { name: 'Billing', kind: 'component' } },
        { tool: 'add_relationship', input: { kind: 'usage', from: 'orders', to: 'billing' } },
        { tool: 'add_to_diagram', input: { diagram: 'building-blocks-l1', elements: ['orders', 'billing'] } },
      ],
    });
    expect(r.done).toBe(4);
    const d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    expect(d.edges.map((e: any) => e.ref)).toEqual(['orders-billing']);
  });

  it('changes nothing when one operation fails', async () => {
    const { files, call } = await workspace();
    const before = new Map(files);
    await expect(
      call('batch', { operations: [{ tool: 'add_element', input: { name: 'Orders', kind: 'component' } }, { tool: 'add_relationship', input: { kind: 'usage', from: 'orders', to: 'nobody' } }] }),
    ).rejects.toThrow(/Operation 2 \(add_relationship\) failed: Unknown element "nobody".*Nothing was changed/);
    expect(files).toEqual(before);
    await expect(call('batch', { operations: [{ tool: 'export_document', input: {} }] })).rejects.toThrow(/cannot be batched/);
  });
});

describe('container and parts on one diagram (M-4)', () => {
  it('leaves out the container relationship a part refines', async () => {
    const { call } = await workspace();
    await call('add_element', { id: 'sys', name: 'Demo', kind: 'component' });
    await call('add_element', { id: 'a', name: 'Part A', kind: 'component', parent: 'sys' });
    await call('add_element', { id: 'b', name: 'Part B', kind: 'component', parent: 'sys' });
    await call('add_element', { id: 'ext', name: 'External', kind: 'externalSystem' });
    await call('add_relationship', { kind: 'usage', from: 'sys', to: 'ext', label: 'uses' });
    await call('add_relationship', { kind: 'usage', from: 'a', to: 'ext', label: 'calls' });
    const created = await call('create_diagram', { title: 'L1', type: 'component', elements: ['sys', 'a', 'b', 'ext'] });
    expect(created.edges).toBe(1);
    expect((await call('get_diagram', { diagram: 'l1' })).edges.map((e: any) => e.ref)).toEqual(['a-ext']);
    await call('create_diagram', { title: 'All', type: 'component', elements: ['sys', 'a', 'ext'], relationships: 'all' });
    expect((await call('get_diagram', { diagram: 'all' })).edges).toHaveLength(2);
    // Without the part, the container's relationship is drawn.
    await call('create_diagram', { title: 'Context', type: 'component', elements: ['sys', 'ext'] });
    expect((await call('get_diagram', { diagram: 'context' })).edges.map((e: any) => e.ref)).toEqual(['sys-ext']);
  });
});

describe('display options and text (M-1, M-2, M-3, H-2, L-7)', () => {
  it('hides tags unless the diagram shows them, and «use» on demand', async () => {
    const { files, call } = await workspace();
    await call('add_element', { id: 'a', name: 'Part A', kind: 'component', technology: 'Fastify', tags: { location: 'packages/a/src/server.ts' }, diagram: 'building-blocks-l1' });
    await call('add_element', { id: 'ext', name: 'External', kind: 'externalSystem', diagram: 'building-blocks-l1', x: 400, y: 40 });
    await call('add_relationship', { kind: 'usage', from: 'a', to: 'ext', label: 'calls' });
    const render = async () => {
      const session = await ArcherySession.load(memoryReader(files), '');
      return texts(layoutCanvas(session.canvasDiagram('diagrams/building-blocks-l1.uml.json'), session.model()));
    };
    let t = await render();
    expect(t).toContain('{technology=Fastify}');
    expect(t.join(' ')).not.toContain('location=');
    expect(t).toContain('«external»'); // not «actor»
    expect(t).toContain('«use» calls');
    await call('update_diagram', { diagram: 'building-blocks-l1', show: { tags: true, keywords: false } });
    t = await render();
    expect(t.join(' ')).toContain('location=packages/a/src/server.ts');
    expect(t).toContain('calls');
    expect(t).not.toContain('«use» calls');
  });

  it('keeps a given width: long property strings wrap, the drawn box is reported', async () => {
    const { call } = await workspace();
    await call('add_element', { id: 'a', name: 'Webview', kind: 'component', technology: 'TypeScript, React 18, Vite, Tiptap, React Flow', diagram: 'building-blocks-l1' });
    const moved = await call('move_nodes', { diagram: 'building-blocks-l1', nodes: [{ id: 'a', x: 600, y: 230, w: 200, h: 90 }] });
    expect(moved.boxes.a).toMatchObject({ x: 600, y: 230, w: 200 });
    expect(moved.boxes.a.h).toBeGreaterThanOrEqual(90);
    const d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    expect(d.nodes.find((n: any) => n.ref === 'a')).toMatchObject({ w: 200 });
  });

  it('wraps note text and makes the note tall enough', () => {
    const text = 'Imported by the extension, the webview (step info, protocol types), the service, the CLI and the MCP server';
    const [w, h] = noteSize(text, 200, 40);
    expect(w).toBe(200);
    expect(h).toBeGreaterThan(60);
    const d = parseCanvasDiagram(JSON.stringify({ version: 1, type: 'component', local: { nodes: [{ id: 'n', kind: 'note', text, x: 0, y: 0, w: 200, h: 40 }], edges: [] } })).value!;
    const lines = texts(layoutCanvas(d, { elements: [], relationships: [] }));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(text);
  });
});

describe('line shapes (modern lines need not be right-angled)', () => {
  it('draws straight, right-angled, curved and one-corner lines', () => {
    const a = shape(0, 0);
    const b = shape(300, 200);
    expect(edgePoints(a, b, [], 'modern', { line: 'straight' })).toHaveLength(2);
    expect(edgePoints(a, b, [], 'modern')).toEqual([[100, 25], [200, 25], [200, 225], [300, 225]]);
    expect(edgePoints(a, b, [], 'classic', { line: 'orthogonal' })).toEqual([[100, 25], [200, 25], [200, 225], [300, 225]]);
    expect(edgePoints(a, b, [], 'modern', { line: 'horizontalFirst' })).toEqual([[100, 25], [350, 25], [350, 200]]);
    expect(edgePoints(a, b, [], 'modern', { line: 'verticalFirst' })).toEqual([[50, 50], [50, 225], [300, 225]]);
    const curve = edgePoints(a, b, [], 'modern', { line: 'curved' });
    expect(curve.length).toBeGreaterThan(10);
    expect(curve[0]).toEqual([100, 25]);
    expect(curve.at(-1)).toEqual([300, 225]);
    // Through bend points.
    const through = edgePoints(a, b, [{ x: 150, y: 150 }], 'classic', { line: 'curved' });
    expect(through.some(([x, y]) => Math.hypot(x - 150, y - 150) < 1)).toBe(true);
  });

  it('is set per line or for all lines with set_line_shape', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Orders', kind: 'component', diagram: 'building-blocks-l1' });
    await call('add_element', { name: 'Billing', kind: 'component', diagram: 'building-blocks-l1', x: 400, y: 300 });
    await call('add_relationship', { kind: 'usage', from: 'orders', to: 'billing' });
    await call('set_line_shape', { diagram: 'building-blocks-l1', ids: ['orders-billing'], line: 'curved' });
    expect((await call('get_diagram', { diagram: 'building-blocks-l1' })).edges[0].style).toEqual({ line: 'curved' });
    await call('set_line_shape', { diagram: 'building-blocks-l1', line: 'auto' });
    expect((await call('get_diagram', { diagram: 'building-blocks-l1' })).edges[0].style).toBeUndefined();
    await expect(call('set_line_shape', { diagram: 'building-blocks-l1', ids: ['nope'], line: 'straight' })).rejects.toThrow(/No edge "nope"/);
  });

  it('spreads lines between the same two shapes apart and keeps labels off each other (M-5)', () => {
    const model = {
      elements: [
        { id: 'find', kind: 'component' as const, name: 'Find' },
        { id: 'keep', kind: 'component' as const, name: 'Keep' },
      ],
      relationships: [
        { id: 'r1', kind: 'usage' as const, from: 'find', to: 'keep', label: 'keep it' },
        { id: 'r2', kind: 'usage' as const, from: 'keep', to: 'find', label: 'find it' },
      ],
    };
    for (const style of ['classic', 'modern'] as const) {
      const d = parseCanvasDiagram(JSON.stringify({ version: 1, type: 'component', nodes: [{ ref: 'find', x: 0, y: 0 }, { ref: 'keep', x: 400, y: 0 }], edges: [{ ref: 'r1' }, { ref: 'r2' }] })).value!;
      const nodes = layoutNodes(d, model);
      const draws = edgeLayouts(d, model, nodes, style);
      const s = (id: string) => ({ box: nodes.get(id)!.box, outline: nodes.get(id)!.outline });
      const p1 = edgePoints(s('find'), s('keep'), [], style, draws.get('m:r1'));
      const p2 = edgePoints(s('keep'), s('find'), [], style, draws.get('m:r2'));
      const mid = (p: [number, number][]) => p[Math.floor(p.length / 2)]![1];
      expect(Math.abs(mid(p1) - mid(p2)), style).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('diagram files, project, decisions (M-7, L-1, L-2, L-3)', () => {
  it('renames and deletes diagrams, following and removing references', async () => {
    const { files, call } = await workspace();
    const chapter = [...files.keys()].find((f) => f.startsWith('sections/07'))!;
    if (!files.get(chapter)!.includes('deployment-l1')) files.set(chapter, `${files.get(chapter)}\n<!-- archery:diagram diagrams/deployment-l1.uml.json -->\n`);
    const renamed = await call('rename_diagram', { diagram: 'deployment-l1', name: 'Deployment bench' });
    expect(renamed.file).toBe('docs/architecture/diagrams/deployment-bench.uml.json');
    expect(files.has('diagrams/deployment-l1.uml.json')).toBe(false);
    expect(files.get(chapter)).toContain('diagrams/deployment-bench.uml.json');
    await expect(call('delete_diagram', { diagram: 'deployment-bench' })).rejects.toThrow(/still used by: chapter 7/);
    await call('delete_diagram', { diagram: 'deployment-bench', force: true });
    expect(files.has('diagrams/deployment-bench.uml.json')).toBe(false);
    expect(files.get(chapter)).not.toContain('deployment-bench');
    expect((await call('validate')).ok).toBe(true);
  });

  it('titles the document with the system name unless it has its own title', async () => {
    expect(documentTitle('ECU Bench', undefined)).toBe('ECU Bench');
    expect(documentTitle('ECU Bench', 'ECU Bench - Architecture Documentation')).toBe('ECU Bench'); // the old generated title
    expect(documentTitle('ECU Bench', 'ECU Bench Platform')).toBe('ECU Bench Platform');
    const { files } = await workspace();
    expect(files.get('archery.yaml')).not.toMatch(/^title:/m);
  });

  it('sets the system name and title', async () => {
    const { call } = await workspace();
    const r = await call('set_project', { system: 'ECU Bench', title: 'ECU Bench - Architecture', authors: ['Team'] });
    expect(r).toEqual({ system: 'ECU Bench', title: 'ECU Bench - Architecture', authors: ['Team'] });
    expect((await call('overview')).system).toBe('ECU Bench');
  });

  it('names decision files at a word boundary and updates decisions', async () => {
    expect(fileSlug('D-03 Rewrite the bus engine in C++20 x86 with tick-based timing')).toBe('d-03-rewrite-the-bus-engine-in-cpp20-x86-with-tick-based');
    expect(fileSlug('D-27 One run timeline across an engine restart, bridged with the host clock')).not.toMatch(/-$/);
    const { files, call } = await workspace();
    const first = await call('create_decision', { title: 'Use REST', context: 'Old', decision: 'REST' });
    const second = await call('create_decision', { title: 'Use gRPC', status: 'proposed' });
    await call('update_decision', { decision: second.number, status: 'accepted', context: 'Faster', decision_text: 'gRPC everywhere', supersedes: '1' });
    const text = files.get(second.file.replace('docs/architecture/', ''))!;
    expect(text).toMatch(/status: accepted/);
    expect(text).toMatch(/supersedes: "?0001"?/);
    expect(text).toMatch(/## Context\n\nFaster\n/);
    expect(text).toMatch(/## Decision\n\ngRPC everywhere\n/);
    expect(files.get(first.file.replace('docs/architecture/', ''))).toMatch(/status: superseded/);
  });

  it('puts a note inside an element shown on the diagram', async () => {
    const { call } = await workspace();
    await call('add_element', { id: 'sys', name: 'Demo', kind: 'component', diagram: 'building-blocks-l1', x: 0, y: 0 });
    const note = await call('add_local_node', { diagram: 'building-blocks-l1', kind: 'note', text: 'Inside', parent: 'sys', x: 20, y: 60 });
    const d = await call('get_diagram', { diagram: 'building-blocks-l1' });
    const sys = d.nodes.find((n: any) => n.ref === 'sys');
    const n = d.local.nodes.find((x: any) => x.id === note.id);
    expect(n.parent).toBe('sys');
    expect(n.y + n.h).toBeLessThanOrEqual(sys.y + sys.h);
  });
});

describe('validate reports layout problems with coordinates (L-6)', () => {
  it('finds overlapping shapes', async () => {
    const { call } = await workspace();
    await call('add_element', { name: 'Orders', kind: 'component', diagram: 'building-blocks-l1', x: 0, y: 0 });
    await call('add_element', { name: 'Billing', kind: 'component', diagram: 'building-blocks-l1', x: 50, y: 20 });
    const v = await call('validate');
    expect(v.ok).toBe(true); // warnings only
    expect(v.problems.map((p: any) => p.message)).toEqual(expect.arrayContaining([expect.stringMatching(/^orders \(0, 0, \d+x\d+\) and billing \(50, 20, \d+x\d+\) overlap\.$/)]));
    await call('auto_layout', { diagram: 'building-blocks-l1' });
    expect((await call('validate')).problems.filter((p: any) => /overlap/.test(p.message))).toEqual([]);
  });
});
