// Left rail of the canvas editor: the diagram type, what can be added, the connection tools and the
// elements already in the model. Icons only when narrow, icon and name when wide (a container query
// in diagram.css); every button has a tooltip.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { CanvasDiagramTypes, type CanvasDiagramType, type Element, type RelationshipKind } from '../../src/model/schema';
import { RELATIONSHIPS, type PaletteItem } from './palette';
import { IconInterrupt, ELEMENT_ICONS, IconAnchor, IconExisting, IconInterfaceBox, IconSelectTool, IconTransition, LOCAL_ICONS, RELATIONSHIP_ICONS, TYPE_ICONS, TYPE_LABELS } from './umlIcons';

/** What dragging between two nodes (or clicking one, then another) creates. */
export type ConnectTool = { kind: RelationshipKind } | { local: 'transition' | 'flow' | 'anchor' | 'interrupt' };

export const toolKey = (t: ConnectTool | null) => (t === null ? 'select' : 'kind' in t ? t.kind : t.local);

interface Props {
  type: CanvasDiagramType;
  editable: boolean;
  palette: PaletteItem[];
  existing: Element[];
  tool: ConnectTool | null;
  onTool(tool: ConnectTool | null): void;
  onType(type: CanvasDiagramType): void;
  onAdd(item: PaletteItem): void;
  onAddExisting(id: string): void;
  /** Drag onto the canvas (not offered in the sidebar, where a click adds in the middle of the view). */
  dragData?(e: DragEvent, payload: { item?: PaletteItem; existing?: string }): void;
}

export const itemIcon = (item: PaletteItem) => {
  if (item.source === 'local') return LOCAL_ICONS[item.kind];
  if (item.kind === 'interface' && !item.lollipop) return IconInterfaceBox;
  return ELEMENT_ICONS[item.kind];
};

/** Moves a pop-out up so it stays inside the window (its button may sit low in a long palette). */
export function keepInWindow(el: HTMLElement | null): void {
  if (!el) return;
  el.style.translate = '';
  const r = el.getBoundingClientRect();
  const over = r.bottom - (window.innerHeight - 8);
  if (over > 0) el.style.translate = `0 ${-Math.min(over, Math.max(0, r.top - 8))}px`;
}

export function Rail({ type, editable, palette, existing, tool, onTool, onType, onAdd, onAddExisting, dragData }: Props) {
  const [flyout, setFlyout] = useState(false);
  const [query, setQuery] = useState('');
  const flyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flyout) return;
    const close = (e: MouseEvent) => {
      if (!flyRef.current?.contains(e.composedPath()[0] as Node)) setFlyout(false);
    };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
    };
  }, [flyout]);

  const behavior = type === 'state' || type === 'activity' || type === 'interactionOverview';
  const connectTools: { tool: ConnectTool; name: string; label: string; icon: () => JSX.Element }[] = behavior
    ? [
        { tool: { local: type === 'state' ? 'transition' : 'flow' }, name: type === 'state' ? 'Transition' : 'Control flow', label: type === 'state' ? 'Transition' : 'Control flow', icon: IconTransition },
        ...(type === 'activity' ? [{ tool: { local: 'interrupt' } as ConnectTool, name: 'Interrupting edge', label: 'Interrupting edge: from inside an interruptible region to outside it', icon: IconInterrupt }] : []),
        { tool: { local: 'anchor' }, name: 'Note link', label: 'Note link', icon: IconAnchor },
      ]
    : [...RELATIONSHIPS.map((r) => ({ tool: { kind: r.kind } as ConnectTool, name: r.label, label: `${r.label}: ${r.hint}`, icon: RELATIONSHIP_ICONS[r.kind] })), { tool: { local: 'anchor' }, name: 'Note link', label: 'Note link', icon: IconAnchor }];
  const active = toolKey(tool);
  const shown = existing.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <aside className="rail" aria-label="Tools">
      <div className="rail-group" role="radiogroup" aria-label="Diagram type">
        {CanvasDiagramTypes.map((t) => {
          const I = TYPE_ICONS[t];
          return (
            <button
              type="button"
              key={t}
              role="radio"
              aria-checked={t === type}
              className={`rail-btn${t === type ? ' on' : ''}`}
              title={t === type ? TYPE_LABELS[t] : `${TYPE_LABELS[t]}: switch this diagram (its content stays)`}
              disabled={!editable && t !== type}
              onClick={() => t !== type && onType(t)}
            >
              <I />
              <span className="rail-label">{TYPE_LABELS[t].replace(/ diagram$/, '')}</span>
            </button>
          );
        })}
      </div>
      {editable && (
        <>
          <div className="rail-group" aria-label="Add">
            {palette.map((item) => {
              const I = itemIcon(item);
              return (
                <button
                  type="button"
                  key={`${item.source}:${item.kind}:${item.label}`}
                  className="rail-btn"
                  draggable={!!dragData}
                  data-kind={item.kind}
                  onDragStart={(e) => dragData?.(e, { item })}
                  onClick={() => onAdd(item)}
                  title={`${item.label}: click to add, or drag onto the canvas`}
                >
                  <I />
                  <span className="rail-label">{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="rail-group" role="radiogroup" aria-label="Connect">
            <button type="button" role="radio" aria-checked={tool === null} className={`rail-btn${tool === null ? ' on' : ''}`} title="Select and move (Esc)" onClick={() => onTool(null)}>
              <IconSelectTool />
              <span className="rail-label">{'Select'}</span>
            </button>
            {connectTools.map((c) => (
              <button
                type="button"
                key={toolKey(c.tool)}
                role="radio"
                aria-checked={active === toolKey(c.tool)}
                className={`rail-btn${active === toolKey(c.tool) ? ' on' : ''}`}
                title={`${c.label}. Pick a tool, then click the source and the target`}
                onClick={() => onTool(active === toolKey(c.tool) ? null : c.tool)}
              >
                <c.icon />
                <span className="rail-label">{c.name}</span>
              </button>
            ))}
          </div>
          {existing.length > 0 && (
            <div className="rail-group rail-flyout-host" ref={flyRef}>
              <button type="button" className={`rail-btn${flyout ? ' on' : ''}`} title={`Elements from the model (${existing.length})`} aria-expanded={flyout} onClick={() => setFlyout(!flyout)}>
                <IconExisting />
                <span className="rail-label">{'From the model'}</span>
                <span className="rail-badge">{existing.length}</span>
              </button>
              {flyout && (
                <div className="rail-flyout" role="dialog" aria-label="Elements from the model" ref={keepInWindow}>
                  <input autoFocus placeholder="Search the model" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFlyout(false)} />
                  <div className="rail-flyout-list">
                    {shown.map((e) => {
                      const I = ELEMENT_ICONS[e.kind];
                      return (
                        <button
                          type="button"
                          key={e.id}
                          className="flyout-item"
                          draggable={!!dragData}
                          onDragStart={(ev) => dragData?.(ev, { existing: e.id })}
                          onClick={() => {
                            onAddExisting(e.id);
                            setFlyout(false);
                          }}
                          title="Click or drag onto the canvas"
                        >
                          <I />
                          <span>{e.name}</span>
                        </button>
                      );
                    })}
                    {shown.length === 0 && <div className="flyout-empty">No match</div>}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
