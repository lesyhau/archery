// Row / column controls outside a table, shared by data tables (DataGrid) and Markdown tables
// (ProseMirror). While the pointer is over a table (or the strips around it):
//  - a grip left of the hovered row and above the hovered column: drag it to move the row / column
//  - a delete button right of the row and below the column, centered on them
//  - a delete-table button (X) at the top right (right-aligned with the table), on the line of the column grips
//  - near a line between rows / columns (when the table offers it): the line lights up with a "+" in its
//    middle that inserts a row / column there
// Plain DOM (a layer inside `host`), so it works inside the ProseMirror view as well as in React.

export interface TableActions {
  /** The frame the controls sit around (the bordered box); defaults to the table. */
  frame?(table: HTMLTableElement): HTMLElement | { getBoundingClientRect(): DOMRect };
  /** Rows with controls, in order; callbacks get indices into this list. */
  rows(table: HTMLTableElement): HTMLElement[];
  /** Header cells, one per column; callbacks get indices into this list. */
  columns(table: HTMLTableElement): HTMLElement[];
  /** Moves a row / column to a boundary (0 = before the first, n = after the last). */
  moveRow(table: HTMLTableElement, from: number, to: number): void;
  moveColumn(table: HTMLTableElement, from: number, to: number): void;
  deleteRow(table: HTMLTableElement, index: number): void;
  deleteColumn(table: HTMLTableElement, index: number): void;
  deleteTable(table: HTMLTableElement): void;
  /** Inserts a row / column at a boundary (0 = before the first, n = after the last); optional. */
  insertRow?(table: HTMLTableElement, at: number): void;
  insertColumn?(table: HTMLTableElement, at: number): void;
  /** Tooltip of a column's delete button; null: the column cannot be deleted. */
  columnDeleteTitle?(table: HTMLTableElement, index: number): string | null;
  deleteTableTitle?: string;
}

const NS = 'http://www.w3.org/2000/svg';
const dots = (vertical: boolean) => {
  const pts = vertical ? [[6, 4], [10, 4], [6, 8], [10, 8], [6, 12], [10, 12]] : [[4, 6], [8, 6], [12, 6], [4, 10], [8, 10], [12, 10]];
  return `<svg xmlns="${NS}" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="currentColor"/>`).join('')}</svg>`;
};
const cross = `<svg xmlns="${NS}" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 4.5l7 7 M11.5 4.5l-7 7"/></svg>`;

/** How far around the frame the controls (and the hover zone) reach. */
const GUTTER = 26;

