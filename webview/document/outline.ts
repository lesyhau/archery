// The heading outline of each arc42 section (## and ### inside it) and the outline edits the
// sidebar's contents offer: move a heading with its subsections (also into another section),
// add a peer / a child, promote / demote. Edits run as editor transactions (Ctrl+Z undoes them)
// and are saved like any other edit.
import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { HeadingRef, OutlineEdit } from '../../src/doc/protocol';
import { saveNow } from './context';

export const MIN_LEVEL = 2;
export const MAX_LEVEL = 3;

export interface OutlineItem {
  title: string;
  level: number;
  /** Index among the section's outline headings. */
  index: number;
}

interface Block {
  level: number;
  title: string;
  /** The heading and everything up to the next heading of the same or a higher level. */
  from: number;
  to: number;
}

const isOutline = (node: PMNode) => node.type.name === 'heading' && node.attrs.level >= MIN_LEVEL && node.attrs.level <= MAX_LEVEL;

function blocks(doc: PMNode): Block[] {
  const heads: { pos: number; level: number; node: PMNode }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading') heads.push({ pos: offset, level: Number(node.attrs.level), node });
  });
  const out: Block[] = [];
  heads.forEach((h, i) => {
    if (!isOutline(h.node)) return;
    const end = heads.slice(i + 1).find((n) => n.level <= h.level);
    out.push({ level: h.level, title: h.node.textContent, from: h.pos, to: end ? end.pos : doc.content.size });
  });
  return out;
}

export function outlineOf(editor: Editor): OutlineItem[] {
  return blocks(editor.state.doc).map((b, index) => ({ title: b.title, level: b.level, index }));
}

const clampLevel = (l: number) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, l));

/** The block's content for `target`, with heading levels shifted by `delta` (copied through JSON: every editor has its own schema). */
function shifted(src: Editor, b: Block, target: Editor, delta: number): Fragment {
  const json = src.state.doc.slice(b.from, b.to).content.toJSON() as { type: string; attrs?: { level?: number } }[];
  for (const n of json) {
    if (n.type === 'heading' && n.attrs?.level !== undefined && n.attrs.level >= MIN_LEVEL) n.attrs.level = clampLevel(n.attrs.level + delta);
  }
  return Fragment.fromJSON(target.schema, json);
}

export interface DropTarget {
  editor: Editor;
  /** Insert before outline item `index` (or after its subsections); null = at the end of the section. */
  index: number | null;
  place: 'before' | 'after';
  level: number;
}

/** Moves heading `index` of `src` (with its subsections) to `target`. Returns false when nothing changed. */
export function moveHeading(src: Editor, index: number, target: DropTarget): boolean {
  const b = blocks(src.state.doc)[index];
  if (!b) return false;
  const tBlocks = blocks(target.editor.state.doc);
  const t = target.index === null ? null : tBlocks[target.index];
  if (target.index !== null && !t) return false;
  const pos = t === null ? target.editor.state.doc.content.size : target.place === 'before' ? t!.from : t!.to;
  const fragment = shifted(src, b, target.editor, target.level - b.level);

  if (src === target.editor) {
    if (pos >= b.from && pos <= b.to) {
      // Dropped onto itself: at most a level change.
      if (target.level === b.level) return false;
      return setLevel(src, index, target.level - b.level);
    }
    const tr = src.state.tr;
    if (pos > b.to) {
      tr.insert(pos, fragment);
      tr.delete(b.from, b.to);
    } else {
      tr.delete(b.from, b.to);
      tr.insert(pos, fragment);
    }
    src.view.dispatch(tr.scrollIntoView());
    saveNow(src);
    return true;
  }
  target.editor.view.dispatch(target.editor.state.tr.insert(pos, fragment));
  src.view.dispatch(src.state.tr.delete(b.from, b.to));
  saveNow(target.editor);
  saveNow(src);
  return true;
}

/** Promote (delta -1) / demote (+1) a heading together with its subsections. */
export function setLevel(editor: Editor, index: number, delta: number): boolean {
  const b = blocks(editor.state.doc)[index];
  if (!b || clampLevel(b.level + delta) === b.level) return false;
  const tr = editor.state.tr;
  editor.state.doc.nodesBetween(b.from, b.to, (node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level >= MIN_LEVEL) tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: clampLevel(Number(node.attrs.level) + delta) });
    return false; // top-level nodes only
  });
  editor.view.dispatch(tr);
  saveNow(editor);
  return true;
}

