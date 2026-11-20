// The contents panel: arc42 chapters with their subsection outline (## and ###).
//  - click an entry: scroll there; it becomes active (also short chapters near the end, and subheadings)
//  - click a chapter with subsections: collapsed -> expand and go there; expanded but not active -> go there;
//    expanded and active -> collapse. The chevron only shows the state.
//  - right-click: add a heading after / a subheading, promote, demote (chapters: add a subsection)
//  - drag a subsection (with its children) up / down, also onto another chapter; numbers follow
//  - drag the panel's right edge to resize it
import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { headingsOf } from '../../src/template/markdown';
import type { DocumentData } from '../../src/doc/protocol';
import { runOp, useDoc } from './context';
import { IconExpand, IconExport } from './icons';
import { addHeading, canDemote, canPromote, MAX_LEVEL, moveHeading, outlineNumbers, outlineOf, setLevel, type OutlineItem } from './outline';

export const HISTORY_ID = 'change-history';

interface Props {
  data: DocumentData;
  active: string | undefined;
  /** Outline index of the active subheading inside the active chapter, or null for the chapter itself. */
  activeHeading: number | null;
  editors: Map<string, Editor>;
  historyNumber: number;
  width: number;
  onWidth(width: number): void;
  onNavigate(sectionId: string, headingIndex?: number): void;
  /** Opens the export dialog. */
  onExport(): void;
}

type Drop = { sectionId: string; index: number | null; place: 'before' | 'after'; level: number };
type MenuItem = { label: string; disabled?: boolean; run(): void };

/** The system name; click to rename it (Enter or leaving the field saves, Escape cancels). */
function SystemName({ system }: { system: string }) {
  const { showError } = useDoc();
  const [draft, setDraft] = useState<string | null>(null);
  // Shown from saving until the reloaded document carries the new name.
  const [pending, setPending] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setPending(null), [system]);
  useEffect(() => {
    if (draft !== null) input.current?.select();
  }, [draft !== null]);

  const save = () => {
    if (draft === null) return;
    const name = draft.trim();
    setDraft(null);
    if (!name || name === system) return;
    setPending(name);
    runOp('set_project', { system: name }).catch((e: unknown) => {
      setPending(null);
      showError(e instanceof Error ? e.message : String(e));
    });
  };

  if (draft !== null) {
    return (
      <input
        ref={input}
        className="toc-system toc-system-input"
        aria-label="System name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape') setDraft(null);
        }}
      />
    );
  }
  return (
    <button type="button" className="toc-system toc-system-name" title="Rename system" onClick={() => setDraft(pending ?? system)}>
      {pending ?? system}
    </button>
  );
}

/** h2 items with their h3 children, keeping each item's outline index. */
function tree(items: OutlineItem[]): { item: OutlineItem; children: OutlineItem[] }[] {
  const out: { item: OutlineItem; children: OutlineItem[] }[] = [];
  for (const it of items) {
    const parent = out.at(-1);
    if (it.level > 2 && parent) parent.children.push(it);
    else out.push({ item: it, children: [] });
  }
  return out;
}

