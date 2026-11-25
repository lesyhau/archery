import { describe, expect, it } from 'vitest';
import { scaffold } from '../src/template/scaffold';
import { SECTIONS } from '../src/template/template';
import { headingsOf } from '../src/template/markdown';
import { loadWorkspace, type WorkspaceReader } from '../src/model/load';

function memoryReader(files: Map<string, string>): WorkspaceReader {
  return {
    readText: async (path) => files.get(path),
    list: async (dir) =>
      [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
  };
}

describe('arc42 template', () => {
  it('has the 12 sections in order with unique ids and files', () => {
    expect(SECTIONS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(12);
    expect(new Set(SECTIONS.map((s) => s.file)).size).toBe(12);
  });

  it('follows the subsection structure of the arc42 template', () => {
    const subs = (id: string) => SECTIONS.find((s) => s.id === id)!.subsections.map((s) => s.title);
    expect(subs('introduction-and-goals')).toEqual(['Requirements Overview', 'Quality Goals', 'Stakeholders']);
    expect(subs('context-and-scope')).toEqual(['Business Context', 'Technical Context']);
    expect(subs('building-block-view')).toEqual(['Whitebox Overall System', 'Level 2', 'Level 3']);
    expect(subs('deployment-view')).toEqual(['Infrastructure Level 1', 'Infrastructure Level 2']);
    expect(subs('quality-requirements')).toEqual(['Quality Requirements Overview', 'Quality Scenarios']);
  });
});

describe('scaffold', () => {
  const files = scaffold({ system: 'Webshop', includeHelp: true });

  it('creates project, model, all section files, data files and starter diagrams', () => {
    expect(files.has('archery.yaml')).toBe(true);
    expect(files.has('model.yaml')).toBe(true);
    for (const s of SECTIONS) expect(files.has(`sections/${s.file}`)).toBe(true);
    for (const name of ['quality-goals', 'stakeholders', 'constraints', 'quality-requirements', 'risks', 'glossary']) {
      expect(files.has(`data/${name}.yaml`)).toBe(true);
    }
    expect(files.has('diagrams/building-blocks-l1.uml.json')).toBe(true);
    expect(files.has('diagrams/deployment-l1.uml.json')).toBe(true);
  });

  it('produces a workspace that loads without issues', async () => {
    const ws = await loadWorkspace(memoryReader(files));
    expect(ws.issues).toEqual([]);
    expect(ws.project?.system).toBe('Webshop');
    expect(ws.project?.sections).toHaveLength(12);
    expect(ws.diagrams.map((d) => d.type)).toEqual(['component', 'deployment']);
    expect(ws.dataFiles).toHaveLength(7);
  });

  it('every directive points to a generated file', () => {
    for (const [path, content] of files) {
      if (!path.endsWith('.md')) continue;
      for (const m of content.matchAll(/<!-- archery:(diagram|table) ([^\s#]+)/g)) {
        expect(files.has(m[2]!), `${path} -> ${m[2]}`).toBe(true);
      }
    }
  });

  it('puts help in comments only when requested', () => {
    const intro = files.get('sections/01-introduction-and-goals.md')!;
    expect(intro).toContain('<!-- archery:help');
    expect(headingsOf(intro).map((h) => h.title)).toEqual(['Requirements Overview', 'Quality Goals', 'Stakeholders']);
    const plain = scaffold({ system: 'Webshop', includeHelp: false });
    expect(plain.get('sections/01-introduction-and-goals.md')).not.toContain('archery:help');
  });

  it('never closes a help comment early', () => {
    for (const [path, content] of files) {
      if (!path.endsWith('.md')) continue;
      for (const block of content.split('<!-- archery:help').slice(1)) {
        const end = block.indexOf('-->');
        expect(block.slice(0, end)).not.toContain('<!--');
      }
    }
  });
});

describe('headingsOf', () => {
  it('ignores headings inside code fences', () => {
    const md = '# T\n## A\n```\n## not a heading\n```\n## B ##\n';
    expect(headingsOf(md)).toEqual([
      { title: 'A', line: 1 },
      { title: 'B', line: 5 },
    ]);
  });
});
