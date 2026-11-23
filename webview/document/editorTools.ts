// Editor helpers for the document view: arc42 guidance icons in headings, image paste/drop,
// and moving rows/columns of Markdown tables.
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TableView } from '@tiptap/extension-table';
import { captionElement } from './Caption';
import { saveImage } from './context';
import { tableControls } from './tableControls';
import { codiconHtml } from '../shared/codicon';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The info icon with its tooltip (plain DOM: it lives inside the ProseMirror view). */
function helpWidget(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-icon';
  el.contentEditable = 'false';
  el.tabIndex = 0;
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', 'arc42 guidance');
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => {
      const m = /^(Contents|Motivation|Form[^:]*|Structure|Black box template[^:]*):\s*([\s\S]*)$/.exec(p);
      const body = esc(m ? m[2]! : p).replace(/\n/g, '<br>');
      return `<p>${m ? `<strong>${esc(m[1]!)}:</strong> ` : ''}${body}</p>`;
    })
    .join('');
  el.innerHTML = `${codiconHtml('info')}<span class="help-pop" role="tooltip"><span class="help-pop-title">arc42 guidance</span>${paragraphs}</span>`;
  // Keep clicks on the icon from moving the caret into the heading.
  el.addEventListener('mousedown', (e) => e.preventDefault());
  return el;
}

/**
 * arc42 guidance pop-ups (every `.help-icon` on the page): pointing at, focusing or clicking the icon
 * opens its pop-up, which then stays open (to read it, scroll, move the pointer away) until a click
 * outside it or Esc. One is open at a time. Returns the uninstaller.
 */
export function installHelpPopups(): () => void {
  const iconOf = (e: Event) => ((e.composedPath()[0] ?? e.target) as Element | null)?.closest?.('.help-icon') ?? null;
  const closeAll = (except?: Element) => document.querySelectorAll('.help-icon.open').forEach((el) => el !== except && el.classList.remove('open'));
  const open = (e: Event) => {
    const icon = iconOf(e);
    if (!icon || icon.classList.contains('open')) return;
    closeAll(icon);
    icon.classList.add('open');
  };
  const outside = (e: Event) => {
    if (!iconOf(e)) closeAll();
  };
  const escape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeAll();
  };
  document.addEventListener('mouseover', open);
  document.addEventListener('focusin', open);
  document.addEventListener('click', open);
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', escape);
  return () => {
    document.removeEventListener('mouseover', open);
    document.removeEventListener('focusin', open);
    document.removeEventListener('click', open);
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', escape);
  };
}

/** Shows `<!-- archery:help -->` blocks as an info icon at the end of the heading above them. */
export const HelpIcons = Extension.create({
  name: 'helpIcons',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('helpIcons'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            const doc = state.doc;
            doc.forEach((node, offset, index) => {
              if (node.type.name !== 'heading' || index + 1 >= doc.childCount) return;
              const next = doc.child(index + 1);
              if (next.type.name !== 'archeryHelp') return;
              const text = String(next.attrs.text ?? '');
              decorations.push(Decoration.widget(offset + node.nodeSize - 1, () => helpWidget(text), { side: 1, ignoreSelection: true, key: `help:${text.length}:${text.slice(0, 40)}` }));
            });
            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

/**
 * "Table N: caption" above every Markdown table (data tables draw their own). The caption is the
 * table's `caption` attribute, edited in place; the number is a document-wide CSS counter.
 */
export const TableCaptions = Extension.create({
  name: 'tableCaptions',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('tableCaptions'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'table') return true;
              const caption = (node.attrs.caption as string | null) ?? null;
              decorations.push(
                Decoration.widget(
                  pos,
                  (view, getPos) =>
                    captionElement('table', caption, (next) => {
                      const at = getPos();
                      const table = at === undefined ? null : view.state.doc.nodeAt(at);
                      if (at === undefined || table?.type.name !== 'table') return;
                      view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...table.attrs, caption: next }));
                      (editor.storage as unknown as Record<string, { save?: () => void }>).archerySave?.save?.();
                    }),
                  { side: -1, ignoreSelection: true, stopEvent: () => true, key: `cap:${caption ?? ''}` },
                ),
              );
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

const imageFiles = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'));

/** Saves image files to images/ and inserts them (at `pos`, or at the selection). */
export async function insertImages(editor: Editor, files: File[], pos?: number): Promise<void> {
  for (const file of files) {
    const path = await saveImage(file);
    if (!path || editor.isDestroyed) continue;
    // Section files live in sections/, so the Markdown path is ../images/...
    const node = { type: 'image', attrs: { src: `../${path}`, alt: file.name.replace(/\.[^.]+$/, '') } };
    if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
    else editor.chain().focus().insertContent(node).run();
  }
  const storage = (editor.storage as unknown as Record<string, { save?: () => void }>).archerySave;
  storage?.save?.();
}

/** Paste or drop image files into a section. */
export const ImageDrop = Extension.create({
  name: 'imageDrop',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('imageDrop'),
        props: {
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) return false;
            void insertImages(editor, files);
            return true;
          },
          handleDrop: (view, event) => {
            const files = imageFiles(event.dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void insertImages(editor, files, pos);
            return true;
          },
        },
      }),
    ];
  },
});