export function canPromote(items: OutlineItem[], index: number): boolean {
  return (items[index]?.level ?? MIN_LEVEL) > MIN_LEVEL;
}

/** Demoting needs a heading above to become the parent. */
export function canDemote(items: OutlineItem[], index: number): boolean {
  const it = items[index];
  return !!it && it.level < MAX_LEVEL && items.slice(0, index).some((p) => p.level === it.level);
}

/**
 * Adds a new heading after heading `index` and its subsections: a peer (same level) or a child
 * (one level down). index null = a new top-level subsection at the end of the section.
 * The new title is selected so typing replaces it.
 */
export function addHeading(editor: Editor, index: number | null, kind: 'peer' | 'child'): boolean {
  const all = blocks(editor.state.doc);
  const b = index === null ? null : all[index];
  if (index !== null && !b) return false;
  const level = b ? (kind === 'peer' ? b.level : b.level + 1) : MIN_LEVEL;
  if (level > MAX_LEVEL) return false;
  const pos = b ? b.to : editor.state.doc.content.size;
  const title = 'New heading';
  const node = editor.schema.nodes.heading!.create({ level }, editor.schema.text(title));
  const tr = editor.state.tr.insert(pos, node);
  tr.setSelection(TextSelection.create(tr.doc, pos + 1, pos + 1 + title.length));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  saveNow(editor);
  return true;
}

// --- edits from the sidebar's contents --------------------------------------------------------

/** Heading text without Markdown marks, for comparing the sidebar's titles with the editor's. */
const plain = (s: string) => s.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The editor and current index of a heading the sidebar names. The sidebar reads the saved Markdown,
 * which can be a moment behind the page: the title decides when the index no longer points at it.
 */
function locate(editors: Map<string, Editor>, ref: HeadingRef): { editor: Editor; index: number; level: number; items: OutlineItem[] } | null {
  const editor = editors.get(ref.sectionId);
  if (!editor) return null;
  const items = outlineOf(editor);
  const title = plain(ref.title);
  let index = plain(items[ref.index]?.title ?? '') === title ? ref.index : -1;
  if (index < 0) {
    const same = items.filter((it) => plain(it.title) === title);
    if (same.length === 1) index = same[0]!.index;
  }
  if (index < 0 && ref.index < items.length) index = ref.index;
  return index < 0 ? null : { editor, index, level: items[index]!.level, items };
}

/** Runs an outline edit from the sidebar; false when the chapter is not (yet) in the page or nothing changed. */
export function applyOutlineEdit(editors: Map<string, Editor>, edit: OutlineEdit): boolean {
  switch (edit.kind) {
    case 'add': {
      if (!edit.at) {
        const editor = editors.get(edit.sectionId);
        return !!editor && addHeading(editor, null, 'peer');
      }
      const at = locate(editors, edit.at);
      return !!at && addHeading(at.editor, at.index, edit.child ? 'child' : 'peer');
    }
    case 'level': {
      const h = locate(editors, edit.heading);
      if (!h) return false;
      if (edit.delta < 0 ? !canPromote(h.items, h.index) : !canDemote(h.items, h.index)) return false;
      return setLevel(h.editor, h.index, edit.delta);
    }
    case 'move': {
      const h = locate(editors, edit.heading);
      if (!h) return false;
      if (edit.before) {
        const t = locate(editors, edit.before);
        if (!t) return false;
        // Onto itself or one of its own subheadings: nothing to move.
        if (t.editor === h.editor && t.index >= h.index && h.items.slice(h.index + 1, t.index + 1).every((it) => it.level > h.level)) return false;
        return moveHeading(h.editor, h.index, { editor: t.editor, index: t.index, place: 'before', level: t.level });
      }
      const into = edit.into ? editors.get(edit.into) : undefined;
      return !!into && moveHeading(h.editor, h.index, { editor: into, index: null, place: 'after', level: MIN_LEVEL });
    }
  }
}
