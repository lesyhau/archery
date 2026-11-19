// React node views for the arc42 directive nodes inside a section editor.
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DiagramAttrs } from '../../src/doc/extensions';
import { tableFor } from '../../src/doc/tables';
import { diagramName } from '../../src/model/usage';
import { docDiagramScene } from '../../src/render/docDiagram';
import type { Scene } from '../../src/render/scene';
import { SceneSvg } from '../render/SceneSvg';
import { Caption } from './Caption';
import { saveNow, useDoc } from './context';
import { DataGrid } from './DataGrid';
import { IconEdit, IconInfo, IconMaximize, IconPlus, IconRemove, IconReset } from './icons';
import { usePanZoom, ZoomTools } from './panZoom';

const MIN_W = 220;
const MIN_H = 80;
/** Padding around a fitted diagram: none, the drawing has its own margin and no box around it. */
const PAD = 0;

export function useScene(src: string): { scene: Scene | null; title: string; error?: string } {
  const { data } = useDoc();
  const entry = data.diagrams[src];
  return useMemo(() => {
    if (!entry) return { scene: null, title: diagramName(src), error: `The diagram "${diagramName(src)}" was not found (renamed or deleted?).` };
    if (entry.kind === 'missing') return { scene: null, title: diagramName(src), error: `The diagram "${diagramName(src)}" could not be read: ${entry.message}` };
    try {
      const scene = docDiagramScene(entry, data.model, data.canvasSettings.diagramStyle, src);
      return { scene, title: entry.title || diagramName(src) };
    } catch (e) {
      return { scene: null, title: entry.title || diagramName(src), error: e instanceof Error ? e.message : String(e) };
    }
  }, [entry, data.model, src, data.canvasSettings.diagramStyle]);
}

/**
 * Drill-down: shows the diagram an element is detailed in. Scrolls to the place in the document
 * that shows it (and flashes it), else opens it in its editor.
 */
export function showDetail(file: string, edit: (src: string) => void): void {
  const target = [...document.querySelectorAll<HTMLElement>('figure.diagram-figure[data-src]')].find((f) => f.dataset.src === file);
  if (!target) return edit(file);
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('flash');
  void target.offsetWidth;
  target.classList.add('flash');
  window.setTimeout(() => target.classList.remove('flash'), 1600);
}