/** Moves the table row (axis 'row') or column (axis 'col') containing the cursor by `delta`. */
export function moveTablePart(editor: Editor, axis: 'row' | 'col', delta: number): void {
  const { state } = editor;
  const $from = state.selection.$from;
  let tableDepth = -1;
  let rowIndex = -1;
  let cellIndex = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') cellIndex = $from.index(d - 1);
    if (name === 'tableRow') rowIndex = $from.index(d - 1);
    if (name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth < 0 || rowIndex < 0 || cellIndex < 0) return;
  const table = $from.node(tableDepth);
  const tablePos = $from.before(tableDepth);
  const json = table.toJSON() as { content: { content: { type: string }[] }[] };
  const rows = json.content;
  const headerRow = rows[0]?.content.every((c) => c.type === 'tableHeader') ?? false;
  let targetRow = rowIndex;
  let targetCol = cellIndex;
  if (axis === 'row') {
    targetRow = rowIndex + delta;
    if (targetRow < 0 || targetRow >= rows.length) return;
    [rows[rowIndex], rows[targetRow]] = [rows[targetRow]!, rows[rowIndex]!];
    // The first row stays the header row, whatever moved into it.
    if (headerRow) rows.forEach((row, i) => row.content.forEach((cell) => (cell.type = i === 0 ? 'tableHeader' : 'tableCell')));
  } else {
    targetCol = cellIndex + delta;
    if (rows.some((row) => targetCol < 0 || targetCol >= row.content.length)) return;
    for (const row of rows) [row.content[cellIndex], row.content[targetCol]] = [row.content[targetCol]!, row.content[cellIndex]!];
  }
  const next = state.schema.nodeFromJSON(json);
  const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, next);
  // Put the cursor into the moved cell.
  let pos = tablePos + 1;
  for (let r = 0; r < targetRow; r++) pos += next.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < targetCol; c++) pos += next.child(targetRow).child(c).nodeSize;
  pos += 2;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
  editor.view.dispatch(tr);
  editor.view.focus();
}

// --- row / column controls outside Markdown tables -------------------------------------------

/** The table node a rendered <table> belongs to. */
function tableAt(editor: Editor, el: HTMLTableElement): { pos: number; node: import('@tiptap/pm/model').Node } | null {
  const cell = el.querySelector('td, th');
  if (!cell) return null;
  const $pos = editor.view.state.doc.resolve(editor.view.posAtDOM(cell, 0));
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'table') return { pos: $pos.before(d), node: $pos.node(d) };
  return null;
}

const saveSection = (editor: Editor) => (editor.storage as unknown as Record<string, { save?: () => void }>).archerySave?.save?.();

/** Whether the table's first row is its header row (Markdown tables always have one). */
const headerOffset = (el: HTMLTableElement) => (el.rows[0] && [...el.rows[0].cells].every((c) => c.tagName === 'TH') ? 1 : 0);

/** Moves row / column `from` (an index among the table's rows / first-row cells) to boundary `to`. */
function reorderTable(editor: Editor, el: HTMLTableElement, axis: 'row' | 'col', from: number, to: number): void {
  const found = tableAt(editor, el);
  if (!found) return;
  const json = found.node.toJSON() as { content: { content: { type: string }[] }[] };
  const shift = <T,>(list: T[]) => {
    const [item] = list.splice(from, 1);
    list.splice(to > from ? to - 1 : to, 0, item!);
  };
  if (axis === 'row') shift(json.content);
  else {
    if (json.content.some((row) => row.content.length !== json.content[0]!.content.length)) return; // merged cells: not by column
    for (const row of json.content) shift(row.content);
  }
  const { state } = editor.view;
  editor.view.dispatch(state.tr.replaceWith(found.pos, found.pos + found.node.nodeSize, state.schema.nodeFromJSON(json)));
  saveSection(editor);
}

/** Puts the cursor into cell (row, col) of the table, then runs a table command there. */
function inCell(editor: Editor, el: HTMLTableElement, row: number, col: number, command: (e: Editor) => boolean): void {
  const found = tableAt(editor, el);
  if (!found) return;
  let pos = found.pos + 1;
  for (let r = 0; r < row; r++) pos += found.node.child(r).nodeSize;
  const rowNode = found.node.child(row);
  pos += 1;
  for (let c = 0; c < Math.min(col, rowNode.childCount - 1); c++) pos += rowNode.child(c).nodeSize;
  const { state } = editor.view;
  editor.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 1))));
  if (command(editor)) saveSection(editor);
}

/**
 * Markdown tables keep their column widths while you type: the widths the content gives when the table
 * appears (or its number of columns changes) are fixed (CSS variables on the wrapper, see document.css).
 * Markdown cannot store widths, so they are measured again from the content next time.
 */
