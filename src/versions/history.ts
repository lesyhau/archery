// Version history of an architecture documentation folder. Pure logic; the VS Code side
// (src/versions/tracker.ts) feeds it file changes and persists the results.
//
//   .versions/history.yaml   current version + one entry per change
//   .versions/v3.0.json      snapshot of every text file at release 3.0
//   .versions/v2.7.json      backup snapshot taken automatically before a rollback
//
// Every saved change raises the minor version (v2.6 -> v2.7). A release raises the
// major version and resets the minor (v2.7 -> v3.0) and stores a snapshot. Rolling
// back restores a snapshot's files as a new minor version, so numbers never repeat.
import { parseDocument, stringify } from 'yaml';
import { z } from 'zod';

export const VERSIONS_DIR = '.versions';
export const HISTORY_FILE = `${VERSIONS_DIR}/history.yaml`;

const VersionSchema = z.string().regex(/^\d+\.\d+$/);

export const HistoryEntrySchema = z.object({
  version: VersionSchema,
  date: z.string(),
  kind: z.enum(['edit', 'release', 'rollback']),
  files: z.array(z.string()).optional(),
  /** Release: the change log entry. */
  note: z.string().optional(),
  /** Who released it. */
  author: z.string().optional(),
  /** For rollbacks: the snapshot that was restored. */
  restored: VersionSchema.optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistorySchema = z.object({
  current: VersionSchema.default('0.0'),
  entries: z.array(HistoryEntrySchema).default([]),
});
export type History = z.infer<typeof HistorySchema>;

export const SnapshotSchema = z.object({
  version: VersionSchema,
  kind: z.enum(['release', 'backup']),
  date: z.string(),
  note: z.string().optional(),
  /** Path (relative to the documentation root) -> file content. */
  files: z.record(z.string(), z.string()),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export interface Version {
  major: number;
  minor: number;
}

export function parseVersion(v: string): Version {
  const [major = 0, minor = 0] = v.split('.').map(Number);
  return { major, minor };
}

export const formatVersion = ({ major, minor }: Version) => `${major}.${minor}`;

export function emptyHistory(): History {
  return { current: '0.0', entries: [] };
}

export function parseHistory(text: string | undefined): History {
  if (!text) return emptyHistory();
  const result = HistorySchema.safeParse(parseDocument(text).toJS() ?? {});
  return result.success ? result.data : emptyHistory();
}

export function serializeHistory(history: History): string {
  return `# Archery version history - maintained by the extension, do not edit by hand.\n${stringify(history, { lineWidth: 0 })}`;
}

/** Files that belong to the documentation and are versioned (everything except .versions/). */
export function isVersioned(path: string): boolean {
  return !path.startsWith(`${VERSIONS_DIR}/`) && path !== VERSIONS_DIR;
}

/** Text files are snapshotted; binary files (images) are left alone by release and rollback. */
export function isSnapshotText(path: string): boolean {
  return /\.(md|markdown|ya?ml|json|txt|svg|puml|csv)$/i.test(path);
}

/** A saved change: raises the minor version. */
export function recordEdit(history: History, files: string[], date: string): History {
  const next = parseVersion(history.current);
  const version = formatVersion({ major: next.major, minor: next.minor + 1 });
  return {
    current: version,
    entries: [...history.entries, { version, date, kind: 'edit', files: [...new Set(files)].sort() }],
  };
}

export function canRelease(history: History): boolean {
  return parseVersion(history.current).minor > 0 || history.entries.length === 0;
}

/** A release: raises the major version, resets the minor, and returns the snapshot to store. */
export function recordRelease(
  history: History,
  files: Map<string, string>,
  date: string,
  note?: string,
  author?: string,
): { history: History; snapshot: Snapshot } {
  const version = formatVersion({ major: parseVersion(history.current).major + 1, minor: 0 });
  const snapshot: Snapshot = { version, kind: 'release', date, note, files: Object.fromEntries([...files].sort()) };
  return {
    history: { current: version, entries: [...history.entries, { version, date, kind: 'release', note, ...(author ? { author } : {}) }] },
    snapshot,
  };
}

export function snapshotPath(version: string): string {
  return `${VERSIONS_DIR}/v${version}.json`;
}

export interface RollbackPlan {
  /** Files to (re)write with the snapshot content. */
  write: Map<string, string>;
  /** Versioned text files that did not exist in the snapshot. */
  remove: string[];
  /** Backup of the current state, stored before anything changes. */
  backup: Snapshot;
  history: History;
}

/**
 * Restores `snapshot`. The current state is kept as a backup snapshot first, and the
 * rollback itself is recorded as the next minor version.
 */
export function planRollback(history: History, current: Map<string, string>, snapshot: Snapshot, date: string): RollbackPlan {
  const currentText = new Map([...current].filter(([p]) => isVersioned(p) && isSnapshotText(p)));
  const write = new Map<string, string>();
  for (const [path, text] of Object.entries(snapshot.files)) {
    if (currentText.get(path) !== text) write.set(path, text);
  }
  const remove = [...currentText.keys()].filter((p) => !(p in snapshot.files)).sort();
  const backup: Snapshot = {
    version: history.current,
    kind: 'backup',
    date,
    note: `State before restoring v${snapshot.version}`,
    files: Object.fromEntries([...currentText].sort()),
  };
  const { major, minor } = parseVersion(history.current);
  const version = formatVersion({ major, minor: minor + 1 });
  return {
    write,
    remove,
    backup,
    history: {
      current: version,
      entries: [
        ...history.entries,
        { version, date, kind: 'rollback', restored: snapshot.version, files: [...write.keys(), ...remove].sort() },
      ],
    },
  };
}

/** Snapshots listed newest first. */
export function sortSnapshots<T extends { version: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const va = parseVersion(a.version);
    const vb = parseVersion(b.version);
    return vb.major - va.major || vb.minor - va.minor;
  });
}

export interface ChangeHistoryRow {
  version: string;
  date: string;
  author?: string;
  changes: string;
}

/** The document's change history: one row per release, oldest first. */
export function changeHistory(history: History): ChangeHistoryRow[] {
  return history.entries
    .filter((e) => e.kind === 'release')
    .map((e) => ({ version: e.version, date: e.date.slice(0, 10), author: e.author, changes: e.note ?? '' }));
}
