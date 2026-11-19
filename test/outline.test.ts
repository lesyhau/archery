import { describe, expect, it } from 'vitest';
import { headingText, outlineOf } from '../src/doc/outline';

describe('chapter outline (sidebar contents)', () => {
  it('lists ## and ### headings with their lines, skipping code fences and comments', () => {
    const md = ['# Introduction', '', '## Goals', 'text', '```', '## not a heading', '```', '<!-- archery:help', '## also not', '-->', '### Quality **goals**', '## [Stakeholders](x.md) ##'].join('\n');
    expect(outlineOf(md)).toEqual([
      { level: 2, title: 'Goals', line: 2 },
      { level: 3, title: 'Quality goals', line: 10 },
      { level: 2, title: 'Stakeholders', line: 11 },
    ]);
    expect(headingText('`api` _v2_')).toBe('api v2');
  });
});
