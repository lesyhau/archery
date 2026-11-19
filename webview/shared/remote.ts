// Docked panels: while the Archery sidebar shows its "Diagram Tools" view, a diagram editor tab
// hands its palette (rail) and inspector to that view instead of drawing them itself. The editor
// keeps all state; it sends the panels' props as data (functions become { $fn: path }) and runs
// the calls the sidebar sends back. Panel callbacks must not return values.
import { useEffect, useRef } from 'react';
import { useHostCtx } from './host';

export type PanelComponent = 'canvasRail' | 'canvasInspector' | 'seqRail' | 'seqInspector' | 'timingRail' | 'timingInspector';

export interface PanelSpec {
  component: PanelComponent;
  props: object;
}

export interface DockedPanels {
  /** The diagram's title (the view shows it on top). */
  title: string;
  rail?: PanelSpec;
  inspector?: PanelSpec;
}

type Fn = (...args: unknown[]) => unknown;

/** Replaces functions with { $fn: path } (recorded in `fns`); everything else must be plain data. */
export function encodePanels(value: unknown, fns: Map<string, Fn>, path = ''): unknown {
  if (typeof value === 'function') {
    fns.set(path, value as Fn);
    return { $fn: path };
  }
  if (Array.isArray(value)) return value.map((v, i) => encodePanels(v, fns, `${path}.${i}`));
  if (value instanceof Set) return [...value].map((v, i) => encodePanels(v, fns, `${path}.${i}`));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = encodePanels(v, fns, `${path}.${k}`);
    return out;
  }
  return value;
}

/** Turns { $fn: path } back into functions that call `call(path, args)`. */
export function decodePanels(value: unknown, call: (fn: string, args: unknown[]) => void): unknown {
  if (Array.isArray(value)) return value.map((v) => decodePanels(v, call));
  if (value && typeof value === 'object') {
    const fn = (value as { $fn?: unknown }).$fn;
    if (typeof fn === 'string' && Object.keys(value).length === 1) return (...args: unknown[]) => call(fn, plainArgs(args));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodePanels(v, call)]));
  }
  return value;
}

/** Arguments as plain data (DOM events and nodes become null). */
export function plainArgs(args: unknown[]): unknown[] {
  return JSON.parse(
    JSON.stringify(args, (_, v: unknown) => {
      if (typeof Event !== 'undefined' && v instanceof Event) return null;
      if (typeof Node !== 'undefined' && v instanceof Node) return null;
      if (v && typeof v === 'object' && 'nativeEvent' in v) return null; // React synthetic events
      return v;
    }) ?? '[]',
  ) as unknown[];
}

/**
 * Editor side (render it inside the editor with the current props): while docked, sends the
 * panels whenever they change and runs the sidebar's calls. Renders nothing.
 */
export function DockPanels({ panels }: { panels: DockedPanels | null }): null {
  const host = useHostCtx();
  const fns = useRef(new Map<string, Fn>());
  const last = useRef('');
  const next = new Map<string, Fn>();
  const encoded = panels ? encodePanels(panels, next) : null;
  fns.current = next;
  const json = JSON.stringify(encoded);

  useEffect(() => {
    if (!host.docked) {
      last.current = '';
      return;
    }
    if (json === last.current) return;
    last.current = json;
    host.post({ type: 'panels', panels: encoded as DockedPanels | null });
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string; fn?: string; args?: unknown[] }>) => {
      const msg = event.data;
      if (msg?.type !== 'panelCall' || typeof msg.fn !== 'string') return;
      fns.current.get(msg.fn)?.(...(msg.args ?? []));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return null;
}