export function tableControls(host: HTMLElement, tables: () => HTMLTableElement[], actions: TableActions, enabled: () => boolean): { destroy(): void } {
  const layer = document.createElement('div');
  layer.className = 'tc-layer';
  layer.contentEditable = 'false';
  const button = (cls: string, html: string, title: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tc-btn ${cls}`;
    b.innerHTML = html;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.tabIndex = -1;
    // Keep the editor's selection and focus where they are.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    layer.append(b);
    return b;
  };
  const rowGrip = button('tc-grip tc-row-grip', dots(true), 'Drag to move the row');
  const rowDel = button('tc-del tc-row-del', cross, 'Delete row');
  const colGrip = button('tc-grip tc-col-grip', dots(false), 'Drag to move the column');
  const colDel = button('tc-del tc-col-del', cross, 'Delete column');
  const tableDel = button('tc-del tc-table-del', cross, actions.deleteTableTitle ?? 'Delete table');
  const marker = document.createElement('div');
  marker.className = 'tc-marker';
  layer.append(marker);
  const edgeLine = document.createElement('div');
  edgeLine.className = 'tc-edge';
  layer.append(edgeLine);
  const plus = button('tc-plus', `<svg xmlns="${NS}" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3.5v9 M3.5 8h9"/></svg>`, 'Insert');
  host.append(layer);

  type Edge = { kind: 'row' | 'col'; index: number; pos: number };
  let current: { table: HTMLTableElement; row: number | null; col: number | null; edge: Edge | null } | null = null;
  let dragging = false;

  const show = (el: HTMLElement, x: number, y: number) => {
    el.style.display = 'flex';
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  };
  const hideAll = () => {
    for (const el of [rowGrip, rowDel, colGrip, colDel, tableDel, marker, edgeLine, plus]) el.style.display = 'none';
  };
  hideAll();

  const frameOf = (t: HTMLTableElement) => (actions.frame?.(t) ?? t).getBoundingClientRect();
  /** Visible horizontal extent of a column (a scrolled-away column has none). */
  const colSpan = (cell: HTMLElement, f: DOMRect) => {
    const r = cell.getBoundingClientRect();
    const left = Math.max(r.left, f.left);
    const right = Math.min(r.right, f.right);
    return right - left > 8 ? { left, right } : null;
  };

  const place = () => {
    hideAll();
    if (!current || !enabled()) return;
    const { table } = current;
    const h = host.getBoundingClientRect();
    const f = frameOf(table);
    const tdTitle = actions.deleteTableTitle ?? 'Delete table';
    tableDel.title = tdTitle;
    // Top right, on the line of the column grips, right-aligned with the table.
    show(tableDel, f.right - 20 - h.left, f.top - 24 - h.top);
    const edge = current.edge;
    if (edge) {
      // The line between rows / columns, with the "+" in its middle.
      if (edge.kind === 'col') {
        Object.assign(edgeLine.style, { display: 'block', left: `${edge.pos - h.left - 1}px`, top: `${f.top - h.top}px`, width: '2px', height: `${f.height}px` });
        show(plus, edge.pos - h.left - 10, f.top + f.height / 2 - h.top - 10);
        plus.title = 'Insert a column here';
      } else {
        Object.assign(edgeLine.style, { display: 'block', left: `${f.left - h.left}px`, top: `${edge.pos - h.top - 1}px`, width: `${f.width}px`, height: '2px' });
        show(plus, f.left + f.width / 2 - h.left - 10, edge.pos - h.top - 10);
        plus.title = 'Insert a row here';
      }
      plus.setAttribute('aria-label', plus.title);
    }
    const rows = actions.rows(table);
    if (current.row !== null && rows[current.row]) {
      const r = rows[current.row]!.getBoundingClientRect();
      const cy = r.top + r.height / 2 - h.top;
      show(rowGrip, f.left - 24 - h.left, cy - 10);
      show(rowDel, f.right + 4 - h.left, cy - 10);
    }
    const cols = actions.columns(table);
    if (current.col !== null && cols[current.col]) {
      const span = colSpan(cols[current.col]!, f);
      if (span) {
        const cx = (span.left + span.right) / 2 - h.left;
        show(colGrip, cx - 10, f.top - 24 - h.top);
        const title = actions.columnDeleteTitle ? actions.columnDeleteTitle(table, current.col) : 'Delete column';
        if (title) {
          colDel.title = title;
          colDel.setAttribute('aria-label', title);
          show(colDel, cx - 10, f.bottom + 4 - h.top);
        }
      }
    }
  };

  /** The table under the pointer (with its gutters) and the row / column there. */
  const hit = (x: number, y: number) => {
    for (const table of tables()) {
      if (!table.isConnected) continue;
      const f = frameOf(table);
      if (x < f.left - GUTTER || x > f.right + GUTTER || y < f.top - GUTTER || y > f.bottom + GUTTER) continue;
      const rowIndex = actions.rows(table).findIndex((r) => {
        const b = r.getBoundingClientRect();
        return y >= b.top && y < b.bottom;
      });
      const colIndex = actions.columns(table).findIndex((c) => {
        const s = colSpan(c, f);
        return !!s && x >= s.left && x < s.right;
      });
      // A line between rows / columns within 5px (inside the table).
      let edge: Edge | null = null;
      if (x >= f.left && x <= f.right && y >= f.top && y <= f.bottom) {
        const near = (list: number[], v: number) => list.reduce<{ i: number; d: number } | null>((best, p, i) => (Math.abs(v - p) <= 5 && (!best || Math.abs(v - p) < best.d) ? { i, d: Math.abs(v - p) } : best), null);
        const rowRects = actions.rows(table).map((r) => r.getBoundingClientRect());
        const colRects = actions.columns(table).map((c) => c.getBoundingClientRect());
        const ys = actions.insertRow && rowRects.length ? [rowRects[0]!.top, ...rowRects.map((r) => r.bottom)] : [];
        const xs = actions.insertColumn && colRects.length ? [colRects[0]!.left, ...colRects.map((r) => r.right)] : [];
        const r = near(ys, y);
        const c = near(xs, x);
        if (c && (!r || c.d <= r.d)) edge = { kind: 'col', index: c.i, pos: xs[c.i]! };
        else if (r) edge = { kind: 'row', index: r.i, pos: ys[r.i]! };
      }
      return { table, row: rowIndex < 0 ? null : rowIndex, col: colIndex < 0 ? null : colIndex, edge };
    }
    return null;
  };

  let frame = 0;
  let last: { x: number; y: number } | null = null;
  const update = () => {
    frame = 0;
    if (dragging || !last) return;
    const next = enabled() ? hit(last.x, last.y) : null;
    // Over a control: keep the row / column it belongs to.
    const over = document.elementFromPoint(last.x, last.y);
    if (over && layer.contains(over) && current) return;
    current = next;
    place();
  };
  const onMove = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(update);
  };
  const onScroll = () => {
    if (!dragging && current) place();
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('scroll', onScroll, true);
  // A row growing while you type moves the buttons below it.
  const resized = new ResizeObserver(() => !dragging && current && place());
  resized.observe(host);

  // --- dragging a grip ----------------------------------------------------------------------
  const startDrag = (e: PointerEvent, axis: 'row' | 'col') => {
    if (e.button !== 0 || !current) return;
    const index = axis === 'row' ? current.row : current.col;
    if (index === null) return;
    e.preventDefault();
    const { table } = current;
    const items = axis === 'row' ? actions.rows(table) : actions.columns(table);
    dragging = true;
    document.documentElement.classList.add('tc-dragging');
    let to: number | null = null;
    const move = (ev: PointerEvent) => {
      const h = host.getBoundingClientRect();
      const f = frameOf(table);
      const rects = items.map((el) => el.getBoundingClientRect());
      const v = axis === 'row' ? ev.clientY : ev.clientX;
      // The nearest boundary between items.
      const bounds = axis === 'row' ? [rects[0]!.top, ...rects.map((r) => r.bottom)] : [rects[0]!.left, ...rects.map((r) => r.right)];
      let best = 0;
      bounds.forEach((b, i) => Math.abs(b - v) < Math.abs(bounds[best]! - v) && (best = i));
      to = best;
      marker.style.display = 'block';
      if (axis === 'row') Object.assign(marker.style, { left: `${f.left - h.left}px`, top: `${bounds[best]! - h.top - 1}px`, width: `${f.width}px`, height: '2px' });
      else Object.assign(marker.style, { left: `${bounds[best]! - h.left - 1}px`, top: `${f.top - h.top}px`, width: '2px', height: `${f.height}px` });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.documentElement.classList.remove('tc-dragging');
      dragging = false;
      current = null;
      hideAll();
      if (to === null || to === index || to === index + 1) return;
      if (axis === 'row') actions.moveRow(table, index, to);
      else actions.moveColumn(table, index, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  rowGrip.addEventListener('pointerdown', (e) => startDrag(e, 'row'));
  colGrip.addEventListener('pointerdown', (e) => startDrag(e, 'col'));

  const act = (fn: (t: HTMLTableElement) => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!current) return;
    const t = current.table;
    current = null;
    hideAll();
    fn(t);
  };
  const atRow = () => current?.row ?? null;
  const atCol = () => current?.col ?? null;
  rowDel.addEventListener('click', (e) => {
    const i = atRow();
    if (i !== null) act((t) => actions.deleteRow(t, i))(e);
  });
  colDel.addEventListener('click', (e) => {
    const i = atCol();
    if (i !== null) act((t) => actions.deleteColumn(t, i))(e);
  });
  tableDel.addEventListener('click', act((t) => actions.deleteTable(t)));
  plus.addEventListener('click', (e) => {
    const edge = current?.edge;
    if (!edge) return;
    act((t) => (edge.kind === 'row' ? actions.insertRow?.(t, edge.index) : actions.insertColumn?.(t, edge.index)))(e);
  });

  return {
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll, true);
      resized.disconnect();
      layer.remove();
    },
  };
}
