import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { findSection } from '../src/template/template';
import { LISTS } from '../src/doc/dataLists';
import type { DocDiagram } from '../src/doc/protocol';
import { buildTables } from '../src/doc/tables';
import { imageReferences, renderDocumentHtml, type ExportContent } from '../src/export/documentHtml';
import { parseCanvasDiagram, parseModel, parseProject, parseSequenceDiagram, parseTimingDiagram } from '../src/model/load';

const ROOT = join(__dirname, '..', 'sample', 'docs', 'architecture');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The sample project, loaded like the extension does (without VS Code). */
function sampleContent(): ExportContent {
  const project = parseProject(read('archery.yaml')).value!;
  const model = parseModel(read('model.yaml')).value!;
  const sections = project.sections
    .filter((s) => s.enabled)
    .map((s) => ({ id: s.id, number: findSection(s.id)?.number, title: s.title ?? findSection(s.id)?.title ?? s.id, file: s.file, markdown: read(s.file), enabled: true }));
  const diagrams: Record<string, DocDiagram> = {};
  for (const name of readdirSync(join(ROOT, 'diagrams'))) {
    const file = `diagrams/${name}`;
    const text = read(file);
    if (name.endsWith('.uml.json')) {
      const p = parseCanvasDiagram(text, file).value!;
      diagrams[file] = { kind: 'canvas', title: p.title, diagram: p, text };
    } else if (name.endsWith('.timing.json')) {
      const p = parseTimingDiagram(text, file).value!;
      diagrams[file] = { kind: 'timing', title: p.title, diagram: p, text };
    } else {
      const p = parseSequenceDiagram(text, file).value!;
      diagrams[file] = { kind: 'sequence', title: p.title, diagram: p, text };
    }
  }
  const data = new Map<string, unknown>();
  for (const f of new Set(LISTS.map((l) => l.file))) {
    try {
      data.set(f, parseYaml(read(f)));
    } catch {
      /* missing list */
    }
  }
  return {
    system: project.system,
    title: project.title ?? project.system,
    version: '2.3',
    changeHistory: [{ version: '1.0', date: '2026-11-10', author: 'Lê', changes: 'First draft' }],
    sections,
    diagrams,
    model,
    tables: buildTables(data),
    decisions: [{ file: 'decisions/0001-x.md', number: '0001', title: 'Use PostgreSQL', status: 'accepted', date: '2026-11-01' }],
  };
}

describe('document export (HTML)', () => {
  const html = renderDocumentHtml(sampleContent(), { generator: 'Archery 0.1.0', date: '2026-11-18' });
  // For a manual look (and PDF printing): ARCHERY_EXPORT_OUT=path/to/file.html, optionally with
  // ARCHERY_EXPORT_SETTINGS='{"font":"Georgia",...}' (archery.yaml `export` options).
  if (process.env.ARCHERY_EXPORT_OUT) {
    const settings = process.env.ARCHERY_EXPORT_SETTINGS ? JSON.parse(process.env.ARCHERY_EXPORT_SETTINGS) : undefined;
    writeFileSync(process.env.ARCHERY_EXPORT_OUT, settings ? renderDocumentHtml(sampleContent(), { generator: 'Archery 0.1.0', date: '2026-11-18', settings }) : html, 'utf8');
  }

  it('is one standalone page with title, contents, chapters and the change history', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<title>Webshop</title>');
    expect(html).toContain('<h1 class="doc-title">Webshop</h1>');
    expect(html).toContain('<nav class="toc"');
    expect(html).toContain('<span class="num">1</span> Introduction and Goals');
    expect(html).toContain('<span class="num">1.1</span> Requirements Overview');
    expect(html).toContain('&lt;building block x.1&gt;'); // placeholders in headings stay visible text
    expect(html).toMatch(/<span class="num">13<\/span> Change history/);
    expect(html).toContain('First draft');
    // The last page: about the document (arc42, Archery), also in the contents.
    expect(html).toMatch(/<section class="chapter about" id="chapter-about"><h1 id="sec-about">About this document<\/h1>/);
    expect(html).toContain('arc42 9.1-EN by Dr. Peter Hruschka, Dr. Gernot Starke and contributors');
    expect(html).toContain('>Archery 0.1.0</a>');
    expect(html).toMatch(/<li class="l1"><a href="#sec-about">.*About this document/);
    expect(html).not.toContain('Structure based on');
    expect(html).not.toMatch(/<(script|link)\b/); // self-contained, no scripts or external styles
  });

  it('leaves out the arc42 guidance and renders diagrams as inline SVG with numbered captions', () => {
    expect(html).not.toContain('archery:help');
    expect(html).not.toContain('<!-- archery:');
    const diagrams = [...html.matchAll(/<b>Diagram (\d+):<\/b>/g)].map((m) => Number(m[1]));
    expect(diagrams.length).toBeGreaterThan(2);
    expect(diagrams).toEqual(diagrams.map((_, i) => i + 1));
    expect(html).toContain('<svg class="diagram-svg"');
    // Every kind of diagram file is drawn: the timing diagram shows its states and its frame.
    expect(html).toContain('Waiting for payment');
    expect(html).toContain('sd Place order timing');
  });

  it('renders data tables, the ADR index and Markdown tables with consecutive table numbers', () => {
    expect(html).toContain('<b>Table 1:</b> Quality goals');
    expect(html).toContain('Payment data never touches our servers.');
    expect(html).toContain('ADR-0001');
    const tables = [...html.matchAll(/<b>Table (\d+)[:<]/g)].map((m) => Number(m[1]));
    expect(tables).toEqual(tables.map((_, i) => i + 1));
  });

  it('uses captions from the Markdown and embeds images as figures', () => {
    const content = sampleContent();
    content.sections = [
      {
        id: 'introduction-and-goals',
        number: 1,
        title: 'Intro',
        file: 'sections/01.md',
        enabled: true,
        markdown: '# Intro\n\n<!-- archery:caption "Ports" -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![Context sketch](../images/sketch.png)\n\n<!-- archery:table data/quality-goals.yaml caption="Top goals" -->\n',
      },
    ];
    expect(imageReferences(content)).toContain('../images/sketch.png');
    const out = renderDocumentHtml(content, { generator: 'Archery', date: '2026-11-18', images: new Map([['../images/sketch.png', 'data:image/png;base64,AAAA']]) });
    expect(out).toContain('<b>Table 1:</b> Ports');
    expect(out).toContain('<b>Table 2:</b> Top goals');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    expect(out).toContain('<b>Figure 1:</b> Context sketch');
  });
});
