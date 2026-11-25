// Variables in the text, header and footer ({title}, {version}, the documentation's own), filled in
// by the export.
import { describe, expect, it } from 'vitest';
import { renderDocumentHtml, tocEntries, type ExportContent } from '../src/export/documentHtml';
import { fillVariables, variableValues } from '../src/doc/variables';
import { fillPlaceholders } from '../src/export/exportSettings';
import { buildTables } from '../src/doc/tables';

describe('fillVariables', () => {
  const values = variableValues({ title: 'Bootloader AD', system: 'Bootloader', version: '2.3' }, { docNumber: 'BL-AD-0001', version: 'not this', 'bad name': 'x' });

  it('fills built-in and custom variables, built-in ones first', () => {
    expect(fillVariables('{title} {docNumber} v{version}', values)).toBe('Bootloader AD BL-AD-0001 v2.3');
  });

  it('leaves unknown names, page numbers and API paths as written, and empties a built-in one without a value', () => {
    expect(fillVariables('/orders/{id} {page}/{pages} {bad name} [{chapter}]', values)).toBe('/orders/{id} {page}/{pages} {bad name} []');
  });

  it('fills custom variables in the header and footer too', () => {
    expect(fillPlaceholders('{docNumber} | Page {page}', values)).toBe('BL-AD-0001 | Page {page}');
  });
});

describe('variables in the export', () => {
  const tables = buildTables(new Map([['data/quality-goals.yaml', { goals: [{ id: 'QG-1', priority: 1, quality: 'Speed', goal: 'Boots {system} in 50 ms' }] }]]));
  const content: ExportContent = {
    system: 'Bootloader',
    title: '',
    version: '2.3',
    changeHistory: [],
    diagrams: {},
    model: { elements: [], relationships: [] },
    tables,
    decisions: [],
    sections: [
      {
        id: 'introduction-and-goals',
        number: 1,
        title: 'Introduction',
        file: 'sections/01.md',
        enabled: true,
        markdown: [
          '# Introduction',
          '',
          '## Scope of {system}',
          '',
          'This is {docNumber}, version {version}, of {date}, in chapter "{chapter}". Code keeps `{version}`.',
          '',
          '```',
          'GET /images/{version}',
          '```',
          '',
          '| Item | Value |',
          '| --- | --- |',
          '| Document | {docNumber} |',
          '',
          '<!-- archery:table data/quality-goals.yaml caption="Goals of {system}" -->',
          '',
        ].join('\n'),
      },
    ],
  };
  const html = renderDocumentHtml(content, { generator: 'Archery 0.3.0', date: '2026-11-25', settings: { variables: { docNumber: 'BL-AD-0001' }, header: '{docNumber} | {chapter}' } });

  it('fills the text, headings, tables and captions', () => {
    expect(html).toContain('This is BL-AD-0001, version 2.3, of 2026-11-25, in chapter &quot;1 Introduction&quot;.');
    expect(html).toContain('<td>BL-AD-0001</td>');
    expect(html).toContain('Boots Bootloader in 50 ms');
    expect(html).toContain('Goals of Bootloader');
    expect(tocEntries(html).map((e) => e.title)).toContain('Scope of Bootloader');
  });

  it('leaves code as written', () => {
    expect(html).toContain('<code>{version}</code>');
    expect(html).toContain('GET /images/{version}');
  });

  it('fills custom variables in the header', () => {
    expect(html).toContain('"BL-AD-0001"');
    expect(html).toMatch(/<span class="run-left">BL-AD-0001<\/span>/);
  });
});
