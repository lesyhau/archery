// Drill-down: an element detailed on another diagram is marked on the others and links to it.
import { describe, expect, it } from 'vitest';
import { renderDocumentHtml, type ExportContent } from '../src/export/documentHtml';
import { checkReferences } from '../src/model/checks';
import type { CanvasDiagram, Model } from '../src/model/schema';
import { layoutCanvas } from '../src/render/canvasLayout';
import { sceneToSvg } from '../src/render/svgExport';
import { scaffold } from '../src/template/scaffold';
import { ArcherySession, DELETED } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import type { WorkspaceReader } from '../src/model/load';

const memoryReader = (files: Map<string, string>): WorkspaceReader => ({
  readText: async (path) => files.get(path),
  list: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
});

const model: Model = {
  elements: [
    { id: 'shop', kind: 'component', name: 'Shop' },
    { id: 'orders', kind: 'component', name: 'Orders', detail: 'diagrams/orders.uml.json' },
    { id: 'repo', kind: 'component', name: 'Repository', parent: 'orders' },
  ],
  relationships: [],
};
const overview: CanvasDiagram = { version: 1, type: 'component', title: 'Overview', nodes: [{ ref: 'shop', x: 0, y: 0 }, { ref: 'orders', x: 300, y: 0 }], edges: [], local: { nodes: [], edges: [] } };
const inside: CanvasDiagram = { version: 1, type: 'component', title: 'Orders inside', nodes: [{ ref: 'orders', x: 0, y: 0 }, { ref: 'repo', x: 20, y: 60 }], edges: [], local: { nodes: [], edges: [] } };
const links = (d: CanvasDiagram, self?: string) => layoutCanvas(d, model, 'classic', self).prims.flatMap((p) => (p.t === 'rect' && p.link ? [p.link] : []));

describe('drill-down links', () => {
  it('marks an element detailed elsewhere, but not on its own detail diagram', () => {
    expect(links(overview, 'diagrams/overview.uml.json')).toEqual(['diagrams/orders.uml.json']);
    expect(links(inside, 'diagrams/orders.uml.json')).toEqual([]);
  });

  it('the marker stays inside its box once the scene is normalized', () => {
    const scene = layoutCanvas(overview, model);
    const hit = scene.prims.find((p) => p.t === 'rect' && p.link) as { x: number; y: number; w: number; h: number };
    const box = scene.prims.find((p) => p.t === 'rect' && !p.link && p.x < hit.x && p.x + p.w > hit.x + hit.w) as { x: number; y: number; w: number; h: number };
    expect(box).toBeDefined();
    const glyph = scene.prims[scene.prims.indexOf(hit as never) - 1] as { t: string; d: string };
    const nums = (glyph.d.match(/-?[\d.]+/g) ?? []).map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThan(box.x);
      expect(nums[i]).toBeLessThan(box.x + box.w);
      expect(nums[i + 1]).toBeGreaterThan(box.y);
      expect(nums[i + 1]).toBeLessThan(box.y + box.h);
    }
  });

  it('SVG: the marker is a link only when the export gives it a target', () => {
    const scene = layoutCanvas(overview, model);
    expect(sceneToSvg(scene)).not.toContain('<a ');
    const svg = sceneToSvg(scene, { link: (f) => `#to-${f}` });
    expect(svg).toContain('<a href="#to-diagrams/orders.uml.json">');
  });

  it('HTML export: figures are anchored and markers jump to the figure showing the detail', () => {
    const content: ExportContent = {
      system: 'Shop',
      title: 'Shop',
      version: '1',
      changeHistory: [],
      sections: [
        { id: 'a', number: 5, title: 'Building blocks', file: 'sections/05.md', markdown: '# Building blocks\n\n<!-- archery:diagram diagrams/overview.uml.json -->\n\n<!-- archery:diagram diagrams/orders.uml.json -->\n', enabled: true },
      ],
      diagrams: {
        'diagrams/overview.uml.json': { kind: 'canvas', title: 'Overview', diagram: overview, text: '' },
        'diagrams/orders.uml.json': { kind: 'canvas', title: 'Orders inside', diagram: inside, text: '' },
      },
      model,
      tables: {},
      decisions: [],
    };
    const html = renderDocumentHtml(content, { generator: 'test', date: '2026-11-19' });
    expect(html).toContain('<figure class="diagram" id="diagram-orders">');
    expect(html).toContain('<a href="#diagram-orders">');
    // The detail diagram itself has no link to itself.
    expect(html.match(/<a href="#diagram-orders">/g)).toHaveLength(1);
  });

  it('validation warns about a detail diagram that does not exist', () => {
    const issues = checkReferences({ model, canvasDiagrams: [{ file: 'diagrams/overview.uml.json', diagram: overview }], sequenceDiagrams: [] });
    expect(issues.map((i) => i.message).join()).toContain('detailed in "diagrams/orders.uml.json"');
    const ok = checkReferences({ model, canvasDiagrams: [{ file: 'diagrams/overview.uml.json', diagram: overview }, { file: 'diagrams/orders.uml.json', diagram: inside }], sequenceDiagrams: [] });
    expect(ok.filter((i) => i.message.includes('detailed in'))).toEqual([]);
  });

  it('update_element sets the detail diagram by name and rejects unknown ones', async () => {
    const files = scaffold({ system: 'Webshop', includeHelp: false });
    const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
      const def = TOOLS.find((t) => t.name === name)!;
      const session = await ArcherySession.load(memoryReader(files), 'docs/architecture');
      const result = await def.run(session, def.input.parse(args));
      for (const [path, text] of session.changes) text === DELETED ? files.delete(path) : files.set(path, text);
      return result;
    };
    await call('add_element', { name: 'Orders', kind: 'component', diagram: 'building-blocks-l1' });
    await call('create_diagram', { name: 'orders-inside', type: 'component', title: 'Orders inside' });
    await call('update_element', { id: 'orders', detail: 'orders-inside' });
    expect(files.get('model.yaml')).toContain('detail: diagrams/orders-inside.uml.json');
    await expect(call('update_element', { id: 'orders', detail: 'nowhere' })).rejects.toThrow(/not found/);
    await call('update_element', { id: 'orders', detail: null });
    expect(files.get('model.yaml')).not.toContain('detail:');
  });
});