function freezeColumns(table: HTMLTableElement): void {
  const wrapper = table.closest<HTMLElement>('.tableWrapper');
  const first = table.rows[0];
  if (!wrapper || !first) return;
  const cells = [...first.cells];
  if (cells.some((c) => c.colSpan > 1)) {
    delete wrapper.dataset.cols; // merged header cells: automatic layout
    return;
  }
  if (wrapper.dataset.cols === String(cells.length)) return;
  wrapper.classList.add('tc-measuring');
  const total = table.getBoundingClientRect().width;
  const widths = cells.map((c) => c.getBoundingClientRect().width);
  wrapper.classList.remove('tc-measuring');
  if (total <= 0) return; // not laid out yet
  widths.forEach((w, i) => wrapper.style.setProperty(`--tc-col-${i + 1}`, `${((w / total) * 100).toFixed(2)}%`));
  wrapper.dataset.cols = String(cells.length);
}

/**
 * Markdown tables drawn with an "+ Add row" line at the bottom of their box, as under the data tables.
 * The line is part of the table's own frame (the wrapper), so it cannot drift away from the table.
 */
export class TableWithFoot extends TableView {
  readonly foot: HTMLElement;

  constructor(node: PMNode, cellMinWidth: number, view: EditorView, attrs?: Record<string, unknown>) {
    super(node, cellMinWidth, view, attrs);
    this.foot = document.createElement('div');
    this.foot.className = 'md-table-foot';
    this.foot.contentEditable = 'false';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-btn';
    button.innerHTML = `${codiconHtml('add')} Add row`;
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      // Tiptap keeps its editor on the editor's element.
      const editor = (view.dom as HTMLElement & { editor?: Editor }).editor;
      if (!editor?.isEditable) return;
      const rows = this.table.rows.length;
      inCell(editor, this.table, rows - 1, 0, (e) => e.commands.addRowAfter());
      // The cursor goes into the first cell of the new row.
      inCell(editor, this.table, rows, 0, () => false);
      editor.view.focus();
    });
    this.foot.append(button);
    this.dom.append(this.foot);
  }

  stopEvent(event: Event): boolean {
    return this.foot.contains(event.target as Node);
  }
}

/** Grips and delete buttons around Markdown tables, "+" on the lines between rows / columns (see tableControls.ts). */
export const TableControls = Extension.create({
  name: 'tableControls',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('tableControls'),
        view(view) {
          const host = view.dom.parentElement;
          if (!host) return {};
          host.classList.add('tc-host');
          const controls = tableControls(
            host,
            () => [...view.dom.querySelectorAll<HTMLTableElement>('.tableWrapper > table')],
            {
              // The bordered box, with the "Add row" line in it.
              frame: (t) => (t.closest('.tableWrapper') as HTMLElement | null) ?? t,
              rows: (t) => [...t.rows].slice(headerOffset(t)),
              columns: (t) => (t.rows[0] ? [...t.rows[0].cells] : []),
              moveRow: (t, from, to) => reorderTable(editor, t, 'row', from + headerOffset(t), to + headerOffset(t)),
              moveColumn: (t, from, to) => reorderTable(editor, t, 'col', from, to),
              deleteRow: (t, i) => inCell(editor, t, i + headerOffset(t), 0, (e) => e.commands.deleteRow()),
              deleteColumn: (t, i) => inCell(editor, t, 0, i, (e) => e.commands.deleteColumn()),
              deleteTable: (t) => inCell(editor, t, 0, 0, (e) => e.commands.deleteTable()),
              insertRow: (t, at) => {
                const off = headerOffset(t);
                const n = t.rows.length - off;
                if (at < n) inCell(editor, t, at + off, 0, (e) => e.commands.addRowBefore());
                else inCell(editor, t, t.rows.length - 1, 0, (e) => e.commands.addRowAfter());
              },
              insertColumn: (t, at) => {
                const m = t.rows[0]?.cells.length ?? 0;
                if (at < m) inCell(editor, t, 0, at, (e) => e.commands.addColumnBefore());
                else inCell(editor, t, 0, m - 1, (e) => e.commands.addColumnAfter());
              },
            },
            () => editor.isEditable,
          );
          const freezeAll = () => view.dom.querySelectorAll<HTMLTableElement>('.tableWrapper > table').forEach(freezeColumns);
          requestAnimationFrame(freezeAll);
          return { update: freezeAll, destroy: () => controls.destroy() };
        },
      }),
    ];
  },
});

// --- live view: highlight a block an agent just changed ------------------------------------

const flashKey = new PluginKey<DecorationSet>('liveFlash');

/** Highlights a top-level block for a moment (a decoration: ProseMirror redraws its own DOM). */
export function flashBlock(editor: Editor, pos: number): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.setMeta(flashKey, { from: pos, to: pos + node.nodeSize }));
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.setTimeout(() => !editor.isDestroyed && editor.view.dispatch(editor.state.tr.setMeta(flashKey, null)), 2200);
}

export const LiveFlash = Extension.create({
  name: 'liveFlash',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(flashKey) as { from: number; to: number } | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) return DecorationSet.create(tr.doc, [Decoration.node(meta.from, meta.to, { class: 'live-change' })]);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return flashKey.getState(state);
          },
        },
      }),
    ];
  },
});
