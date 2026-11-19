// Host for the diagram editor webviews (Archery panels and custom editors): talks to the extension.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FromWebview, ToWebview } from '../../src/protocol';
import { sceneToPng, type Host, type HostState } from './host';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;
/** acquireVsCodeApi may only be called once per webview. */
export const vscode = (): VsCodeApi => (api ??= acquireVsCodeApi());

let nextRequest = 1;
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

/** Subscribes to document/model/settings updates from the extension. */
export function useHost(): Host {
  const [state, setState] = useState<HostState>({
    text: undefined,
    fileName: '',
    editable: false,
    model: null,
    modelIssues: [],
    diagrams: [],
    settings: { snapToGrid: true, showGrid: true, gridSize: 10, diagramStyle: 'classic' },
    docked: false,
    highlight: null,
  });
  const [error, setError] = useState<string | null>(null);
  const sceneRef = useRef<Host['sceneRef']['current']>(null);

  useEffect(() => {
    const onMessage = async (event: MessageEvent<ToWebview>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'init':
        case 'documentChanged':
          setState((s) => ({ ...s, text: msg.text, fileName: msg.fileName, editable: msg.editable }));
          // Lets an Archery diagram panel come back after a window reload.
          if (msg.type === 'init') vscode().setState({ fileName: msg.fileName });
          break;
        case 'model':
          setState((s) => ({ ...s, model: msg.model, modelIssues: msg.issues, diagrams: msg.diagrams ?? s.diagrams }));
          break;
        case 'settings':
          setState((s) => ({ ...s, settings: msg.settings }));
          break;
        case 'docked':
          setState((s) => ({ ...s, docked: msg.docked }));
          break;
        case 'highlight':
          setState((s) => ({ ...s, highlight: { refs: msg.refs, seq: (s.highlight?.seq ?? 0) + 1 } }));
          break;
        case 'opResult': {
          const p = pending.get(msg.requestId);
          pending.delete(msg.requestId);
          if (!p) break;
          if (msg.ok) p.resolve(msg.result);
          else {
            setError(msg.error ?? 'Operation failed');
            p.reject(new Error(msg.error));
          }
          break;
        }
        case 'renderPng': {
          const current = sceneRef.current;
          const dataUrl = current ? await sceneToPng(current.scene, current.title) : null;
          vscode().postMessage({ type: 'png', requestId: msg.requestId, dataUrl });
          break;
        }
      }
    };
    // Undo / redo outside text fields: the extension undoes the last operation (Archery panels).
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey);
      if (k !== 'z' && !redo) return;
      const t = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      vscode().postMessage({ type: redo ? 'redo' : 'undo' });
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    vscode().postMessage({ type: 'ready' });
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const runOp = useCallback(<T,>(name: string, input: Record<string, unknown> = {}) => {
    const requestId = nextRequest++;
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      vscode().postMessage({ type: 'op', requestId, name, input });
    });
  }, []);

  return {
    ...state,
    runOp,
    post: (msg) => vscode().postMessage(msg),
    error,
    clearError: () => setError(null),
    sceneRef,
    openDiagram: (file) => vscode().postMessage({ type: 'openDiagram', file }),
  };
}
