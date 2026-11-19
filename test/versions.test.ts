import { describe, expect, it } from 'vitest';
import {
  canRelease,
  changeHistory,
  emptyHistory,
  isVersioned,
  parseHistory,
  planRollback,
  recordEdit,
  recordRelease,
  serializeHistory,
  snapshotPath,
  sortSnapshots,
} from '../src/versions/history';

const T = '2026-11-17T12:00:00Z';

describe('version history', () => {
  it('raises the minor version on every edit', () => {
    let h = emptyHistory();
    h = recordEdit(h, ['sections/01.md'], T);
    h = recordEdit(h, ['model.yaml', 'diagrams/a.uml.json', 'model.yaml'], T);
    expect(h.current).toBe('0.2');
    expect(h.entries[1]).toEqual({ version: '0.2', date: T, kind: 'edit', files: ['diagrams/a.uml.json', 'model.yaml'] });
  });

  it('a release raises the major version, resets the minor and snapshots the files', () => {
    let h = recordEdit(emptyHistory(), ['a.md'], T);
    const { history, snapshot } = recordRelease(h, new Map([['b.md', 'B'], ['a.md', 'A']]), T, 'first draft');
    expect(history.current).toBe('1.0');
    expect(snapshot).toEqual({ version: '1.0', kind: 'release', date: T, note: 'first draft', files: { 'a.md': 'A', 'b.md': 'B' } });
    expect(snapshotPath('1.0')).toBe('.versions/v1.0.json');
    expect(canRelease(history)).toBe(false); // nothing changed since 1.0
    h = recordEdit(history, ['a.md'], T);
    expect(h.current).toBe('1.1');
    expect(canRelease(h)).toBe(true);
    expect(recordRelease(h, new Map(), T).history.current).toBe('2.0');
  });

  it('rollback restores a snapshot as the next minor version and backs up the current state', () => {
    const history = { current: '2.3', entries: [] };
    const snapshot = { version: '1.0', kind: 'release' as const, date: T, files: { 'a.md': 'old A', 'b.md': 'B' } };
    const current = new Map([
      ['a.md', 'new A'],
      ['b.md', 'B'],
      ['c.md', 'added later'],
      ['images/logo.png', 'binary'],
      ['.versions/history.yaml', 'x'],
    ]);
    const plan = planRollback(history, current, snapshot, T);
    expect([...plan.write]).toEqual([['a.md', 'old A']]);
    expect(plan.remove).toEqual(['c.md']); // binary and .versions files are never touched
    expect(plan.backup).toMatchObject({ version: '2.3', kind: 'backup', files: { 'a.md': 'new A', 'b.md': 'B', 'c.md': 'added later' } });
    expect(plan.history.current).toBe('2.4');
    expect(plan.history.entries.at(-1)).toMatchObject({ kind: 'rollback', restored: '1.0', files: ['a.md', 'c.md'] });
  });

  it('round-trips the history file and tolerates a missing or broken one', () => {
    const h = recordEdit(emptyHistory(), ['a.md'], T);
    expect(parseHistory(serializeHistory(h))).toEqual(h);
    expect(parseHistory(undefined)).toEqual(emptyHistory());
    expect(parseHistory('current: [')).toEqual(emptyHistory());
  });

  it('sorts snapshots newest first and excludes .versions from versioning', () => {
    expect(sortSnapshots([{ version: '1.0' }, { version: '10.0' }, { version: '2.3' }]).map((s) => s.version)).toEqual(['10.0', '2.3', '1.0']);
    expect(isVersioned('.versions/v1.0.json')).toBe(false);
    expect(isVersioned('sections/01.md')).toBe(true);
  });
});

describe('change history', () => {
  it('lists releases with author and change log, oldest first', () => {
    let h = recordEdit(emptyHistory(), ['a.md'], T);
    h = recordRelease(h, new Map(), '2026-11-17T10:00:00Z', 'First review', 'Lê').history;
    h = recordEdit(h, ['a.md'], T);
    h = recordRelease(h, new Map(), '2026-11-18T09:00:00Z', 'Deployment view added').history;
    expect(changeHistory(h)).toEqual([
      { version: '1.0', date: '2026-11-17', author: 'Lê', changes: 'First review' },
      { version: '2.0', date: '2026-11-18', author: undefined, changes: 'Deployment view added' },
    ]);
  });
});
