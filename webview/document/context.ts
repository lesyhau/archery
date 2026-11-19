import type { Editor } from '@tiptap/core';
import { createContext, useContext } from 'react';
import type { DiagramKind, DocumentData, FromDocument, ToDocument } from '../../src/doc/protocol';
import type { Scene } from '../../src/render/scene';

interface VsCodeApi {
  postMessage(message: FromDocument): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
/** acquireVsCodeApi may only be called once per webview. */
export const vscodeApi: VsCodeApi = acquireVsCodeApi();

// --- request/response helpers ----------------------------------------------------------

let nextRequest = 1;
const waiting = new Map<number, (msg: ToDocument) => void>();

/** Routes answers (opResult, imageSaved, diagramCreated) to the request that is waiting for them. */
export function resolveRequest(msg: ToDocument): boolean {
  if (!('requestId' in msg)) return false;
  const done = waiting.get(msg.requestId);
  waiting.delete(msg.requestId);
  done?.(msg);
  return !!done;
}

function request<T>(build: (requestId: number) => FromDocument, read: (msg: ToDocument) => T): Promise<T> {
  const requestId = nextRequest++;
  return new Promise((resolve) => {
    waiting.set(requestId, (msg) => resolve(read(msg)));
    vscodeApi.postMessage(build(requestId));
  });
}

/** Runs a shared operation (src/ops/tools.ts); rejects with the error message. */
export function runOp<T = unknown>(name: string, input: Record<string, unknown>, diagram?: string): Promise<T> {
  return request(
    (requestId) => ({ type: 'op', requestId, name, input, ...(diagram ? { diagram } : {}) }),
    (msg) => msg,
  ).then((msg) => {
    if (msg.type !== 'opResult') throw new Error('unexpected answer');
    if (!msg.ok) throw new Error(msg.error ?? 'Operation failed');
    return msg.result as T;
  });
}

/** Stores an image file in images/; resolves with its path relative to the documentation root. */
export function saveImage(file: File): Promise<string | null> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  }).then((dataUrl) =>
    request(
      (requestId) => ({ type: 'saveImage', requestId, name: file.name || 'image.png', dataUrl }),
      (msg) => (msg.type === 'imageSaved' ? msg.path : null),
    ),
  );
}

export function createDiagramRequest(kind: DiagramKind): Promise<string | null> {
  return request(
    (requestId) => ({ type: 'createDiagram', requestId, kind }),
    (msg) => (msg.type === 'diagramCreated' ? msg.src : null),
  );
}

/** Root-relative paths ("images/x.png") as seen from the sections folder (the page's base URL). */
export const fromSections = (src: string) => (/^(https?:|data:|\.\.\/|\/)/.test(src) ? src : `../${src}`);

// --- context -------------------------------------------------------------------------------

export interface DocContextValue {
  data: DocumentData;
  post(msg: FromDocument): void;
  /** Opens the full-window diagram viewer. */
  maximize(scene: Scene, title: string, src: string): void;
  /** Asks the extension to create a diagram; resolves with its path (or null if cancelled). */
  createDiagram(kind: DiagramKind): Promise<string | null>;
  /** The editor that has (or last had) focus; the toolbar acts on it. */
  activeEditor: Editor | null;
  setActiveEditor(editor: Editor | null): void;
  /** Shows an error message at the bottom of the page. */
  showError(message: string): void;
  /** Opens the UML editor window for a diagram. */
  editDiagram(src: string): void;
}

export const DocContext = createContext<DocContextValue | null>(null);

export function useDoc(): DocContextValue {
  const ctx = useContext(DocContext);
  if (!ctx) throw new Error('DocContext missing');
  return ctx;
}

/** Saves the section an editor belongs to (set by SectionEditor; used by node views after attribute changes). */
export function saveNow(editor: Editor): void {
  const storage = (editor.storage as unknown as Record<string, { save?: () => void }>).archerySave;
  // Let the transaction that changed the attributes finish first.
  setTimeout(() => storage?.save?.(), 0);
}
