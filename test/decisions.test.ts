// Architecture decision records: reading and writing their parts (src/doc/adr.ts), the decision tools
// as the document's decision dialog uses them, and following links in the document view.
import { describe, expect, it } from 'vitest';
import { adrTitle, readAdrParts, setAdrPart, setAdrTitle, splitAdrText } from '../src/doc/adr';
import { scaffold } from '../src/template/scaffold';
import { ArcherySession, DELETED } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import type { WorkspaceReader } from '../src/model/load';
import { headingSlug, normalizePath } from '../webview/document/links';

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
  return { files, call, read: (file: string) => files.get(file.replace('docs/architecture/', ''))! };
}

const NYGARD = `# Use REST

## Context

Clients need orders.

\`\`\`text
## not a heading
\`\`\`

## Decision

REST over HTTPS.

## Consequences

Simple.

## Notes

Kept as written.
`;

describe('ADR parts', () => {
  it('reads the title and the Nygard parts, ignoring headings in code', () => {
    expect(adrTitle(NYGARD)).toBe('Use REST');
    const parts = readAdrParts(NYGARD);
    expect(parts.context).toBe('Clients need orders.\n\n```text\n## not a heading\n```');
    expect(parts.decision).toBe('REST over HTTPS.');
    expect(parts.consequences).toBe('Simple.');
    expect(parts.options).toBeUndefined();
  });

  it('reads MADR headings as the same parts', () => {
    const parts = readAdrParts('# X\n\n## Context and Problem Statement\n\nWhy\n\n## Considered Options\n\n* A\n* B\n\n## Decision Outcome\n\nChosen option: A\n');
    expect(parts).toMatchObject({ context: 'Why', options: '* A\n* B', decision: 'Chosen option: A' });
  });

  it('adds a missing part in the usual order, keeps unknown parts and removes an emptied optional part', () => {
    let body = setAdrPart(NYGARD, 'options', 'A or B');
    expect(body.indexOf('## Considered Options')).toBeGreaterThan(body.indexOf('## Context'));
    expect(body.indexOf('## Considered Options')).toBeLessThan(body.indexOf('## Decision'));
    expect(body).toContain('## Notes\n\nKept as written.');
    body = setAdrPart(body, 'decision', 'gRPC.');
    expect(readAdrParts(body).decision).toBe('gRPC.');
    body = setAdrPart(body, 'options', '');
    expect(body).not.toContain('Considered Options');
    // An emptied core part keeps its heading.
    expect(setAdrPart(body, 'consequences', '')).toContain('## Consequences\n');
    expect(adrTitle(setAdrTitle(body, 'Use gRPC'))).toBe('Use gRPC');
  });

  it('splits front matter', () => {
    expect(splitAdrText('---\nstatus: accepted\n---\n\n# T\n')).toEqual({ front: 'status: accepted', body: '\n# T\n' });
    expect(splitAdrText('# T\n').front).toBeNull();
  });
});

describe('decision tools (the decision dialog)', () => {
  it('creates a full record and edits every field', async () => {
    const { call, read } = await workspace();
    const old = await call('create_decision', { title: 'Use SOAP' });
    const adr = await call('create_decision', {
      title: 'Use REST',
      status: 'accepted',
      date: '2026-11-02',
      deciders: ['Architect', ' Team lead '],
      context: 'Clients need orders.',
      options: '* REST\n* gRPC',
      decision: 'REST.',
      supersedes: old.number,
    });
    let text = read(adr.file);
    expect(text).toMatch(/^---\nstatus: accepted\ndate: 2026-11-02\ndeciders: \[ Architect, Team lead \]\nsupersedes: "?0001"?\n/);
    expect(text).toContain('## Context\n\nClients need orders.\n\n## Considered Options\n\n* REST\n* gRPC\n\n## Decision\n\nREST.\n\n## Consequences\n');
    expect(read(old.file)).toMatch(/status: superseded/);

    await call('update_decision', { decision: adr.number, title: 'Use REST/JSON', date: '2026-11-03', deciders: [], options: '', confirmation: 'Reviews check it.', supersedes: '', consequences: 'Simple.' });
    text = read(adr.file);
    expect(text).toContain('# Use REST/JSON');
    expect(text).toContain('date: 2026-11-03');
    expect(text).not.toContain('deciders');
    expect(text).not.toContain('supersedes');
    expect(text).not.toContain('Considered Options');
    expect(text).toMatch(/## Consequences\n\nSimple\.\n\n## Confirmation\n\nReviews check it\.\n$/);
    const v = await call('validate');
    expect(v.problems.filter((p: any) => p.severity === 'error')).toEqual([]);
  });
});

describe('document links', () => {
  it('resolves relative paths and heading anchors', () => {
    expect(normalizePath('sections/../decisions/0001-x.md')).toBe('decisions/0001-x.md');
    expect(normalizePath('sections/../../../src/a.ts')).toBe('../../src/a.ts');
    expect(normalizePath('/images/./a.png')).toBe('images/a.png');
    expect(headingSlug('Quality Goals (top 3)')).toBe('quality-goals-top-3');
  });
});

describe('data list ids', () => {
  it('are numbered like the decision records, skipping taken numbers', async () => {
    const { call, files } = await workspace();
    await call('write_data_table', {
      list: 'constraints',
      rows: [{ constraint: 'Windows only' }, { id: 'C-2', constraint: 'Node 22' }, { constraint: 'No cloud' }],
    });
    const yaml = files.get('data/constraints.yaml')!;
    expect([...yaml.matchAll(/- id: (\S+)/g)].map((m) => m[1])).toEqual(['C-1', 'C-2', 'C-3']);
  });
});
