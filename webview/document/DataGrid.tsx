// In-place editable table for a structured arc42 list (data/*.yaml).
//  - click a cell to edit (Enter / Tab / Esc), paste images into cells
//  - hover a column / row boundary: the edge lights up with a "+" in its middle that inserts a column / row there;
//    dragging an inner column edge resizes the two columns next to it (widths are saved in percent);
//    double-clicking a column edge fits the column left of it to its content
//  - click a column header to rename it; hold Ctrl (Cmd) and drag a header or a cell to move the column / row
//  - hover a row / column: a grip outside the table (left of the row, above the column) moves it, a button
//    on the other side (right of the row, below the column) deletes it; the table's delete is at its top right
//  - right-click a header or a cell for rename, hide/delete, insert, delete row, merge/unmerge
//  - shift-click or drag across cells to select a range, then merge it (right-click)
// Every change is saved with the write_data_table operation (validated, one undoable edit).
import MarkdownIt from 'markdown-it';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DocTable, TableMerge } from '../../src/doc/protocol';
import { Caption } from './Caption';
import { resolveMerges, type Span } from '../../src/doc/tables';
import { fromSections, runOp, saveImage, useDoc } from './context';
import { IconPlusSmall } from './icons';
import { tableControls, type TableActions } from './tableControls';

type Row = Record<string, string>;
type Column = DocTable['columns'][number];
/** A hovered boundary: between columns index-1 and index, or above row index (index = count: the outer edge).
 *  pos is in viewport coordinates (the highlight is a fixed layer above the page). */
type Edge = { kind: 'col' | 'row'; index: number; pos: number };
/** The strip above the table (the column grips' line) where column lines can be grabbed too. */
const EDGE_STRIP = 24;

/** Column widths in percent (summing to 100), or null for the automatic layout. */
export function columnWidths(columns: { width?: number }[]): number[] | null {
  if (columns.length === 0 || columns.every((c) => c.width === undefined)) return null;
  const unset = columns.filter((c) => c.width === undefined).length;
  const known = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const fill = unset ? Math.max((100 - known) / unset, 60 / columns.length) : 0;
  const raw = columns.map((c) => c.width ?? fill);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (w * 100) / total);
}
interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

const md = new MarkdownIt('default', { html: false, linkify: true, breaks: true });

/** Cell markdown -> HTML; images are stored root-relative, the page resolves from sections/. */
function renderCell(text: string): string {
  return md.renderInline(text).replace(/<img src="([^"]*)"/g, (_, src: string) => `<img src="${fromSections(src)}"`);
}

const camel = (label: string) => {
  const words = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const s = words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
  return /^[A-Za-z_]/.test(s) ? s : `f${s}`;
};

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to > list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, item!);
  return next;
}

const norm = (r: Range): Range => ({ r1: Math.min(r.r1, r.r2), r2: Math.max(r.r1, r.r2), c1: Math.min(r.c1, r.c2), c2: Math.max(r.c1, r.c2) });

export { resolveMerges };

interface Menu {
  x: number;
  y: number;
  items: { label: string; onClick(): void; danger?: boolean; disabled?: boolean }[];
}

