import { describe, expect, it } from 'vitest';
import type { ExportContent } from '../src/export/documentHtml';
import { cssContent, pageCss, renderDocumentHtml } from '../src/export/documentHtml';
import { marginSlots, resolveExportSettings } from '../src/export/exportSettings';
import type { CanvasDiagram, ExportSettings, Model, SequenceDiagram } from '../src/model/schema';
import { edgePoints, layoutCanvas, moveSegment } from '../src/render/canvasLayout';
import { headPath, polylineD, roundCorners, strokeWidthOf } from '../src/render/scene';
import { layoutSequence } from '../src/render/sequenceLayout';
import { sceneToSvg } from '../src/render/svgExport';

const model: Model = {
  elements: [
    { id: 'a', kind: 'component', name: 'Shop' },
    { id: 'b', kind: 'component', name: 'Orders' },
  ],
  relationships: [{ id: 'r', kind: 'dependency', from: 'a', to: 'b', label: 'place()' }],
};
const canvas: CanvasDiagram = { version: 1, type: 'component', title: 'C', nodes: [{ ref: 'a', x: 0, y: 0 }, { ref: 'b', x: 400, y: 260 }], edges: [{ ref: 'r', waypoints: [] }], local: { nodes: [], edges: [] } };

describe('diagram styles', () => {
  it('Modern: rounded boxes, rounded right-angle lines, small heads, muted labels, thin outlines', () => {
    const classic = layoutCanvas(canvas, model);
    const modern = layoutCanvas(canvas, model, 'modern');
    expect(classic.style).toBeUndefined();
    expect(modern.style).toBe('modern');
    // Element boxes (the component icon's small rectangles get proportionally small radii).
    const rects = (s: typeof modern) => s.prims.filter((p) => p.t === 'rect' && p.w >= 40 && p.h >= 30) as { rx?: number }[];
    expect(rects(modern).every((p) => (p.rx ?? 0) >= 4)).toBe(true);
    expect(rects(classic).some((p) => (p.rx ?? 0) < 4)).toBe(true);
    // The line turns once, with a rounded corner (Q); the classic one is a straight diagonal.
    const linePath = (s: typeof modern) => (s.prims.find((p) => p.t === 'path' && p.dashed) as { d: string }).d;
    expect(linePath(modern)).toMatch(/Q/);
    expect(linePath(classic)).not.toMatch(/Q/);
    const label = modern.prims.find((p) => p.t === 'text' && p.text === 'place()') as { fill?: string; italic?: boolean };
    expect(label).toMatchObject({ fill: 'muted', italic: true });
    expect(strokeWidthOf('modern')).toBeLessThan(strokeWidthOf('classic'));
    expect(sceneToSvg(modern)).toContain('stroke-width="1"');
    expect(sceneToSvg(modern)).toContain('stroke-linecap="round"');
  });

  it('one corner radius everywhere: actions, states, regions and signal shapes alike; object nodes stay square', () => {
    const d: CanvasDiagram = {
      version: 1,
      type: 'activity',
      title: 'A',
      nodes: [],
      edges: [],
      local: {
        nodes: [
          { id: 'a', kind: 'action', name: 'Charge', x: 0, y: 0 },
          { id: 's', kind: 'state', name: 'Paid', x: 200, y: 0 },
          { id: 'i', kind: 'interruptibleRegion', x: 0, y: 100, w: 300, h: 120 },
          { id: 'o', kind: 'object', name: 'Order', x: 400, y: 0 },
          { id: 'e', kind: 'acceptEvent', name: 'Received', x: 400, y: 100 },
          { id: 'q', kind: 'decision', x: 600, y: 0 },
        ],
        edges: [],
      },
    };
    const scene = layoutCanvas(d, { elements: [], relationships: [] }, 'modern');
    const radii = scene.prims.filter((p) => p.t === 'rect').map((p) => (p as { rx?: number }).rx ?? 0);
    expect(radii.sort()).toEqual([0, 6, 6, 6]); // the object node keeps square corners
    const polygons = scene.prims.filter((p) => p.t === 'path' && p.round).map((p) => (p as { d: string }).d);
    expect(polygons).toHaveLength(2);
    expect(polygons.every((pd) => /Q/.test(pd) && pd.trim().endsWith('Z'))).toBe(true);
    // Classic keeps its own radii and sharp polygons.
    const classic = layoutCanvas(d, { elements: [], relationships: [] });
    expect(classic.prims.filter((p) => p.t === 'path' && p.round).every((p) => !/Q/.test((p as { d: string }).d))).toBe(true);
  });

  it('orthogonal routes between the four side ports; straight when the ports line up; bend points use the facing port', () => {
    const shape = (x: number, y: number) => ({ box: { x, y, w: 100, h: 50 }, outline: 'rect' as const });
    expect(edgePoints(shape(0, 0), shape(0, 200), [], 'modern')).toEqual([[50, 50], [50, 200]]);
    expect(edgePoints(shape(0, 0), shape(40, 200), [], 'modern')).toEqual([[50, 50], [50, 125], [90, 125], [90, 200]]);
    expect(edgePoints(shape(0, 0), shape(300, 20), [], 'modern')).toEqual([[100, 25], [200, 25], [200, 45], [300, 45]]);
    // Side by side with a small vertical gap: a short Z between bottom and top ports, not through the source.
    expect(edgePoints(shape(0, 0), shape(60, 58), [], 'modern')).toEqual([[50, 50], [50, 54], [110, 54], [110, 58]]);
    expect(edgePoints(shape(0, 0), shape(300, 200), [{ x: 150, y: 25 }, { x: 150, y: 300 }], 'modern')).toEqual([[100, 25], [150, 25], [150, 300], [300, 225]]);
    expect(edgePoints(shape(0, 0), shape(300, 200), [], 'modern')).toEqual([[100, 25], [200, 25], [200, 225], [300, 225]]);
    expect(edgePoints(shape(0, 0), shape(150, 300), [], 'modern')).toEqual([[50, 50], [50, 175], [200, 175], [200, 300]]);
    // Nearly touching corners: no room for a Z, one turn instead (never doubling back).
    expect(edgePoints(shape(0, 0), shape(108, 60), [], 'modern')).toEqual([[100, 25], [158, 25], [158, 60]]);
    expect(edgePoints(shape(0, 0), shape(300, 200), [{ x: 150, y: 100 }], 'modern')).toHaveLength(3);
    expect(polylineD([[0, 0], [100, 0], [100, 100]], 8)).toBe('M0 0 L92 0 Q100 0 100 8 L100 100');
  });

  it('moving a segment of a right-angle route keeps the right angles and the ports', () => {
    const z: [number, number][] = [[100, 25], [200, 25], [200, 45], [300, 45]];
    // The middle (vertical) part moves sideways; its neighbours stretch.
    expect(moveSegment(z, 1, 150)).toEqual([{ x: 150, y: 25 }, { x: 150, y: 45 }]);
    // An end part moves across and jogs from a short stub at its port.
    expect(moveSegment(z, 0, 10)).toEqual([{ x: 116, y: 25 }, { x: 116, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 45 }]);
    // A straight line gets a jog at both ends.
    expect(moveSegment([[50, 50], [50, 200]], 0, 90)).toEqual([{ x: 50, y: 66 }, { x: 90, y: 66 }, { x: 90, y: 184 }, { x: 50, y: 184 }]);
    // Moving it back where it was leaves no extra bend points.
    expect(moveSegment(z, 1, 200)).toEqual([{ x: 200, y: 25 }, { x: 200, y: 45 }]);
    // The bend points route back through the same ports.
    const shape = (x: number, y: number) => ({ box: { x, y, w: 100, h: 50 }, outline: 'rect' as const });
    const pts = edgePoints(shape(0, 0), shape(300, 20), moveSegment(z, 1, 150), 'modern');
    expect(pts).toEqual([[100, 25], [150, 25], [150, 45], [300, 45]]);
  });

  it('a moved label is tied to its line by a dotted line; at its default place it is not', () => {
    const d: CanvasDiagram = { ...canvas, edges: [{ ref: 'r', waypoints: [] }] };
    const at = layoutCanvas(d, model, 'modern');
    expect(at.prims.some((p) => p.t === 'line' && p.dotted)).toBe(false);
    expect(at.prims.find((p) => p.t === 'text' && p.text === 'place()')).toMatchObject({ movable: true });
    const moved = layoutCanvas({ ...d, edges: [{ ref: 'r', waypoints: [], labelOffset: { x: 80, y: -60 } }] }, model, 'modern');
    const leader = moved.prims.find((p) => p.t === 'line' && p.dotted) as { x2: number; y2: number } | undefined;
    expect(leader).toBeDefined();
    // The leader ends on the (right-angle) line: level with one of its points on x or y.
    const line = (moved.prims.find((p) => p.t === 'path' && p.dashed) as { d: string }).d;
    const coords = [...line.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(coords.some(([x, y]) => Math.abs(x! - leader!.x2) < 0.6 || Math.abs(y! - leader!.y2) < 0.6)).toBe(true);
    // Node names outside the shape move the same way.
    const sm: CanvasDiagram = { version: 1, type: 'state', title: 'S', nodes: [], edges: [], local: { nodes: [{ id: 'p', kind: 'decision', name: 'ok?', x: 0, y: 0, labelOffset: { x: 40, y: -40 } }], edges: [] } };
    expect(layoutCanvas(sm, { elements: [], relationships: [] }).prims.some((p) => p.t === 'line' && p.dotted)).toBe(true);
  });

  it('smaller arrowheads, rounded small shapes, solid activation bars', () => {
    const len = (d: string) => {
      const n = d.match(/-?[\d.]+/g)!.map(Number);
      return Math.hypot(n[0]! - n[2]!, n[1]! - n[3]!);
    };
    expect(len(headPath('open', 0, 0, 1, 0, 'modern'))).toBeLessThan(len(headPath('open', 0, 0, 1, 0)));
    const [port] = roundCorners([{ t: 'rect', x: 0, y: 0, w: 14, h: 14 }], 'modern') as { rx?: number }[];
    expect(port!.rx).toBe(3.5);
    const seq: SequenceDiagram = { version: 1, type: 'sequence', title: 'S', lifelines: [{ ref: 'a' }, { ref: 'b' }], steps: [{ msg: { from: 'a', to: 'b', label: 'go()', kind: 'sync' } }] };
    const bar = (s: ReturnType<typeof layoutSequence>) => s.prims.find((p) => p.t === 'rect' && p.w <= 10 && p.h > 8) as { w: number; fill?: string };
    expect(bar(layoutSequence(seq, model))).toMatchObject({ w: 10, fill: 'surface' });
    expect(bar(layoutSequence(seq, model, 'modern'))).toMatchObject({ w: 6, fill: 'ink' });
  });
});

const content: ExportContent = {
  system: 'Shop',
  title: 'Shop architecture',
  version: '1.2',
  changeHistory: [],
  sections: [
    { id: 'intro', number: 1, title: 'Introduction', file: 'sections/01.md', markdown: '# Introduction\n\n## Goals\n\n### Quality\n\n#### Detail\n\nText.', enabled: true },
  ],
  diagrams: {},
  model: { elements: [], relationships: [] },
  tables: {},
  decisions: [],
};
const render = (settings = {}) => renderDocumentHtml(content, { generator: 'Archery test', date: '2026-11-19', settings });

describe('export settings', () => {
  it('defaults: Segoe UI 11 pt, A4, chapter in the header, title and version in the footer, page numbers bottom right, two-level contents', () => {
    const r = resolveExportSettings();
    expect(r).toMatchObject({ font: 'Segoe UI', headingFont: 'Segoe UI', fontSize: 11, pageSize: 'A4', header: '{chapter}', footer: '{title} · v{version}', pageNumbers: 'bottom-right', tocDepth: 2 });
    const html = render();
    expect(html).toContain("--font: 'Segoe UI'");
    expect(html).toContain('size: A4 portrait');
    expect(html).toContain('@bottom-left { content: "Shop architecture · v1.2"');
    expect(html).toContain('@bottom-right { content: "Page " counter(page) " of " counter(pages)');
    expect(html).toContain('@page :first'); // no header / footer on the cover
    expect(html).toContain('class="l2"');
    expect(html).not.toContain('class="l3"');
  });

  it('font, size, page, header with three parts, page number slot shared with the footer', () => {
    const html = render({ font: 'Georgia', headingFont: 'Calibri', fontSize: 12, pageSize: 'Letter', orientation: 'landscape', margins: 'wide', header: '{system} | Draft | v{version}', footer: '{date} | Internal', pageNumbers: 'bottom-right', pageNumberFormat: '{page}/{pages}' });
    expect(html).toContain("--font: 'Georgia'");
    expect(html).toContain("--heading-font: 'Calibri'");
    expect(html).toContain('--size: 12pt');
    expect(html).toContain('size: Letter landscape; margin: 25mm 25mm 27mm');
    expect(html).toContain('@top-left { content: "Shop"');
    expect(html).toContain('@top-center { content: "Draft"');
    expect(html).toContain('@top-right { content: "v1.2"');
    expect(html).toContain('@bottom-left { content: "2026-11-19"');
    expect(html).toContain('@bottom-right { content: "Internal · " counter(page) "/" counter(pages)');
  });

  it('contents depth and cover; headings always numbered, the change history always the last numbered chapter', () => {
    expect(render({ tocDepth: 0 })).not.toContain('<nav class="toc"');
    expect(render({ tocDepth: 4 })).toContain('class="l4"');
    // Older archery.yaml files may still carry the removed options: they change nothing.
    const plain = render({ cover: false, numberHeadings: false, changeHistory: false, chapterBreaks: false } as ExportSettings);
    expect(plain).toContain('class="cover compact"');
    expect(plain).toContain('<span class="num">1.1.1.1</span>');
    expect(plain).toMatch(/<h1 id="sec-change-history"><span class="num">\d+<\/span> Change history<\/h1>/);
    expect(plain).not.toContain('break-before: auto');
  });

  it('shows the chapter of each page in the header ({chapter}) through named pages', () => {
    const html = render();
    const named = [...html.matchAll(/<(?:section|nav)[^>]*style="page: (part-\d+)"/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(2);
    expect(new Set(named).size).toBe(named.length);
    expect(html).toContain('@page part-1 { @top-left { content: "Contents"');
    expect(html).toMatch(/@page part-2 \{ @top-left \{ content: "1 [^"]+"/);
    expect(html).toMatch(/@page part-\d+ \{ @top-left \{ content: "\d+ Change history"/);
    expect(html).toMatch(/@page part-\d+ \{ @top-left \{ content: "About this document"/);
    // A header without {chapter} needs no named pages.
    expect(render({ header: '{system}' })).not.toMatch(/@page part-/);
  });

  it('escapes header text for CSS and HTML', () => {
    expect(cssContent('a "b" \\ <c> {page}', {})).toBe('"a \\"b\\" \\\\ \\3C c> " counter(page)');
    expect(marginSlots({ header: 'x', footer: '', pageNumbers: 'top-right', pageNumberFormat: '{page}' })).toEqual({ 'top-left': 'x', 'top-right': '{page}' });
    expect(pageCss(resolveExportSettings({ header: '', footer: '', pageNumbers: 'none' }), {})).not.toContain('@top');
  });
});
