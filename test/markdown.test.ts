import { describe, expect, it } from 'vitest';
import { scaffold } from '../src/template/scaffold';
import { formatDirective, jsonToMarkdown, markdownToJson, parseDirective, parseMarkdown, serializeMarkdown } from '../src/doc/markdown';

const roundTrip = (md: string) => serializeMarkdown(parseMarkdown(md));
/** What the editor does: Markdown -> JSON (with writable paragraphs) -> Markdown. */
const editorRoundTrip = (md: string) => jsonToMarkdown(markdownToJson(md));

describe('directives', () => {
  it('parses and formats diagram frames', () => {
    const d = parseDirective(' archery:diagram diagrams/a.uml.json width=640 height=420 collapsed caption="Level 1 \\"core\\"" ');
    expect(d).toEqual({ kind: 'diagram', src: 'diagrams/a.uml.json', width: '640px', height: 420, collapsed: true, caption: 'Level 1 "core"' });
    expect(formatDirective(d!)).toBe('<!-- archery:diagram diagrams/a.uml.json width=640 height=420 collapsed caption="Level 1 \\"core\\"" -->');
    expect(parseDirective(' archery:diagram diagrams/b.seq.json width=80% ')).toMatchObject({ width: '80%', height: null });
  });

  it('parses multi-line help and ignores foreign comments', () => {
    expect(parseDirective(' archery:help\nLine 1\n\nLine 2\n')).toEqual({ kind: 'help', text: 'Line 1\n\nLine 2' });
    expect(parseDirective(' just a comment ')).toBeUndefined();
  });
});

describe('Markdown round trip', () => {
  it('keeps every scaffolded section byte-identical', () => {
    for (const includeHelp of [true, false]) {
      for (const [path, text] of scaffold({ system: 'X', includeHelp })) {
        if (!path.startsWith('sections/')) continue;
        expect(roundTrip(text), path).toBe(text);
        expect(editorRoundTrip(text), path).toBe(text);
      }
    }
  });

  it('turns directives into nodes', () => {
    const doc = parseMarkdown('# T\n\n<!-- archery:help\nHelp\n-->\n\n<!-- archery:diagram diagrams/a.uml.json height=300 -->\n\n<!-- archery:table data/risks.yaml -->\n');
    expect(doc.content.content.map((n) => n.type.name)).toEqual(['heading', 'archeryHelp', 'archeryDiagram', 'archeryTable']);
    expect(doc.child(2).attrs).toMatchObject({ src: 'diagrams/a.uml.json', height: 300 });
  });

  it('keeps common Markdown stable', () => {
    const md = `# Title

Intro with **bold**, *italic*, ~~gone~~, \`code\` and a [link](https://arc42.org "arc42").

## Sub

- one
- two
  - nested

1. first
2. second

> quoted

\`\`\`ts
const x = 1;
\`\`\`

| Name | Responsibility |
|---|---|
| Orders | Accepts *orders* |
| Pay \\| Bill | Charges |

---

![Logo](images/logo.png)

<div class="callout">Raw HTML stays</div>

A line with <br> inline HTML and a literal <placeholder>.
`;
    expect(roundTrip(md)).toBe(md);
  });

  it('adds a writable paragraph under headings that only have help or directives', () => {
    const json = markdownToJson('# T\n\n<!-- archery:help\nH\n-->\n\n## Sub\n\n<!-- archery:table data/x.yaml -->\n\n## Prose\n\nText\n');
    const types = (json.content as { type: string }[]).map((n) => n.type);
    expect(types).toEqual(['heading', 'archeryHelp', 'paragraph', 'heading', 'paragraph', 'archeryTable', 'heading', 'paragraph']);
  });

  it('normalizes once and is then stable', () => {
    const messy = '* a\n* b\n\n__strong__ and _em_\n\nSetext\n======\n';
    const once = roundTrip(messy);
    expect(once).toBe('- a\n- b\n\n**strong** and *em*\n\n# Setext\n');
    expect(roundTrip(once)).toBe(once);
  });
});

