// Messages exchanged between the extension host and the diagram editor webviews.
import type { DiagramStyle } from './render/scene';
import type { DiagramUsage } from './model/usage';
import type { Model } from './model/schema';

export interface CanvasSettings {
  snapToGrid: boolean;
  showGrid: boolean;
  gridSize: number;
  /** How diagrams are drawn everywhere (editors, document, exports). */
  diagramStyle: DiagramStyle;
}

export type ToWebview =
  /** Sent once after the webview reports `ready`, and whenever the document text changes (edits, undo/redo, git checkout, ...). */
  | { type: 'init' | 'documentChanged'; text: string; fileName: string; editable: boolean }
  /** Sent with `init` and whenever model.yaml changes. `null` when the file is not inside an documentation workspace. */
  | { type: 'model'; model: Model | null; issues: string[]; diagrams?: DiagramUsage[] }
  | { type: 'settings'; settings: CanvasSettings }
  /** Answer to an `op` request. */
  | { type: 'opResult'; requestId: number; ok: boolean; result?: unknown; error?: string }
  /** Asks the webview to render the diagram as PNG (answered with `png`). */
  | { type: 'renderPng'; requestId: number }
  /** Whether the sidebar's Diagram Tools view shows the palette and inspector (the editor then hides its own). */
  | { type: 'docked'; docked: boolean }
  /** A call from the docked palette / inspector (see webview/shared/remote.ts). */
  | { type: 'panelCall'; fn: string; args: unknown[] }
  /** Live view: select and outline what an agent just changed (element, relationship or local ids). */
  | { type: 'highlight'; refs: string[] };

export type FromWebview =
  | { type: 'ready' }
  /** Runs one of the shared operations (src/ops/tools.ts) on this diagram; `diagram` is filled in by the extension. */
  | { type: 'op'; requestId: number; name: string; input: Record<string, unknown> }
  /** Delete elements/relationships from the model everywhere (asks for confirmation). */
  | { type: 'deleteFromModel'; refs: string[] }
  | { type: 'setting'; key: keyof CanvasSettings; value: boolean | number }
  | { type: 'export'; format: 'svg' | 'png' }
  /** Open another diagram of the documentation (path relative to the root). */
  | { type: 'openDiagram'; file: string }
  | { type: 'png'; requestId: number; dataUrl: string | null }
  /** The palette and inspector for the sidebar (functions encoded as { $fn }), while docked. */
  | { type: 'panels'; panels: unknown }
  | { type: 'error'; message: string }
  /** Ctrl+Z / Ctrl+Y outside text fields (Archery panels keep their own history). */
  | { type: 'undo' }
  | { type: 'redo' };
