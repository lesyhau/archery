// Builds the editable tables shown in the document from data/*.yaml.
import { cellText, defaultColumns, LISTS, listForSrc, type ColumnView } from './dataLists';
import type { DocTable, TableMerge } from './protocol';

type Row = Record<string, unknown>;

/** The saved column layout of a list (`views.<key>.columns` in its file), if any. */
export function savedColumns(parsed: Row | undefined, key: string): ColumnView[] | undefined {
  const views = parsed?.views as Record<string, { columns?: unknown }> | undefined;
  const cols = views?.[key]?.columns;
  if (!Array.isArray(cols)) return undefined;
  const out = cols
    .filter((c): c is { field: string; label?: string; width?: unknown } => !!c && typeof c === 'object' && typeof (c as { field?: unknown }).field === 'string')
    .map((c) => ({ field: c.field, label: c.label ?? c.field, ...(typeof c.width === 'number' && c.width > 0 ? { width: c.width } : {}) }));
  return out.length > 0 ? out : undefined;
}

/** Saved merged cells of a list (`views.<key>.merges`). */
export function savedMerges(parsed: Row | undefined, key: string): TableMerge[] {
  const views = parsed?.views as Record<string, { merges?: unknown }> | undefined;
  const merges = views?.[key]?.merges;
  if (!Array.isArray(merges)) return [];
  return merges
    .filter((m): m is TableMerge => !!m && typeof m === 'object' && typeof m.row === 'string' && typeof m.field === 'string')
    .map((m) => ({ row: m.row, field: m.field, rows: Math.max(1, Number(m.rows) || 1), cols: Math.max(1, Number(m.cols) || 1) }));
}

/** Builds every table from the parsed data files (path -> parsed YAML). */
export function buildTables(data: Map<string, unknown>): Record<string, DocTable> {
  const tables: Record<string, DocTable> = {};
  for (const list of LISTS) {
    const parsed = data.get(list.file) as Row | undefined;
    if (parsed === undefined) continue;
    const items = Array.isArray(parsed?.[list.key]) ? (parsed[list.key] as Row[]) : [];
    const builtin = new Set(list.fields.map((f) => f.field));
    const columns = (savedColumns(parsed, list.key) ?? defaultColumns(list)).map((c) => ({ ...c, builtin: builtin.has(c.field) }));
    const table: DocTable = {
      list: list.name,
      title: list.title,
      file: list.file,
      keyField: list.keyField,
      columns,
      fields: list.fields.map((f) => ({ field: f.field, label: f.label, required: !!f.required, values: f.values })),
      rows: items.map((item) => Object.fromEntries(Object.entries(item ?? {}).map(([k, v]) => [k, cellText(v)]))),
      merges: savedMerges(parsed, list.key),
    };
    tables[`${list.file}#${list.key}`] = table;
    tables[list.file] ??= table; // `data/x.yaml` without a fragment means the file's first list
  }
  return tables;
}

/** Looks up the table for a directive src. */
export function tableFor(tables: Record<string, DocTable>, src: string): DocTable | undefined {
  const list = listForSrc(src);
  return tables[src] ?? (list ? tables[`${list.file}#${list.key}`] : undefined) ?? tables[src.split('#')[0]!];
}

/** A merged area of a table: top-left cell (row r, column c) and its size. */
export interface Span {
  r: number;
  c: number;
  rows: number;
  cols: number;
}

/** Merges that still make sense for the current rows/columns (covered cells hold the anchor value). */
export function resolveMerges(merges: TableMerge[], rows: Record<string, string>[], columns: { field: string }[], keyField: string): Span[] {
  const spans: Span[] = [];
  const taken = new Set<string>();
  for (const m of merges) {
    const r = rows.findIndex((row) => row[keyField] === m.row);
    const c = columns.findIndex((col) => col.field === m.field);
    if (r < 0 || c < 0 || r + m.rows > rows.length || c + m.cols > columns.length || m.rows * m.cols < 2) continue;
    const value = rows[r]![m.field] ?? '';
    let ok = true;
    for (let i = r; i < r + m.rows && ok; i++)
      for (let j = c; j < c + m.cols && ok; j++) {
        if ((rows[i]![columns[j]!.field] ?? '') !== value || taken.has(`${i}:${j}`)) ok = false;
      }
    if (!ok) continue;
    for (let i = r; i < r + m.rows; i++) for (let j = c; j < c + m.cols; j++) taken.add(`${i}:${j}`);
    spans.push({ r, c, rows: m.rows, cols: m.cols });
  }
  return spans;
}