describe('tables with merged cells', () => {
  const merged = `# T

<table>
<tr><th colspan="2">Quality <strong>goals</strong></th><th>Notes</th></tr>
<tr><td rowspan="2">Security</td><td>No card data, see <a href="https://pci.org">PCI</a></td><td><code>a|b</code></td></tr>
<tr><td>Audit log</td><td>Line one<br>line two</td></tr>
</table>
`;

  it('reads an HTML table into an editable table with spans', () => {
    const doc = parseMarkdown(merged);
    const table = doc.child(1);
    expect(table.type.name).toBe('table');
    expect(table.child(0).child(0).attrs.colspan).toBe(2);
    expect(table.child(1).child(0).attrs.rowspan).toBe(2);
    expect(table.child(0).child(0).textContent).toBe('Quality goals');
  });

  it('writes it back unchanged', () => {
    expect(roundTrip(merged)).toBe(merged);
    expect(editorRoundTrip(merged)).toBe(merged);
  });

  it('writes a table as Markdown again once nothing is merged', () => {
    const json = markdownToJson(merged) as any;
    const table = json.content.find((n: any) => n.type === 'table');
    for (const row of table.content) for (const cell of row.content) cell.attrs = { ...cell.attrs, colspan: 1, rowspan: 1 };
    // Make the table rectangular again (3 x 3).
    table.content[0].content.push({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph' }] });
    table.content[2].content.unshift({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph' }] });
    const md = jsonToMarkdown(json);
    expect(md).toContain('| Quality **goals** | Notes |   |');
    expect(md).not.toContain('<table>');
  });

  it('keeps the caption of a Markdown table (comment before the table) and of a data table (directive option)', () => {
    const md = '# T\n\n<!-- archery:caption "Ports and protocols" -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<!-- archery:table data/quality-goals.yaml#goals caption="Top goals" -->\n';
    const doc = parseMarkdown(md);
    const table = doc.content.content.find((n) => n.type.name === 'table')!;
    expect(table.attrs.caption).toBe('Ports and protocols');
    const data = doc.content.content.find((n) => n.type.name === 'archeryTable')!;
    expect(data.attrs.caption).toBe('Top goals');
    const out = serializeMarkdown(doc);
    expect(out).toContain('<!-- archery:caption "Ports and protocols" -->\n\n| A | B |');
    expect(out).toContain('<!-- archery:table data/quality-goals.yaml#goals caption="Top goals" -->');
    expect(serializeMarkdown(parseMarkdown(out))).toBe(out);
    // no caption: nothing extra is written
    const plain = serializeMarkdown(parseMarkdown('| A |\n| --- |\n| 1 |\n'));
    expect(plain).not.toContain('archery:caption');
  });
});


describe('variables', () => {
  it('writes variables as typed', () => {
    const md = '# Intro\n\n{system} v{version}, document {docNumber}, as of {date}.\n';
    expect(editorRoundTrip(md)).toBe(md);
  });
});

describe('traceability tags', () => {
  it('writes bracketed text as typed, without escapes', () => {
    const md = '## Boot sequence [BOOTLOADER-AD 001]\n\nCovers [BOOTLOADER-SRS 012], [SRS_BL_013] and [REQ-1.2]. [SWRS:042] too.\n\n- [BOOTLOADER-AD 002] checks the signature\n';
    expect(roundTrip(md)).toBe(md);
    expect(editorRoundTrip(md)).toBe(md);
  });

  it('removes the escapes of earlier saves', () => {
    expect(editorRoundTrip('Covers \\[BOOTLOADER-SRS 012\\].\n')).toBe('Covers [BOOTLOADER-SRS 012].\n');
  });

  it('keeps escapes where the brackets would become Markdown', () => {
    // An inline link, a reference, a link definition, a task box, other characters, a real link.
    for (const text of ['[TAG 1](x)', '[TAG 1][y]', '[TAG 1]: x', '[x] done', '[a*b]', '[_x_]']) {
      const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
      const md = jsonToMarkdown(json);
      expect(md, text).toContain('\\[');
      // Read back, it is the same text.
      expect((markdownToJson(md) as any).content[0].content[0].text, text).toBe(text);
    }
    expect(roundTrip('See [the spec](https://x.org) [TAG 1].\n')).toBe('See [the spec](https://x.org) [TAG 1].\n');
  });

  it('keeps an escape when the next text node starts a link', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see [TAG 1]' }, { type: 'text', text: '(x)', marks: [{ type: 'bold' }] }] }] };
    expect(jsonToMarkdown(json)).toContain('\\[TAG 1\\]');
  });
});