export function DiagramFrame({ node, updateAttributes, editor, selected, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as DiagramAttrs;
  const { maximize, editDiagram } = useDoc();
  const { scene, title, error } = useScene(attrs.src);
  const caption = attrs.caption || title;
  const frameRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const editable = editor.isEditable;
  const pz = usePanZoom(scene, { maxFit: 1, margin: PAD, wheel: 'ctrl' });

  const bindBody = useCallback(
    (el: HTMLDivElement | null) => {
      bodyRef.current = el;
      pz.bind(el);
    },
    [pz.bind],
  );

  // Without a saved height the frame is as tall as the diagram fitted to its width (at most 100%).
  const [frameW, setFrameW] = useState(0);
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrameW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const autoHeight = scene && frameW > 0 ? Math.round(scene.height * Math.min(1, (frameW - 2 * PAD) / Math.max(1, scene.width))) + 2 * PAD : undefined;

  const update = (patch: Partial<DiagramAttrs>) => {
    updateAttributes(patch);
    saveNow(editor);
  };

  const startResize = (e: ReactPointerEvent, mode: 'x' | 'y' | 'xy') => {
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    const body = bodyRef.current;
    if (!frame || !body) return;
    const column = frame.parentElement?.clientWidth ?? frame.clientWidth;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = frame.getBoundingClientRect().width;
    const startH = body.getBoundingClientRect().height;
    let current = { w: startW, h: startH };
    const move = (ev: PointerEvent) => {
      current = {
        w: mode === 'y' ? startW : Math.min(column, Math.max(MIN_W, startW + ev.clientX - startX)),
        h: mode === 'x' ? startH : Math.max(MIN_H, startH + ev.clientY - startY),
      };
      setLive(current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.documentElement.removeAttribute('data-resizing');
      setLive(null);
      update({
        width: mode === 'y' ? attrs.width : current.w >= column - 2 ? null : `${Math.round(current.w)}px`,
        height: mode === 'x' ? attrs.height : Math.round(current.h),
      });
    };
    document.documentElement.setAttribute('data-resizing', mode);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const width = live ? `${live.w}px` : attrs.width ?? undefined;
  const height = live ? live.h : attrs.height ?? autoHeight;
  const open = () => editDiagram(attrs.src);

  return (
    <NodeViewWrapper className={`node-diagram${selected ? ' is-selected' : ''}`} contentEditable={false}>
      {/* The diagram with its caption centered below it, like an image; the tools float over the
          top right corner while the pointer is over the diagram. */}
      <figure ref={frameRef} className="diagram-figure" data-src={attrs.src} style={{ width }}>
       <div className={`frame diagram-frame${selected ? ' selected' : ''}`}>
        <div className="frame-head" data-drag-handle title="Drag to move">
          <span className="frame-grip" aria-hidden="true">
            <svg width="8" height="14" viewBox="0 0 8 14">
              {[2, 7, 12].flatMap((y) => [<circle key={`a${y}`} cx="2" cy={y} r="1.2" />, <circle key={`b${y}`} cx="6" cy={y} r="1.2" />])}
            </svg>
          </span>
          <span className="frame-tools">
            {scene && <ZoomTools pz={pz} />}
            <button type="button" className="icon-btn" title="Edit in the UML diagram editor" onClick={open}>
              <IconEdit />
            </button>
            {scene && (
              <button type="button" className="icon-btn" title="Maximize" onClick={() => maximize(scene, caption, attrs.src)}>
                <IconMaximize />
              </button>
            )}
            {(attrs.width || attrs.height) && editable && (
              <button type="button" className="icon-btn" title="Reset size" onClick={() => update({ width: null, height: null })}>
                <IconReset />
              </button>
            )}
            {editable && (
              <button
                type="button"
                className="icon-btn"
                title="Remove from the document (the diagram file is kept)"
                onClick={() => {
                  deleteNode();
                  saveNow(editor);
                }}
              >
                <IconRemove />
              </button>
            )}
          </span>
        </div>
        {(
          <div
            ref={bindBody}
            className={`frame-body${scene ? ' stage' : ''}`}
            style={{ height: scene ? height : undefined }}
            onDoubleClick={open}
            onPointerDown={scene ? pz.startPan : undefined}
            title="Drag to pan, Ctrl+wheel to zoom, double-click to edit"
          >
            {scene ? (
              <div className="stage-canvas" style={{ transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})` }}>
                <SceneSvg scene={scene} label={caption} onLink={(file) => showDetail(file, editDiagram)} />
              </div>
            ) : (
              <div className="frame-error">{error}</div>
            )}
            {scene && scene.prims.length === 0 && <div className="frame-empty">Empty diagram - double-click to draw it.</div>}
          </div>
        )}
        {editable && (
          <>
            <span className="resize-x" onPointerDown={(e) => startResize(e, 'x')} />
            <span className="resize-y" onPointerDown={(e) => startResize(e, 'y')} />
            <span className="resize-xy" onPointerDown={(e) => startResize(e, 'xy')} />
          </>
        )}
       </div>
        <figcaption className="diagram-caption">
          <Caption kind="diagram" value={attrs.caption} fallback={title} editable={editable} onChange={(v) => update({ caption: v })} />
        </figcaption>
      </figure>
    </NodeViewWrapper>
  );
}

/**
 * arc42 guidance is shown as an info icon at the end of the heading above it (see the
 * HelpIcons plugin in SectionEditor); the node itself takes no space in the page.
 */
export function HelpNote() {
  return <NodeViewWrapper className="node-help" contentEditable={false} />;
}

export function DataTable({ node, editor, deleteNode, updateAttributes }: NodeViewProps) {
  const { data } = useDoc();
  const src = String(node.attrs.src);
  const table = tableFor(data.tables, src);
  // Deleting removes the table from the document (Ctrl+Z brings it back); its entries stay in the data.
  const remove = () => {
    deleteNode();
    saveNow(editor);
  };
  return (
    <NodeViewWrapper className="node-table" contentEditable={false} data-src={src}>
      {table ? (
        <DataGrid
          table={table}
          onDelete={remove}
          caption={(node.attrs.caption as string | null) ?? null}
          editable={editor.isEditable}
          onCaption={(caption) => {
            updateAttributes({ caption });
            saveNow(editor);
          }}
        />
      ) : <div className="generated"><div className="frame-error">The data of this table was not found.</div></div>}
    </NodeViewWrapper>
  );
}

export function DecisionList({ node }: NodeViewProps) {
  const { data, post } = useDoc();
  const dir = String(node.attrs.src || 'decisions');
  return (
    <NodeViewWrapper className="node-table" contentEditable={false}>
      <div className="generated">
        <div className="generated-head">
          <span className="head-title">
            Architecture decision records
            <span className="help-icon" tabIndex={0} role="note" aria-label="About architecture decision records">
              <IconInfo />
              <span className="help-pop" role="tooltip">
                <span className="help-pop-title">Architecture decision records (ADRs)</span>
                <span className="help-p">One record per important, expensive, large-scale or risky decision, so stakeholders can retrace why it was made.</span>
                <span className="help-p">
                  <strong>A record contains:</strong> status (proposed, accepted, rejected, deprecated, superseded), date, the quality goals and constraints it addresses, then
                  Context (the forces at play), Decision (what was chosen) and Consequences (what becomes easier or harder).
                </span>
                <span className="help-p">Use New decision to add one; click a row to open it.</span>
              </span>
            </span>
          </span>
          <button type="button" className="link-btn" onClick={() => post({ type: 'createDecision' })} title="Record a new architecture decision">
            <IconPlus /> New decision
          </button>
        </div>
        {data.decisions.length === 0 ? (
          <div className="generated-empty">No decisions recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Decision</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.decisions.map((d) => (
                  <tr key={d.file} className="clickable" onClick={() => post({ type: 'openFile', file: d.file })}>
                    <td>{d.number}</td>
                    <td>{d.title}</td>
                    <td>{d.status && <span className={`badge status-${d.status}`}>{d.status}</span>}</td>
                    <td>{d.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export function RawHtmlView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="node-raw" contentEditable={false}>
      <div dangerouslySetInnerHTML={{ __html: String(node.attrs.html ?? '') }} />
    </NodeViewWrapper>
  );
}

/** An image as a figure: the image with "Figure N: caption" under it (the caption is the alt text). */
export function ImageFigure({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const src = String(node.attrs.src ?? '');
  const alt = (node.attrs.alt as string | null) ?? null;
  return (
    <NodeViewWrapper as="span" className={`doc-figure${selected ? ' is-selected' : ''}`}>
      <img src={src} alt={alt ?? ''} title={(node.attrs.title as string | null) ?? undefined} data-drag-handle draggable />
      <span className="doc-figure-cap">
        <Caption
          kind="figure"
          value={alt}
          editable={editor.isEditable}
          onChange={(v) => {
            updateAttributes({ alt: v });
            saveNow(editor);
          }}
        />
      </span>
    </NodeViewWrapper>
  );
}