export function Toc({ data, active, activeHeading, editors, historyNumber, width, onWidth, onNavigate, onExport }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<{ sectionId: string; index: number; drop: Drop | null } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const dragged = useRef(false);
  const bodyRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Scrolling into a chapter opens it.
  useEffect(() => {
    if (active) setOpen((o) => (o[active] ? o : { ...o, [active]: true }));
  }, [active]);

  // Close the menu on outside clicks, Escape or scrolling.
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const outline = (sectionId: string, markdown: string): OutlineItem[] => {
    const editor = editors.get(sectionId);
    return editor ? outlineOf(editor) : headingsOf(markdown).map((h, index) => ({ title: h.title, level: 2, index }));
  };

  // --- drag a subsection ----------------------------------------------------------------
  const startDrag = (e: ReactPointerEvent, sectionId: string, index: number) => {
    if (e.button !== 0 || !editors.get(sectionId)) return;
    const start = { x: e.clientX, y: e.clientY };
    let moving = false;
    let drop: Drop | null = null;
    dragged.current = false;
    const onMove = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      moving = true;
      dragged.current = true;
      ev.preventDefault();
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-drop]');
      drop = null;
      if (el && bodyRef.current?.contains(el)) {
        const sec = el.dataset.sec!;
        if (el.dataset.drop === 'section') drop = { sectionId: sec, index: null, place: 'after', level: 2 };
        else {
          const rect = el.getBoundingClientRect();
          drop = { sectionId: sec, index: Number(el.dataset.index), place: ev.clientY < rect.top + rect.height / 2 ? 'before' : 'after', level: Number(el.dataset.level) };
        }
      }
      setDrag({ sectionId, index, drop });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (!moving || !drop) return;
      const src = editors.get(sectionId);
      const dst = editors.get(drop.sectionId);
      if (!src || !dst) return;
      if (moveHeading(src, index, { editor: dst, index: drop.index, place: drop.place, level: drop.level })) {
        setOpen((o) => ({ ...o, [drop!.sectionId]: true }));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const isDrop = (sectionId: string, index: number | null) => !!drag?.drop && drag.drop.sectionId === sectionId && drag.drop.index === index;
  /** Insertion line above / below an outline entry (below = after its subsections). */
  const marker = (sectionId: string, index: number) => (isDrop(sectionId, index) ? <span className={`toc-drop ${drag!.drop!.place}`} aria-hidden="true" /> : null);

  // --- resize the panel -------------------------------------------------------------------
  const startResize = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    document.documentElement.setAttribute('data-resizing', 'x');
    const onMove = (ev: PointerEvent) => onWidth(Math.min(560, Math.max(180, w0 + ev.clientX - x0)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.documentElement.removeAttribute('data-resizing');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Swallows the click that ends a drag. */
  const wasDrag = () => {
    if (!dragged.current) return false;
    dragged.current = false;
    return true;
  };

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const itemMenu = (editor: Editor | undefined, items: OutlineItem[], it: OutlineItem): MenuItem[] => [
    { label: 'Add heading after', disabled: !editor, run: () => editor && addHeading(editor, it.index, 'peer') },
    { label: 'Add subheading', disabled: !editor || it.level >= MAX_LEVEL, run: () => editor && addHeading(editor, it.index, 'child') },
    { label: 'Promote', disabled: !editor || !canPromote(items, it.index), run: () => editor && setLevel(editor, it.index, -1) },
    { label: 'Demote', disabled: !editor || !canDemote(items, it.index), run: () => editor && setLevel(editor, it.index, 1) },
  ];

  const item = (sectionId: string, items: OutlineItem[], it: OutlineItem, number: string) => {
    const isActive = active === sectionId && activeHeading === it.index;
    return (
      <div
        className={`toc-item${isActive ? ' active' : ''}${drag && drag.sectionId === sectionId && drag.index === it.index ? ' moving' : ''}`}
        data-drop="item"
        data-sec={sectionId}
        data-index={it.index}
        data-level={it.level}
        onContextMenu={(e) => openMenu(e, itemMenu(editors.get(sectionId), items, it))}
      >
        <a
          href={`#sec-${sectionId}`}
          aria-current={isActive ? 'location' : undefined}
          onPointerDown={(e) => startDrag(e, sectionId, it.index)}
          onClick={(e) => {
            e.preventDefault();
            if (!wasDrag()) onNavigate(sectionId, it.index);
          }}
          draggable={false}
        >
          {number && <span className="toc-subnum">{number}</span>}
          {it.title || 'Untitled'}
        </a>
      </div>
    );
  };

  return (
    <aside className={`toc${drag?.drop ? ' dragging' : ''}`} style={{ flexBasis: width, width }}>
      <div className="toc-head">
        <div className="toc-system-row">
          <SystemName system={data.system} />
          <button
            type="button"
            className="toc-export"
            title="Export the document (PDF or HTML)"
            aria-haspopup="dialog"
            onClick={() => onExport()}
          >
            <IconExport />
          </button>
        </div>
        <div className="toc-kind">Architecture Design Document · v{data.version}</div>
      </div>
      <nav className="toc-body" aria-label="Contents" ref={bodyRef}>
        <ol>
          {data.sections.map((s) => {
            const items = outline(s.id, s.markdown);
            const numbers = outlineNumbers(items, s.number);
            const expanded = !!open[s.id];
            const editor = editors.get(s.id);
            const hasSubs = items.length > 0;
            const chapterActive = active === s.id && activeHeading === null;
            const onRowClick = (e: React.MouseEvent) => {
              e.preventDefault();
              if (wasDrag()) return;
              if (!hasSubs) return onNavigate(s.id);
              if (!expanded) {
                setOpen((o) => ({ ...o, [s.id]: true }));
                onNavigate(s.id);
              } else if (chapterActive) setOpen((o) => ({ ...o, [s.id]: false }));
              else onNavigate(s.id);
            };
            return (
              <li key={s.id} className={active === s.id ? 'active' : undefined}>
                <div
                  className={`toc-row${isDrop(s.id, null) ? ' drop-into' : ''}`}
                  data-drop="section"
                  data-sec={s.id}
                  onClick={onRowClick}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      {
                        label: 'Add subsection',
                        disabled: !editor,
                        run: () => {
                          if (!editor) return;
                          setOpen((o) => ({ ...o, [s.id]: true }));
                          addHeading(editor, null, 'child');
                        },
                      },
                    ])
                  }
                >
                  <a href={`#sec-${s.id}`} draggable={false} aria-expanded={hasSubs ? expanded : undefined} aria-current={chapterActive ? 'location' : undefined}>
                    {s.number !== undefined && <span className="toc-num">{s.number}</span>}
                    {s.title}
                  </a>
                  {hasSubs && <span className="toc-leader" aria-hidden="true" />}
                  {hasSubs && (
                    <span className={`toc-caret${expanded ? ' open' : ''}`} aria-hidden="true">
                      <IconExpand />
                    </span>
                  )}
                </div>
                {hasSubs && (
                  <div className={`toc-sub${expanded ? ' open' : ''}`} aria-hidden={!expanded} {...(expanded ? {} : { inert: '' })}>
                    <div className="toc-sub-inner">
                      <ol>
                        {tree(items).map(({ item: h2, children }) => (
                          <li key={h2.index}>
                            {marker(s.id, h2.index)}
                            {item(s.id, items, h2, numbers[h2.index]!)}
                            {children.length > 0 && (
                              <ol>
                                {children.map((h3) => (
                                  <li key={h3.index}>
                                    {marker(s.id, h3.index)}
                                    {item(s.id, items, h3, numbers[h3.index]!)}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          <li className={active === HISTORY_ID ? 'active' : undefined}>
            <div className="toc-row" onClick={(e) => (e.preventDefault(), onNavigate(HISTORY_ID))}>
              <a href={`#sec-${HISTORY_ID}`}>
                <span className="toc-num">{historyNumber}</span>
                Change history
              </a>
            </div>
          </li>
        </ol>
      </nav>
      <div className="toc-foot">Structure based on the arc42 template.</div>
      <div className="toc-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the contents panel" title="Drag to resize" onPointerDown={startResize} />
      {menu &&
        createPortal(
          <div ref={menuRef} className="popover grid-popover" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 180) }} onContextMenu={(e) => e.preventDefault()}>
            {menu.items.map((m) => (
              <button
                type="button"
                role="menuitem"
                key={m.label}
                className="menu-item"
                disabled={m.disabled}
                onClick={() => {
                  setMenu(null);
                  m.run();
                }}
              >
                {m.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </aside>
  );
}
