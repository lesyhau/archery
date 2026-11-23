// Messages between the extension and the document webview (the rendered, editable
// architecture document). Everything the page shows is sent in one DocumentData snapshot.
import type { CanvasDiagram, ExportSettings, Model, SequenceDiagram, TimingDiagram } from '../model/schema';
import type { CanvasSettings } from '../protocol';
import type { AdrPart } from './adr';

export interface DocSection {
  id: string;
  number?: number;
  title: string;
  /** Relative to the documentation root. */
  file: string;
  markdown: string;
  enabled: boolean;
}

export type DocDiagram =
  | { kind: 'canvas'; title: string; diagram: CanvasDiagram; text: string }
  | { kind: 'sequence'; title: string; diagram: SequenceDiagram; text: string }
  | { kind: 'timing'; title: string; diagram: TimingDiagram; text: string }
  | { kind: 'missing'; message: string };

export interface DocTable {
  /** List name (see src/doc/dataLists.ts), used by the write_data_table operation. */
  list: string;
  title: string;
  /** Data file the table is stored in (relative to the root), and the list's key in it. */
  file: string;
  key: string;
  keyField: string;
  /** `views.<key>.fit: auto`: the export fits the column widths to the content (src/export/tableFit.ts). */
  fit?: 'auto';
  /** Visible columns, in order. `builtin` = a field of the arc42 list (not a custom column). */
  columns: { field: string; label: string; builtin: boolean; width?: number }[];
  /** All known fields of the list (also the hidden ones that can be shown). */
  fields: { field: string; label: string; required: boolean; values?: string[] }[];
  /** Every item with all its fields as editable text. */
  rows: Record<string, string>[];
  /** Merged cells: anchored at the row whose key field is `row`, in column `field`. */
  merges: TableMerge[];
}

export interface TableMerge {
  row: string;
  field: string;
  rows: number;
  cols: number;
}

export interface ChangeHistoryRow {
  version: string;
  date: string;
  author?: string;
  changes: string;
}

export interface DocDecision {
  file: string;
  number: string;
  title: string;
  status?: string;
  date?: string;
  deciders: string[];
  /** Number (NNNN) of the decision this one replaces. */
  supersedes?: string;
  qualityGoals: string[];
  constraints: string[];
  /** The Markdown of each known part (src/doc/adr.ts). */
  parts: Partial<Record<AdrPart, string>>;
}

export interface DocumentData {
  system: string;
  title: string;
  version: string;
  canRelease: boolean;
  /** Released versions with their change log, oldest first. */
  changeHistory: ChangeHistoryRow[];
  sections: DocSection[];
  /** Keyed by the path used in directives, e.g. `diagrams/x.uml.json`. */
  diagrams: Record<string, DocDiagram>;
  diagramFiles: { file: string; title: string; type: string }[];
  model: Model;
  /** Keyed by directive src, e.g. `data/risks.yaml` and `data/quality-requirements.yaml#scenarios`. */
  tables: Record<string, DocTable>;
  decisions: DocDecision[];
  /** Export options saved in archery.yaml (`export`). */
  exportSettings: ExportSettings;
  /** Diagram editor settings (snap to grid, show grid, grid size). */
  canvasSettings: CanvasSettings;
  /** Webview URI of the sections folder, for relative image paths. */
  sectionsBaseUri: string;
}

export type DiagramKind = CanvasDiagram['type'] | 'sequence' | 'communication' | 'timing';

/** A heading of a chapter: its index among the chapter's ## / ### headings, and its text (to check the index still points at it). */
export interface HeadingRef {
  sectionId: string;
  index: number;
  title: string;
}

/**
 * Outline edits (webview/document/outline.ts). `add`: a new heading after `at` (and its subsections),
 * `child` one level down; without `at`, a new ## at the end of `sectionId`. `move`: `heading` (with its
 * subsections) in front of `before`, at its level, or to the end of chapter `into`.
 */
export type OutlineEdit =
  | { kind: 'add'; sectionId: string; at?: HeadingRef; child?: boolean }
  | { kind: 'level'; heading: HeadingRef; delta: 1 | -1 }
  | { kind: 'move'; heading: HeadingRef; before?: HeadingRef; into?: string };

export type ToDocument =
  | { type: 'load'; data: DocumentData }
  /** Scroll to a chapter, or to one of its headings (by text, or by index among its ## / ### headings). */
  | { type: 'reveal'; sectionId: string; heading?: string; index?: number; decision?: string }
  /** Live view: an agent is about to change (or just changed) this chapter / diagram / table. */
  | { type: 'follow'; sectionId: string; index?: number; src?: string; edit?: boolean }
  /** An outline edit from the sidebar's contents (run in the page, so Ctrl+Z undoes it). */
  | { type: 'outline'; edit: OutlineEdit }
  /** Shows the export dialog (the sidebar's Export button). */
  | { type: 'exportDialog' }
  | { type: 'diagramCreated'; requestId: number; src: string | null }
  | { type: 'opResult'; requestId: number; ok: boolean; result?: unknown; error?: string }
  /** Answer to saveImage: the image path relative to the documentation root (null if it failed). */
  | { type: 'imageSaved'; requestId: number; path: string | null };

export type FromDocument =
  | { type: 'ready' }
  /** The user clicked, typed or scrolled with the wheel in the view (hybrid follow, src/live/userActivity.ts). */
  | { type: 'activity' }
  /** The chapter (and heading index) being read, for the sidebar's contents. */
  | { type: 'activeSection'; sectionId: string; index: number | null }
  /** A diagram was maximized (`on`) or closed again: the view takes the whole window meanwhile. */
  | { type: 'maximized'; on: boolean }
  /** The view's size, sent when it changes (tells which side bars a maximized diagram closed). */
  | { type: 'viewSize'; width: number; height: number }
  | { type: 'save'; file: string; markdown: string }
  | { type: 'openDiagram'; src: string }
  /** A link to something outside the document (a source file, a web page); `href` as written, `base` the folder it is relative to. */
  | { type: 'openLink'; href: string; base: string }
  | { type: 'createDiagram'; requestId: number; kind: DiagramKind }
  | { type: 'release' }
  /** Export the whole document (HTML or PDF); `settings` are saved to archery.yaml first. */
  | { type: 'export'; format: 'html' | 'pdf'; settings?: ExportSettings }
  | { type: 'history' }
  /** Runs a shared operation (src/ops/tools.ts), e.g. write_data_table. */
  | { type: 'op'; requestId: number; name: string; input: Record<string, unknown>; diagram?: string }
  | { type: 'setting'; key: keyof CanvasSettings; value: boolean | number }
  | { type: 'exportDiagram'; src: string; format: 'svg' | 'png'; dataUrl?: string }
  | { type: 'deleteFromModel'; refs: string[] }
  /** Stores a pasted/dropped image in the documentation's images/ folder. */
  | { type: 'saveImage'; requestId: number; name: string; dataUrl: string };