export function DataGrid({
  table,
  onDelete,
  caption = null,
  editable = true,
  onCaption,
}: {
  table: DocTable;
  onDelete(): void;
  /** The table's own title (null = the data list's name); shown as "Table N: title". */
  caption?: string | null;
  editable?: boolean;
  onCaption?(caption: string | null): void;
}) {
  const { showError } = useDoc();
  const [columns, setColumns] = useState<Column[]>(table.columns);
  const [rows, setRows] = useState<Row[]>(table.rows);
  const [merges, setMerges] = useState<TableMerge[]>(table.merges);
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [addCol, setAddCol] = useState<{ x: number; y: number; index: number } | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ kind: 'col' | 'row'; from: number; to: number | null } | null>(null);
  const [newColumn, setNewColumn] = useState('');
  const [moveKey, setMoveKey] = useState(false);
  /** Text typed into the open cell editor (null until the first keystroke). */
  const [draft, setDraft] = useState<string | null>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [liveWidths, setLiveWidths] = useState<number[] | null>(null);
  const resizing = useRef(false);
  const saving = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  /** The row / column controls outside the table call the current handlers. */
  const controls = useRef<TableActions | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = tableControls(host, () => (tableRef.current ? [tableRef.current] : []), {
      frame: () => cardRef.current!,
      rows: (t) => [...t.querySelectorAll<HTMLElement>('tbody tr[data-row]')],
      columns: (t) => [...t.querySelectorAll<HTMLElement>('thead th[data-col]')],
      moveRow: (t, a, b) => controls.current?.moveRow(t, a, b),
      moveColumn: (t, a, b) => controls.current?.moveColumn(t, a, b),
      deleteRow: (t, i) => controls.current?.deleteRow(t, i),
      deleteColumn: (t, i) => controls.current?.deleteColumn(t, i),
      deleteTable: (t) => controls.current?.deleteTable(t),
      columnDeleteTitle: (t, i) => controls.current?.columnDeleteTitle?.(t, i) ?? null,
      deleteTableTitle: 'Remove this table from the document (its entries are kept)',
    }, () => !!controls.current && editableRef.current);
    return () => c.destroy();
  }, []);

  // Holding Ctrl (Cmd on macOS) switches headers and cells from "edit" to "move".
  useEffect(() => {
    const sync = (e: globalThis.KeyboardEvent) => setMoveKey(e.ctrlKey || e.metaKey);
    const reset = () => setMoveKey(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', reset);
    };
  }, []);
  const isMove = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey;

  useEffect(() => setDraft(null), [editing?.row, editing?.col]);

  // Adopt changes from the file (other editors, AI tools, undo) unless a cell is being edited.
  const incoming = JSON.stringify([table.columns, table.rows, table.merges]);
  useEffect(() => {
    if (editing || saving.current) return;
    setColumns(table.columns);
    setRows(table.rows);
    setMerges(table.merges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  // Close floating menus on outside clicks, Escape or scrolling.
  useEffect(() => {
    if (!menu && !addCol) return;
    const close = (e: Event) => {
      if (e instanceof globalThis.KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && popRef.current?.contains(e.target as Node)) return;
      setMenu(null);
      setAddCol(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu, addCol]);

  const fieldInfo = useMemo(() => new Map(table.fields.map((f) => [f.field, f])), [table.fields]);
  const hidden = table.fields.filter((f) => !columns.some((c) => c.field === f.field));
  const spans = useMemo(() => resolveMerges(merges, rows, columns, table.keyField), [merges, rows, columns, table.keyField]);
  const spanAt = (r: number, c: number) => spans.find((s) => r >= s.r && r < s.r + s.rows && c >= s.c && c < s.c + s.cols);

  const save = async (nextRows: Row[], nextColumns: Column[] = columns, nextMerges: TableMerge[] = merges) => {
    // Drop merges that no longer fit (rows/columns moved or values changed).
    const kept = resolveMerges(nextMerges, nextRows, nextColumns, table.keyField).map((s) => ({ row: nextRows[s.r]![table.keyField]!, field: nextColumns[s.c]!.field, rows: s.rows, cols: s.cols }));
    setRows(nextRows);
    setColumns(nextColumns);
    setMerges(kept);
    saving.current = true;
    try {
      const cols = nextColumns.map(({ field, label, width }) => ({ field, label, ...(width !== undefined ? { width } : {}) }));
      await runOp('write_data_table', { list: table.list, rows: nextRows, columns: cols, merges: kept });
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
      setRows(table.rows);
      setColumns(table.columns);
      setMerges(table.merges);
    } finally {
      saving.current = false;
    }
  };

  /** A new row with placeholders for required fields (they cannot be empty). */
  const blankRow = (): Row => {
    const row: Row = {};
    for (const f of table.fields) {
      if (!f.required) continue;
      row[f.field] = f.field === 'priority' ? String(rows.length + 1) : `New ${f.label.toLowerCase().replace(/\/.*/, '')}`;
    }
    return row;
  };
  const insertRow = (at: number) => void save([...rows.slice(0, at), blankRow(), ...rows.slice(at)]);

  /** Sets a cell; inside a merged area every covered cell gets the value. */
  const setCell = (r: number, c: number, value: string) => {
    const span = spanAt(r, c);
    const cells = span ? Array.from({ length: span.rows * span.cols }, (_, i) => [span.r + Math.floor(i / span.cols), span.c + (i % span.cols)] as const) : [[r, c] as const];
    if (cells.every(([i, j]) => (rows[i]![columns[j]!.field] ?? '') === value)) return;
    const next = rows.map((row) => ({ ...row }));
    for (const [i, j] of cells) next[i]![columns[j]!.field] = value;
    void save(next);
  };

  const addColumn = (label: string, at: number) => {
    const name = label.trim();
    if (!name) return;
    const taken = new Set([...table.fields.map((f) => f.field), ...columns.map((c) => c.field)]);
    let field = camel(name);
    for (let i = 2; taken.has(field); i++) field = `${camel(name)}${i}`;
    const next = [...columns];
    next.splice(at, 0, { field, label: name, builtin: false });
    void save(rows, next);
  };

  const removeColumn = (i: number) => {
    const col = columns[i]!;
    // Custom columns lose their data; arc42 fields are only hidden (their data stays).
    const nextRows = col.builtin ? rows : rows.map(({ [col.field]: _dropped, ...rest }) => rest);
    void save(nextRows, columns.filter((_, j) => j !== i));
  };

  const mergeRange = (r: Range) => {
    const n = norm(r);
    const key = rows[n.r1]?.[table.keyField];
    if (!key) return showError('Save the row first (it has no id yet).');
    const anchor = rows[n.r1]![columns[n.c1]!.field] ?? '';
    const next = rows.map((row, i) => (i < n.r1 || i > n.r2 ? row : { ...row, ...Object.fromEntries(columns.slice(n.c1, n.c2 + 1).map((c) => [c.field, anchor])) }));
    // Replace merges that overlap the new one.
    const others = merges.filter((m) => {
      const s = resolveMerges([m], rows, columns, table.keyField)[0];
      return !s || s.r > n.r2 || s.r + s.rows - 1 < n.r1 || s.c > n.c2 || s.c + s.cols - 1 < n.c1;
    });
    setRange(null);
    void save(next, columns, [...others, { row: key, field: columns[n.c1]!.field, rows: n.r2 - n.r1 + 1, cols: n.c2 - n.c1 + 1 }]);
  };

  const unmerge = (span: Span) => {
    const key = rows[span.r]![table.keyField];
    void save(rows, columns, merges.filter((m) => !(m.row === key && m.field === columns[span.c]!.field)));
  };

  // --- context menus -----------------------------------------------------------------------
  const headerMenu = (e: React.MouseEvent, c: number) => {
    e.preventDefault();
    const col = columns[c]!;
    const required = fieldInfo.get(col.field)?.required;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename column', onClick: () => setRenaming(c) },
        { label: 'Insert column left', onClick: () => setAddCol({ x: e.clientX, y: e.clientY, index: c }) },
        { label: 'Insert column right', onClick: () => setAddCol({ x: e.clientX, y: e.clientY, index: c + 1 }) },
        required
          ? { label: 'Required arc42 field', disabled: true, onClick: () => undefined }
          : { label: col.builtin ? 'Hide column (data is kept)' : 'Delete column', danger: !col.builtin, onClick: () => removeColumn(c) },
      ],
    });
  };

  const cellMenu = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    const span = spanAt(r, c);
    const sel = range && norm(range);
    const inRange = sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
    const multi = inRange && (sel.r2 > sel.r1 || sel.c2 > sel.c1);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(multi ? [{ label: 'Merge cells', onClick: () => mergeRange(sel) }] : []),
        ...(span ? [{ label: 'Unmerge cells', onClick: () => unmerge(span) }] : []),
        { label: 'Insert row above', onClick: () => insertRow(r) },
        { label: 'Insert row below', onClick: () => insertRow(r + 1) },
        { label: 'Delete row', danger: true, onClick: () => void save(rows.filter((_, j) => j !== r)) },
      ],
    });
  };

  // --- moving columns and rows (pointer drag) ---------------------------------------------
  const startDrag = (e: RPointerEvent, kind: 'col' | 'row', from: number) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let to: number | null = null;
    const root = (e.currentTarget as HTMLElement).getRootNode() as Document | ShadowRoot;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      moved = true;
      ev.preventDefault();
      const el = root.elementFromPoint(ev.clientX, ev.clientY)?.closest(kind === 'col' ? 'th[data-col]' : 'tr[data-row]');
      if (el && tableRef.current?.contains(el)) {
        const index = Number(el.getAttribute(kind === 'col' ? 'data-col' : 'data-row'));
        const rect = el.getBoundingClientRect();
        const after = kind === 'col' ? ev.clientX > rect.left + rect.width / 2 : ev.clientY > rect.top + rect.height / 2;
        to = index + (after ? 1 : 0);
      }
      setDrag({ kind, from, to });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (!moved || to === null || to === from || to === from + 1) return;
      if (kind === 'col') void save(rows, move(columns, from, to));
      else void save(move(rows, from, to));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- column / row edges: hover highlight, "+" insert, column resize ----------------------
  const findEdge = (x: number, y: number): Edge | null => {
    const tbl = tableRef.current;
    const wrap = wrapRef.current;
    if (!tbl || !wrap) return null;
    const t = tbl.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const ths = [...tbl.querySelectorAll('th[data-col]')].map((el) => el.getBoundingClientRect());
    const trs = [...tbl.querySelectorAll('tbody tr[data-row]')].map((el) => el.getBoundingClientRect());
    const xs = ths.length ? [ths[0]!.left, ...ths.map((r) => r.right)] : [];
    const head = tbl.tHead?.getBoundingClientRect().bottom ?? t.top;
    const ys = trs.length ? [trs[0]!.top, ...trs.map((r) => r.bottom)] : [head];
    const near = (list: number[], v: number) => list.reduce<{ i: number; d: number } | null>((best, p, i) => (Math.abs(v - p) <= 5 && (!best || Math.abs(v - p) < best.d) ? { i, d: Math.abs(v - p) } : best), null);
    // Column lines also from the strip above the table (where the column grips are): short tables have short lines.
    // (only the inner lines, which resize: the outer ones would cover the table's delete button there).
    let col = y >= t.top - EDGE_STRIP && y <= t.bottom ? near(xs, x) : null;
    if (col && y < t.top && (col.i === 0 || col.i === xs.length - 1)) col = null;
    const row = x >= t.left && x <= t.right && y >= head - 5 ? near(ys, y) : null;
    if (col && (!row || col.d <= row.d)) return { kind: 'col', index: col.i, pos: xs[col.i]! };
    if (row) return { kind: 'row', index: row.i, pos: ys[row.i]! };
    return null;
  };

  const onWrapMove = (e: RPointerEvent) => {
    if (resizing.current || drag) return;
    if ((e.target as Element).closest('.edge-plus')) return; // on the "+" (it may sit off the edge)
    const next = findEdge(e.clientX, e.clientY);
    if (next?.kind !== edge?.kind || next?.index !== edge?.index || next?.pos !== edge?.pos) setEdge(next);
  };

  useEffect(() => {
    if (!edge) return;
    const clear = () => !resizing.current && setEdge(null);
    window.addEventListener('scroll', clear, true);
    return () => window.removeEventListener('scroll', clear, true);
  }, [edge]);

  const widths = liveWidths ?? columnWidths(columns);

  /** Drags the boundary between columns i-1 and i; the two columns trade width, the table keeps its size. */
  const startResize = (e: RPointerEvent, i: number) => {
    if (e.button !== 0 || i <= 0 || i >= columns.length || !tableRef.current || !wrapRef.current) return;
    e.preventDefault();
    const tbl = tableRef.current;
    const total = tbl.getBoundingClientRect().width;
    const start = [...tbl.querySelectorAll('th[data-col]')].map((th) => (th.getBoundingClientRect().width / total) * 100);
    const left0 = tbl.getBoundingClientRect().left;
    const min = (48 / total) * 100;
    const pair = start[i - 1]! + start[i]!;
    let current = start;
    let moved = false;
    resizing.current = true;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - e.clientX) < 2) return;
      moved = true;
      const left = Math.min(pair - min, Math.max(min, start[i - 1]! + ((ev.clientX - e.clientX) / total) * 100));
      current = start.map((w, j) => (j === i - 1 ? left : j === i ? pair - left : w));
      setLiveWidths(current);
      setEdge({ kind: 'col', index: i, pos: left0 + (total * current.slice(0, i).reduce((a, b) => a + b, 0)) / 100 });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      resizing.current = false;
      if (!moved) return;
      void save(rows, columns.map((c, j) => ({ ...c, width: Math.round(current[j]! * 10) / 10 }))).finally(() => setLiveWidths(null));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /**
   * Double-click on a column line: the column left of it gets the width of its widest content (one line,
   * as far as the table allows); its neighbour gives or takes the difference, so the table keeps its size.
   */
  const fitColumn = (i: number) => {
    const tbl = tableRef.current;
    if (!tbl || i < 0 || i >= columns.length || columns.length < 2) return;
    const partner = i + 1 < columns.length ? i + 1 : i - 1;
    const total = tbl.getBoundingClientRect().width;
    const start = [...tbl.querySelectorAll('th[data-col]')].map((th) => (th.getBoundingClientRect().width / total) * 100);
    const cells = [...tbl.querySelectorAll<HTMLElement>(`th[data-col="${i}"], td[data-c="${i}"]`)].filter((c) => (c as HTMLTableCellElement).colSpan <= 1);
    let need = 48;
    for (const cell of cells) {
      const source = cell.querySelector('.cell-text, .cell-empty');
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:max-content;white-space:nowrap;pointer-events:none';
      if (source) probe.innerHTML = source.innerHTML;
      else probe.textContent = cell.textContent ?? '';
      cell.appendChild(probe);
      const cs = getComputedStyle(cell);
      need = Math.max(need, probe.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2);
      probe.remove();
    }
    const min = (48 / total) * 100;
    const pair = start[i]! + start[partner]!;
    const fit = Math.min(pair - min, Math.max(min, (need / total) * 100));
    if (Math.abs(fit - start[i]!) < 0.2) return;
    const next = start.map((w, j) => (j === i ? fit : j === partner ? pair - fit : w));
    setEdge(null);
    void save(rows, columns.map((c, j) => ({ ...c, width: Math.round(next[j]! * 10) / 10 })));
  };

  const edgeOverlay = (() => {
    const tbl = tableRef.current;
    const wrap = wrapRef.current;
    if (!edge || !tbl || !wrap || drag) return null;
    const R = 12; // radius of the "+" button
    const insert = (e: React.MouseEvent) => {
      e.stopPropagation();
      setEdge(null);
      if (edge.kind === 'col') setAddCol({ x: e.clientX, y: e.clientY, index: edge.index });
      else insertRow(edge.index);
    };
    const plus = (style: CSSProperties) => (
      <button
        type="button"
        className="edge-plus"
        style={style}
        title={edge.kind === 'col' ? 'Insert a column here' : 'Insert a row here'}
        aria-label={edge.kind === 'col' ? 'Insert a column here' : 'Insert a row here'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={insert}
      >
        <IconPlusSmall />
      </button>
    );
    // A fixed layer above the page (portal): the line and the "+" sit centered on the edge, also on the
    // table's outer edges, without covering cell text there or making the table area scroll.
    const t = tbl.getBoundingClientRect();
    const Z = 11; // hit zone thickness
    if (edge.kind === 'col') {
      const resizable = edge.index > 0 && edge.index < columns.length;
      const fittable = edge.index > 0 && columns.length > 1;
      return createPortal(
        <div
          className={`edge edge-col${resizable ? ' resizable' : ''}`}
          style={{ left: edge.pos - Z / 2, top: t.top - (resizable ? EDGE_STRIP : 0), width: Z, height: t.height + (resizable ? EDGE_STRIP : 0) }}
          title={resizable ? 'Drag to resize the columns, double-click to fit the column on the left to its content' : fittable ? 'Double-click to fit the last column to its content' : undefined}
          onPointerDown={(e) => startResize(e, edge.index)}
          onDoubleClick={(e) => {
            if (!fittable || (e.target as Element).closest('.edge-plus')) return;
            e.stopPropagation();
            fitColumn(edge.index - 1);
          }}
        >
          <span className="edge-line" style={resizable ? { top: EDGE_STRIP } : undefined} />
          {!resizing.current && plus({ left: Z / 2 - R, top: (resizable ? EDGE_STRIP : 0) + t.height / 2 - R })}
        </div>,
        document.body,
      );
    }
    return createPortal(
      <div className="edge edge-row" style={{ top: edge.pos - Z / 2, left: t.left, height: Z, width: t.width }}>
        <span className="edge-line" />
        {plus({ left: t.width / 2 - R, top: Z / 2 - R })}
      </div>,
      document.body,
    );
  })();

  /** Position of the drop marker (between columns / rows), relative to the table wrapper. */
  const marker = (() => {
    if (!drag || drag.to === null || !tableRef.current || !wrapRef.current) return null;
    const wrap = wrapRef.current.getBoundingClientRect();
    if (drag.kind === 'col') {
      const ths = [...tableRef.current.querySelectorAll('th[data-col]')];
      const ref = ths[Math.min(drag.to, ths.length - 1)]!.getBoundingClientRect();
      const x = drag.to >= ths.length ? ref.right : ref.left;
      return { left: x - wrap.left + wrapRef.current.scrollLeft - 1, top: 0, width: 2, height: tableRef.current.offsetHeight };
    }
    const trs = [...tableRef.current.querySelectorAll('tr[data-row]')];
    if (trs.length === 0) return null;
    const ref = trs[Math.min(drag.to, trs.length - 1)]!.getBoundingClientRect();
    const y = drag.to >= trs.length ? ref.bottom : ref.top;
    return { left: 0, top: y - wrap.top - 1, width: tableRef.current.offsetWidth, height: 2 };
  })();

  // --- selecting a range of cells (drag or shift-click) -----------------------------------
  const anchor = useRef<{ r: number; c: number } | null>(null);
  const cellDown = (e: RPointerEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    if (isMove(e)) {
      e.preventDefault();
      setEditing(null);
      startDrag(e, 'row', r);
      return;
    }
    if (e.shiftKey && anchor.current) {
      e.preventDefault();
      setEditing(null);
      setRange({ r1: anchor.current.r, c1: anchor.current.c, r2: r, c2: c });
      return;
    }
    anchor.current = { r, c };
    // No native text selection: a drag selects cells, a click opens the cell editor.
    e.preventDefault();
    const root = (e.currentTarget as HTMLElement).getRootNode() as Document | ShadowRoot;
    let extended = false;
    const onMove = (ev: PointerEvent) => {
      const td = root.elementFromPoint(ev.clientX, ev.clientY)?.closest('td[data-r]');
      if (!td || !tableRef.current?.contains(td)) return;
      const r2 = Number(td.getAttribute('data-r'));
      const c2 = Number(td.getAttribute('data-c'));
      if (r2 === r && c2 === c && !extended) return;
      extended = true;
      setEditing(null);
      setRange({ r1: r, c1: c, r2, c2 });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!extended) {
        setRange(null);
        setEditing({ row: r, col: c });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  controls.current = {
    rows: () => [],
    columns: () => [],
    moveRow: (_t, from, to) => void save(move(rows, from, to)),
    moveColumn: (_t, from, to) => void save(rows, move(columns, from, to)),
    deleteRow: (_t, i) => void save(rows.filter((_, j) => j !== i)),
    deleteColumn: (_t, i) => removeColumn(i),
    deleteTable: () => onDelete(),
    columnDeleteTitle: (_t, i) => {
      const col = columns[i];
      if (!col || fieldInfo.get(col.field)?.required) return null;
      return col.builtin ? 'Hide column (data is kept)' : 'Delete column';
    },
  };

  const sel = range && norm(range);
  const selected = (r: number, c: number) => !!sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;

  // --- editing ------------------------------------------------------------------------------
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, r: number, c: number) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLTextAreaElement).blur();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setCell(r, c, (e.target as HTMLTextAreaElement).value);
      const next = e.shiftKey ? c - 1 : c + 1;
      if (next >= 0 && next < columns.length) setEditing({ row: r, col: next });
      else if (!e.shiftKey && r + 1 < rows.length) setEditing({ row: r + 1, col: 0 });
      else setEditing(null);
    }
  };

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>, r: number, c: number) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const target = e.currentTarget;
    const path = await saveImage(file);
    if (!path) return;
    const insert = `![${file.name.replace(/\.[^.]+$/, '')}](${path})`;
    setCell(r, c, `${target.value.slice(0, target.selectionStart)}${insert}${target.value.slice(target.selectionEnd)}`);
    setEditing(null);
  };

  const floating = (content: ReactNode, x: number, y: number) =>
    createPortal(
      <div ref={popRef} className="popover grid-popover" style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 220) }} onContextMenu={(e) => e.preventDefault()}>
        {content}
      </div>,
      document.body,
    );

  return (
    <div
      ref={hostRef}
      className={`table-figure data-grid${drag ? ' dragging' : ''}${moveKey ? ' move-mode' : ''}`}
      onPointerMove={(e) => {
        if (isMove(e) !== moveKey) setMoveKey(isMove(e));
        onWrapMove(e);
      }}
      onPointerLeave={() => !resizing.current && setEdge(null)}
    >
      {/* The caption above the table, centered, with room for the column grips between them. */}
      <div className="table-caption">
        <Caption kind="table" value={caption} fallback={table.title} editable={editable && !!onCaption} onChange={(v) => onCaption?.(v)} />
      </div>
      <div className="generated grid-card" ref={cardRef}>
      <div className="table-wrap" ref={wrapRef}>
        <table ref={tableRef} className={widths ? 'fixed' : undefined}>
          {widths && (
            <colgroup>
              {widths.map((w, i) => (
                <col key={columns[i]!.field} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              {columns.map((col, c) => (
                <th
                  key={col.field}
                  data-col={c}
                  className={drag?.kind === 'col' && drag.from === c ? 'moving' : undefined}
                  title={`Click to edit, hold Ctrl and drag to move${fieldInfo.get(col.field)?.values ? `\nValues: ${fieldInfo.get(col.field)!.values!.join(', ')}` : ''}`}
                  onPointerDown={(e) => {
                    if (renaming === c || !isMove(e)) return;
                    e.preventDefault();
                    startDrag(e, 'col', c);
                  }}
                  onClick={(e) => {
                    if (isMove(e) || renaming === c || (e.target as Element).closest('button')) return;
                    setRenaming(c);
                  }}
                  onContextMenu={(e) => headerMenu(e, c)}
                >
                  {renaming === c ? (
                    <>
                      {/* The label stays (hidden) so the header keeps its size; the input lies over it. */}
                      <span className="cell-ghost">{col.label}</span>
                      <input
                      autoFocus
                      className="cell-input"
                      defaultValue={col.label}
                      onFocus={(e) => e.currentTarget.select()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        setRenaming(null);
                        const label = e.target.value.trim();
                        if (label && label !== col.label) void save(rows, columns.map((x, j) => (j === c ? { ...x, label } : x)));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                    </>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} data-row={r} className={drag?.kind === 'row' && drag.from === r ? 'moving' : undefined}>
                {columns.map((col, c) => {
                  const span = spanAt(r, c);
                  if (span && (span.r !== r || span.c !== c)) return null; // covered by a merged cell
                  const value = row[col.field] ?? '';
                  const active = editing?.row === r && editing.col === c;
                  return (
                    <td
                      key={col.field}
                      title={active ? undefined : 'Click to edit, hold Ctrl and drag to move the row'}
                      data-r={r}
                      data-c={c}
                      rowSpan={span?.rows}
                      colSpan={span?.cols}
                      className={`cell${active ? ' editing' : ''}${selected(r, c) ? ' selected' : ''}`}
                      onPointerDown={(e) => !active && cellDown(e, r, c)}
                      onContextMenu={(e) => cellMenu(e, r, c)}
                    >
                      {active ? (
                        <>
                          {/* Editing moves nothing: the cell keeps its content (hidden) for its size and the
                              editor lies over it with the cell's own padding. Once typing starts, the hidden
                              copy follows the text so the cell grows with it. */}
                          {draft === null ? (
                            value ? (
                              <span className="cell-text cell-ghost" dangerouslySetInnerHTML={{ __html: renderCell(value) }} />
                            ) : (
                              <span className="cell-empty cell-ghost">—</span>
                            )
                          ) : (
                            <span className="cell-ghost cell-raw">{`${draft}\u200b`}</span>
                          )}
                          <textarea
                          autoFocus
                          className="cell-input"
                          defaultValue={value}
                          onInput={(e) => setDraft(e.currentTarget.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onBlur={(e) => {
                            setEditing((cur) => (cur?.row === r && cur.col === c ? null : cur));
                            setCell(r, c, e.target.value);
                          }}
                          onKeyDown={(e) => onKey(e, r, c)}
                          onPaste={(e) => void onPaste(e, r, c)}
                        />
                        </>
                      ) : value ? (
                        <span className="cell-text" dangerouslySetInnerHTML={{ __html: renderCell(value) }} />
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {marker && <div className="drop-marker" style={marker} />}
        {edgeOverlay}
      </div>
      <div className="grid-foot">
        <button type="button" className="link-btn" onClick={() => void save([...rows, blankRow()]).then(() => setEditing({ row: rows.length, col: 0 }))}>
          <IconPlusSmall /> Add row
        </button>
        {rows.length === 0 && <span className="muted">No entries yet.</span>}
        {sel && (sel.r2 > sel.r1 || sel.c2 > sel.c1) && (
          <button type="button" className="link-btn" onClick={() => mergeRange(sel)}>
            Merge selected cells
          </button>
        )}
      </div>
      </div>
      {menu &&
        floating(
          menu.items.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                setMenu(null);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          )),
          menu.x,
          menu.y,
        )}
      {addCol &&
        floating(
          <>
            <form
              className="new-col"
              onSubmit={(e) => {
                e.preventDefault();
                addColumn(newColumn, addCol.index);
                setNewColumn('');
                setAddCol(null);
              }}
            >
              <input autoFocus placeholder="New column name" value={newColumn} onChange={(e) => setNewColumn(e.target.value)} aria-label="New column name" />
              <button type="submit" className="btn">
                Add
              </button>
            </form>
            {hidden.length > 0 && <div className="menu-label">Show an arc42 field</div>}
            {hidden.map((f) => (
              <button
                type="button"
                key={f.field}
                className="menu-item"
                onClick={() => {
                  const next = [...columns];
                  next.splice(addCol.index, 0, { field: f.field, label: f.label, builtin: true });
                  setAddCol(null);
                  void save(rows, next);
                }}
              >
                {f.label}
              </button>
            ))}
          </>,
          addCol.x,
          addCol.y,
        )}
    </div>
  );
}
