import { describe, expect, it } from 'vitest';
import { formatAttribute, formatOperation, parseAttribute, parseOperation } from '../src/model/umlText';
import { layoutCanvas } from '../src/render/canvasLayout';
import { sceneToSvg } from '../src/render/svgExport';

describe('UML member text', () => {
  it('parses and formats attributes', () => {
    const a = parseAttribute('- static /items: List<Item> [0..*] = empty');
    expect(a).toEqual({ visibility: '-', static: true, derived: true, name: 'items', type: 'List<Item>', multiplicity: '0..*', default: 'empty' });
    expect(formatAttribute(a!)).toBe('-static /items: List<Item> [0..*] = empty');
    expect(parseAttribute('id')).toEqual({ name: 'id' });
    expect(parseAttribute('   ')).toBeUndefined();
  });

  it('parses and formats operations, splitting parameters at top-level commas only', () => {
    const o = parseOperation('+ abstract find(key: Map<K, V>, limit: int): List<T>');
    expect(o).toEqual({ visibility: '+', abstract: true, name: 'find', params: [{ name: 'key', type: 'Map<K, V>' }, { name: 'limit', type: 'int' }], returns: 'List<T>' });
    expect(formatOperation(o!)).toBe('+abstract find(key: Map<K, V>, limit: int): List<T>');
    expect(parseOperation('#static total(): Money')).toEqual({ visibility: '#', static: true, name: 'total', returns: 'Money' });
    // Round trip is stable.
    for (const line of ['+run()', '-save(entity: T): void', 'count: int']) {
      expect(formatOperation(parseOperation(formatOperation(parseOperation(line)!))!)).toBe(formatOperation(parseOperation(line)!));
    }
  });
});

describe('SVG export', () => {
  it('writes a standalone, escaped SVG', () => {
    const scene = layoutCanvas(
      { version: 1, type: 'class', title: 'T', nodes: [{ ref: 'a', x: 0, y: 0 }], edges: [], local: { nodes: [], edges: [] } },
      { elements: [{ id: 'a', kind: 'class', name: 'List<T> & Co' }], relationships: [] },
    );
    const svg = sceneToSvg(scene, { title: 'Domain <model>' });
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('List&lt;T&gt; &amp; Co');
    expect(svg).toContain('<title>Domain &lt;model&gt;</title>');
    expect(svg).not.toContain('var(--');
  });
});
