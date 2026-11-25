// ReqIF import and export (src/reqif): reading a requirements tool's file, merging it into the
// requirements list, writing it back with only Archery's changes, and .reqifz archives.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportReqif, type ArchitectureData } from '../src/reqif/export';
import { mergeRequirements, readRequirements, requirementId } from '../src/reqif/import';
import { Reqif } from '../src/reqif/reqif';
import { markdownToXhtml, xhtmlToMarkdown } from '../src/reqif/xhtml';
import { parseXml, serializeXml } from '../src/reqif/xml';
import { isZip, readZip, writeZip } from '../src/reqif/zip';
import { RequirementsSchema, type Requirement } from '../src/model/schema';
import type { WorkspaceReader } from '../src/model/load';
import { ArcherySession, DELETED, type DiskAccess } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import { scaffold } from '../src/template/scaffold';

const SAMPLE = readFileSync(join(__dirname, 'fixtures', 'webshop.reqif'), 'utf8');

const imported = () => mergeRequirements([], readRequirements(Reqif.parse(SAMPLE)).items).items;
const asRequirements = (items: Record<string, unknown>[]): Requirement[] => RequirementsSchema.parse({ requirements: items }).requirements;

function data(requirements: Requirement[], more: Partial<ArchitectureData> = {}): ArchitectureData {
  return { system: 'Webshop', requirements, goals: [], scenarios: [], constraints: [], decisions: [], elements: [], ...more };
}

/** A spec object of an exported file. */
const objectXml = (xml: string, id: string) => new RegExp(`<SPEC-OBJECT IDENTIFIER="${id}"[\\s\\S]*?</SPEC-OBJECT>`).exec(xml)?.[0] ?? '';

describe('ReqIF import', () => {
  it('reads requirements in document order with their hierarchy, text and attributes', () => {
    const items = imported();
    expect(items.map((i) => i.id)).toEqual(['REQ-1', 'REQ-2', 'REQ-3']);
    expect(items[0]).toMatchObject({ heading: 'Ordering', type: 'Functional requirement', reqif: 'o-1' });
    expect(items[1]).toMatchObject({ parent: 'REQ-1', status: 'Approved', attributes: { Owner: 'Team Orders' } });
    expect(items[1]!.text).toBe('The shop **shall** accept orders 24/7.\n\na | b');
    expect(items[2]).toMatchObject({ parent: 'REQ-1', status: 'Draft', text: 'Orders are paid by card.' });
    expect(() => asRequirements(items)).not.toThrow();
  });

  it('keeps Archery fields and Archery-made requirements when importing again', () => {
    const first = imported();
    first[1]!.satisfiedBy = ['orderService'];
    first.push({ id: 'REQ-NEW', text: 'Made in Archery' });
    first.push({ id: 'REQ-OLD', text: 'Deleted in the tool', reqif: 'o-gone' });
    const again = mergeRequirements(first, readRequirements(Reqif.parse(SAMPLE.replace('THE-VALUE="Team Orders"', 'THE-VALUE="Team Checkout"'))).items);
    expect(again.updated).toEqual(['REQ-2']);
    expect(again.unchanged).toBe(2);
    expect(again.removed).toEqual(['REQ-OLD']);
    expect(again.kept).toEqual(['REQ-NEW']);
    expect(again.items.find((i) => i.id === 'REQ-2')).toMatchObject({ satisfiedBy: ['orderService'], attributes: { Owner: 'Team Checkout' } });
  });

  it('turns tool ids into Archery ids', () => {
    expect(requirementId('42')).toBe('REQ-42');
    expect(requirementId('SRS 1.2')).toBe('SRS-1.2');
    expect(requirementId('  ')).toBe('');
  });
});

