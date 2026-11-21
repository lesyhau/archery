// TipTap extensions that define the document schema of a section. Shared by the
// document webview (which adds React node views on top) and the Markdown tests.
//
// Besides standard Markdown, a section contains documentation directives stored as HTML
// comments, which become atom nodes in the editor:
//   <!-- archery:help ... -->                       archeryHelp      (template guidance, read-only)
//   <!-- archery:diagram diagrams/x.uml.json ... --> archeryDiagram   (a figure: resizable, collapsible)
//   <!-- archery:table data/x.yaml#key caption="..." --> archeryTable (table generated from a data list)
//   <!-- archery:caption "..." -->                   the caption of the Markdown table right after it
//   <!-- archery:decisions decisions -->             archeryDecisions (index of the ADRs)
// Any other raw HTML block is kept verbatim as rawHtml.
import { Extension, Node, mergeAttributes, type Extensions } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Table, TableKit, type TableView } from '@tiptap/extension-table';
import { StarterKit } from '@tiptap/starter-kit';

const atom = { group: 'block', atom: true, selectable: true, draggable: true } as const;

export const ArcheryHelp = Node.create({
  name: 'archeryHelp',
  ...atom,
  draggable: false,
  addAttributes: () => ({ text: { default: '' } }),
  parseHTML: () => [{ tag: 'archery-help' }],
  renderHTML: ({ HTMLAttributes }) => ['archery-help', mergeAttributes(HTMLAttributes)],
});

export interface DiagramAttrs {
  src: string;
  /** CSS width, e.g. "640px" or "80%". null = full column width. */
  width: string | null;
  /** Frame height in px. null = natural height of the diagram. */
  height: number | null;
  collapsed: boolean;
  caption: string | null;
}

export const ArcheryDiagram = Node.create({
  name: 'archeryDiagram',
  ...atom,
  addAttributes: () => ({
    src: { default: '' },
    width: { default: null },
    height: { default: null },
    collapsed: { default: false },
    caption: { default: null },
  }),
  parseHTML: () => [{ tag: 'archery-diagram' }],
  renderHTML: ({ HTMLAttributes }) => ['archery-diagram', mergeAttributes(HTMLAttributes)],
});

export const ArcheryTable = Node.create({
  name: 'archeryTable',
  ...atom,
  // Not draggable as a block: dragging inside it moves columns and rows.
  draggable: false,
  // caption: the table's title (null = the data list's name). Numbering ("Table 3") is automatic.
  addAttributes: () => ({ src: { default: '' }, caption: { default: null } }),
  parseHTML: () => [{ tag: 'archery-table' }],
  renderHTML: ({ HTMLAttributes }) => ['archery-table', mergeAttributes(HTMLAttributes)],
});

export const ArcheryDecisions = Node.create({
  name: 'archeryDecisions',
  ...atom,
  draggable: false,
  addAttributes: () => ({ src: { default: 'decisions' } }),
  parseHTML: () => [{ tag: 'archery-decisions' }],
  renderHTML: ({ HTMLAttributes }) => ['archery-decisions', mergeAttributes(HTMLAttributes)],
});

export const RawHtml = Node.create({
  name: 'rawHtml',
  ...atom,
  addAttributes: () => ({ html: { default: '' } }),
  parseHTML: () => [{ tag: 'archery-raw-html' }],
  renderHTML: ({ HTMLAttributes }) => ['archery-raw-html', mergeAttributes(HTMLAttributes)],
});

/** Markdown lists are written tight (no blank lines between items). */
const TightLists = Extension.create({
  name: 'tightLists',
  addGlobalAttributes: () => [
    { types: ['bulletList', 'orderedList'], attributes: { tight: { default: true, rendered: false } } },
  ],
});

/** Markdown tables with an optional caption (stored as `<!-- archery:caption "..." -->` before the table). */
export const CaptionedTable = Table.extend({
  addAttributes() {
    return { ...this.parent?.(), caption: { default: null, rendered: false } };
  },
});

/**
 * The schema-defining extensions (no UI behavior). `tableView`: the view that draws Markdown tables
 * in an editor (the document view adds its "Add row" line with it).
 */
export function sectionExtensions(opts: { tableView?: typeof TableView } = {}): Extensions {
  return [
    StarterKit.configure({
      underline: false, // no Markdown equivalent
      link: { openOnClick: false, autolink: true },
      trailingNode: false,
    }),
    TableKit.configure({ table: false }),
    CaptionedTable.configure({ resizable: false, ...(opts.tableView ? { View: opts.tableView } : {}) }),
    Image.configure({ inline: true }),
    TightLists,
    ArcheryHelp,
    ArcheryDiagram,
    ArcheryTable,
    ArcheryDecisions,
    RawHtml,
  ];
}
