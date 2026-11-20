// What the diagram editors need from their surroundings, provided by the editor webviews
// (webview/shared/vscode.ts).
import { createContext, useContext, type MutableRefObject } from 'react';
import type { Model } from '../../src/model/schema';
import type { DiagramUsage } from '../../src/model/usage';
import type { CanvasSettings, FromWebview } from '../../src/protocol';
import type { Scene } from '../../src/render/scene';
import { sceneToSvg } from '../../src/render/svgExport';

export interface HostState {
  /** undefined until the document text has arrived. */
  text: string | undefined;
  fileName: string;
  /** false when the diagram is not inside an documentation folder (operations are not possible). */
  editable: boolean;
  model: Model | null;
  modelIssues: string[];
  settings: CanvasSettings;
  /** Every diagram of the documentation and what it shows (for "used in" and scenarios). */
  diagrams: DiagramUsage[];
  /** The palette and inspector are shown in the Archery sidebar (Diagram Tools), not in the editor. */
  docked: boolean;
  /** Live view: ids an agent just changed (seq changes with every request). */
  highlight: { refs: string[]; seq: number } | null;
}

export interface Host extends HostState {
  /** Runs a shared operation (src/ops/tools.ts) on this diagram. Rejects with the error message. */
  runOp<T = unknown>(name: string, input?: Record<string, unknown>): Promise<T>;
  post(msg: FromWebview): void;
  /** The last operation error, shown as a toast. */
  error: string | null;
  clearError(): void;
  /** The editor keeps its current scene here (for PNG export). */
  sceneRef: MutableRefObject<{ scene: Scene; title: string } | null>;
  /** Opens another diagram (path relative to the documentation root). */
  openDiagram(file: string): void;
}

export const HostContext = createContext<Host | null>(null);

export function useHostCtx(): Host {
  const host = useContext(HostContext);
  if (!host) throw new Error('HostContext missing');
  return host;
}

/** Rasterizes a scene to a PNG data URL (2x, light background). */
export function sceneToPng(scene: Scene, title: string): Promise<string | null> {
  return svgToPng(sceneToSvg(scene, { theme: 'light', title }), scene.width, scene.height);
}

/** Rasterizes an SVG of width x height to a PNG data URL (2x). */
export async function svgToPng(svg: string, width: number, height: number): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('could not load the SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * 2));
    canvas.height = Math.max(1, Math.ceil(height * 2));
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The document or shadow root an element lives in (for elementFromPoint / activeElement). */
export const rootOf = (el: Element | null | undefined): Document | ShadowRoot => (el?.getRootNode() as Document | ShadowRoot) ?? document;

/** The element an event really started at, also inside a shadow root. */
export const eventTarget = (e: Event): HTMLElement => (e.composedPath()[0] as HTMLElement) ?? (e.target as HTMLElement);