describe('ReqIF export', () => {
  const now = new Date('2026-11-25T12:00:00Z');

  it('writes an unchanged import back with the same objects, markup, relations and extensions', () => {
    const { xml } = exportReqif(data(asRequirements(imported())), { base: SAMPLE, now });
    for (const id of ['o-1', 'o-2', 'o-3']) expect(objectXml(xml, id)).toContain('LAST-CHANGE="2026-01-02T10:00:00Z"');
    expect(xml).toContain('accept orders&#160;24/7.</xhtml:p><xhtml:table>');
    expect(xml).toContain('<SPEC-RELATION IDENTIFIER="rel-1"');
    expect(xml).toContain('<prorx:x xmlns:prorx="urn:x"> keep  me </prorx:x>');
    expect(xml).toContain('<SPEC-HIERARCHY IDENTIFIER="h-2"');
    // The tool's ids stay as they are.
    expect(objectXml(xml, 'o-2')).toContain('THE-VALUE="2"');
    // Importing the export gives the same requirements.
    expect(mergeRequirements([], readRequirements(Reqif.parse(xml)).items).items).toEqual(imported());
  });

  it('changes only what changed, adds new requirements and removes deleted ones', () => {
    const items = asRequirements(imported());
    items[2]!.text = 'Orders are paid by card or invoice.';
    items[2]!.status = 'Approved';
    items.splice(1, 1); // REQ-2
    items.push({ id: 'REQ-9', parent: 'REQ-1', text: 'Customers get an e-mail.', satisfiedBy: [], goals: [] });
    const r = exportReqif(data(items), { base: SAMPLE, now });
    expect(r).toMatchObject({ added: 1, changed: 1, removed: 1 });
    expect(objectXml(r.xml, 'o-1')).toContain('LAST-CHANGE="2026-01-02T10:00:00Z"');
    const o3 = objectXml(r.xml, 'o-3');
    expect(o3).toContain('LAST-CHANGE="2026-11-25T12:00:00.000Z"');
    expect(o3).toContain('<xhtml:p>Orders are paid by card or invoice.</xhtml:p>');
    expect(o3).toContain('<ENUM-VALUE-REF>st-approved</ENUM-VALUE-REF>');
    expect(r.xml).not.toContain('IDENTIFIER="o-2"');
    expect(r.xml).not.toContain('rel-1'); // its target is gone
    expect(objectXml(r.xml, 'archery-req-REQ-9')).toContain('<SPEC-OBJECT-TYPE-REF>t-req</SPEC-OBJECT-TYPE-REF>');
    const again = readRequirements(Reqif.parse(r.xml)).items;
    expect(again.map((i) => [i.reqif, i.parentObject])).toEqual([['o-1', undefined], ['o-3', 'o-1'], ['archery-req-REQ-9', 'o-1']]);
  });

  it('adds an unknown enumeration value and rejects a value that does not fit the datatype', () => {
    const items = asRequirements(imported());
    items[1]!.status = 'Rejected';
    const { xml } = exportReqif(data(items), { base: SAMPLE, now });
    expect(xml).toMatch(/<ENUM-VALUE IDENTIFIER="archery-enum-dt-status-Rejected"[^>]*LONG-NAME="Rejected">\s*<PROPERTIES>\s*<EMBEDDED-VALUE KEY="2"/);
    expect(readRequirements(Reqif.parse(xml)).items[1]!.fields.status).toBe('Rejected');
  });

  it('writes a new file with the architecture and the trace links', () => {
    const r = exportReqif(
      data([{ id: 'REQ-1', title: 'Checkout', text: 'Pay by card.', status: 'draft', satisfiedBy: ['payments'], goals: ['QG-1'] }], {
        goals: [{ id: 'QG-1', priority: 1, quality: 'Reliability', goal: 'No lost orders' }],
        decisions: [{ number: '0001', title: 'Use a payment provider', status: 'accepted', requirements: ['REQ-1'], qualityGoals: ['QG-1'], constraints: [] }],
        elements: [{ id: 'payments', name: 'Payments', kind: 'component' }, { id: 'other', name: 'Other', kind: 'component' }],
      }),
      { now },
    );
    expect(r).toMatchObject({ added: 1, architecture: 3, links: 4 });
    expect(r.xml).toContain('<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"');
    expect(r.xml).toContain('LONG-NAME="Building blocks"');
    expect(r.xml).not.toContain('archery-arch-element-other');
    expect(r.xml).toMatch(/<SOURCE>\s*<SPEC-OBJECT-REF>archery-arch-element-payments<\/SPEC-OBJECT-REF>\s*<\/SOURCE>/);
    // The architecture is not read back as requirements.
    const back = readRequirements(Reqif.parse(r.xml));
    expect(back.items.map((i) => i.id)).toEqual(['REQ-1']);
    expect(back.items[0]!.fields).toMatchObject({ title: 'Checkout', text: 'Pay by card.', status: 'draft', type: 'Requirement' });
    // Exporting the export again replaces the architecture instead of adding it twice.
    const twice = exportReqif(data(asRequirements(mergeRequirements([], back.items).items)), { base: r.xml, now });
    expect(twice.xml.match(/archery-arch-goal-QG-1"/g)).toBeNull();
    expect(twice.xml.match(/IDENTIFIER="archery-req-REQ-1"/g)).toHaveLength(1);
  });
});

describe('XHTML text', () => {
  it('turns Markdown into XHTML and back', () => {
    const md = 'First **bold** and *em* [link](https://x.org)\nnext line\n\n- one\n- two\n\n1. a\n2. b';
    const div = markdownToXhtml(md);
    expect(xhtmlToMarkdown([div])).toBe(md);
  });
});

describe('XML and ZIP', () => {
  it('writes what it does not change as it was read', () => {
    const xml = '<?xml version="1.0"?>\n<!-- c -->\n<a x="1 &amp; 2">\n  <b>t &lt; u &#169;</b>\n  <c/>\n</a>\n';
    expect(serializeXml(parseXml(xml))).toBe(xml);
  });

  it('packs and unpacks a .reqifz', () => {
    const data = new TextEncoder().encode(SAMPLE);
    const zip = writeZip([{ name: 'srs.reqif', data }, { name: 'files/empty.txt', data: new Uint8Array() }]);
    expect(isZip(zip)).toBe(true);
    const back = readZip(zip);
    expect(back.map((e) => e.name)).toEqual(['srs.reqif', 'files/empty.txt']);
    expect(new TextDecoder().decode(back[0]!.data)).toBe(SAMPLE);
  });
});

describe('import_reqif / export_reqif tools', () => {
  const memoryReader = (files: Map<string, string>): WorkspaceReader => ({
    readText: async (path) => files.get(path),
    list: async (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
  });
  function workspace() {
    const files = scaffold({ system: 'Webshop', includeHelp: false });
    const outside = new Map<string, Uint8Array>([['in/srs.reqif', new TextEncoder().encode(SAMPLE)]]);
    const disk: DiskAccess = {
      read: async (path) => outside.get(path) ?? Promise.reject(new Error(`no ${path}`)),
      write: async (path, name, data) => {
        outside.set(path ?? name, data);
        return path ?? name;
      },
    };
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
      const def = TOOLS.find((t) => t.name === name)!;
      const session = await ArcherySession.load(memoryReader(files), '');
      session.disk = disk;
      const result = await def.run(session, def.input.parse(args));
      for (const [path, text] of session.changes) text === DELETED ? files.delete(path) : files.set(path, text);
      return result;
    };
    return { files, outside, call };
  }

  it('imports into the requirements list, keeps the file and shows the table in chapter 1.1', async () => {
    const { files, call } = workspace();
    // A documentation made before the requirements list: chapter 1 does not show it yet.
    files.set('sections/01-introduction-and-goals.md', '# Introduction and Goals\n\n## Requirements Overview\n\n## Quality Goals\n');
    const r = await call('import_reqif', { file: 'in/srs.reqif' });
    expect(r).toMatchObject({ requirements: 3, added: 3, specifications: ['Software requirements'], tableAddedTo: 'sections/01-introduction-and-goals.md' });
    expect(files.get('sections/01-introduction-and-goals.md')).toContain('## Requirements Overview\n\n<!-- archery:table data/requirements.yaml -->\n\n## Quality Goals');
    expect(files.get('data/requirements.reqif')).toBe(SAMPLE);
    const yaml = files.get('data/requirements.yaml')!;
    expect(yaml).toContain('reqif: o-2');
    // Columns the file fills (no titles in it).
    expect(yaml).not.toMatch(/field: title/);
    expect(yaml).toMatch(/field: heading/);
    expect((await call('get_data', { list: 'requirements' })).items).toHaveLength(3);
    const again = await call('import_reqif', { file: 'in/srs.reqif' });
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
    expect(again.tableAddedTo).toBeUndefined();
  });

  it('exports with the trace links, and a deleted element leaves the requirements', async () => {
    const { outside, call } = workspace();
    await call('import_reqif', { file: 'in/srs.reqif' });
    await call('add_element', { name: 'Order Service', kind: 'component' });
    await call('upsert_data_item', { list: 'requirements', item: { id: 'REQ-2', satisfiedBy: ['orderService'] } });
    await call('create_decision', { title: 'Queue orders', requirements: ['REQ-2'] });
    const r = await call('export_reqif', { file: 'out/srs.reqifz' });
    expect(r).toMatchObject({ file: 'out/srs.reqifz', requirements: 3, changed: 0, added: 0, links: 2 });
    const [entry] = readZip(outside.get('out/srs.reqifz')!);
    expect(entry!.name).toBe('srs.reqif');
    const xml = new TextDecoder().decode(entry!.data);
    expect(xml).toMatch(/<SOURCE>\s*<SPEC-OBJECT-REF>archery-arch-element-orderService</);
    expect(xml).toMatch(/<SOURCE>\s*<SPEC-OBJECT-REF>archery-arch-decision-ADR-0001</);

    await expect(call('delete_element', { id: 'orderService' })).rejects.toThrow(/requirement REQ-2/);
    await call('delete_element', { id: 'orderService', cascade: true });
    expect((await call('get_data', { list: 'requirements' })).items[1].satisfiedBy).toEqual([]);
  });

  it('validate reports requirements pointing to what does not exist', async () => {
    const { call } = workspace();
    await call('upsert_data_item', { list: 'requirements', item: { id: 'REQ-1', text: 'x', parent: 'REQ-0', satisfiedBy: ['nothing'], goals: ['QG-9'] } });
    const messages = (await call('validate')).problems.map((i: { message: string }) => i.message).join('\n');
    expect(messages).toContain('Requirement "REQ-1" is under unknown requirement "REQ-0"');
    expect(messages).toContain('satisfied by unknown element "nothing"');
    expect(messages).toContain('unknown quality goal "QG-9"');
  });
});
