// Formatting toolbar for the focused section: block style, text marks, lists, blocks, inserts
// (table, image, diagram) and, inside a table, the table tools. All buttons keep the editor's focus.
import type { Editor } from '@tiptap/core';
import { useEffect, useReducer, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { DiagramKind } from '../../src/doc/protocol';
import { saveNow, useDoc } from './context';
import { insertImages, moveTablePart } from './editorTools';
import {
  IconBold,
  IconBulletList,
  IconChevron,
  IconClear,
  IconCode,
  IconCodeBlock,
  IconColLeft,
  IconColRight,
  IconDeleteCol,
  IconDeleteRow,
  IconDeleteTable,
  IconDiagram,
  IconDown,
  IconImage,
  IconIndent,
  IconItalic,
  IconLeft,
  IconLink,
  IconMerge,
  IconOrderedList,
  IconOutdent,
  IconQuote,
  IconRedo,
  IconRight,
  IconRowAbove,
  IconRowBelow,
  IconRule,
  IconSplit,
  IconStrike,
  IconTable,
  IconUndo,
  IconUp,
} from './icons';

const NEW_KINDS: [DiagramKind, string][] = [
  ['component', 'Component (building blocks)'],
  ['deployment', 'Deployment'],
  ['sequence', 'Sequence (runtime scenario)'],
  ['communication', 'Communication'],
  ['timing', 'Timing'],
  ['context', 'Context'],
  ['class', 'Class (domain model)'],
  ['package', 'Package'],
  ['state', 'State machine'],
  ['activity', 'Activity'],
  ['object', 'Object'],
  ['composite', 'Composite structure'],
  ['interactionOverview', 'Interaction overview'],
];

const BLOCKS: { label: string; level: 0 | 2 | 3 | 4 }[] = [
  { label: 'Paragraph', level: 0 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
  { label: 'Heading 4', level: 4 },
];

/** Toolbar controls must not take the focus away from the editor. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

function Btn({ title, active, disabled, onClick, children, wide }: { title: string; active?: boolean; disabled?: boolean; onClick(): void; children: ReactNode; wide?: boolean }) {
  return (
    <button type="button" className={`tb-btn${active ? ' active' : ''}${wide ? ' wide' : ''}`} title={title} aria-label={title} aria-pressed={active} disabled={disabled} onMouseDown={keepFocus} onClick={onClick}>
      {children}
    </button>
  );
}

const Sep = () => <span className="tb-sep" />;

export function Toolbar() {
  const { activeEditor: editor, data, createDiagram, editDiagram } = useDoc();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [menu, setMenu] = useState<'diagram' | 'link' | 'block' | null>(null);
  const [href, setHref] = useState('');
  const menuRef = useRef<HTMLSpanElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  // Reflect the selection (bold, list, heading level, ...) as it moves.
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', rerender);
    return () => {
      editor.off('transaction', rerender);
    };
  }, [editor]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const off = !editor || editor.isDestroyed;
  const run = (fn: (e: Editor) => void) => () => {
    if (editor && !editor.isDestroyed) fn(editor);
  };
  const is = (name: string, attrs?: Record<string, unknown>) => !off && editor!.isActive(name, attrs);
  const can = (fn: (e: Editor) => boolean) => !off && fn(editor!);
  const inTable = is('table');
  const block = BLOCKS.find((b) => (b.level === 0 ? is('paragraph') : is('heading', { level: b.level }))) ?? BLOCKS[0]!;

  const insertDiagram = (e: Editor, src: string) => {
    e.chain().focus().insertContent({ type: 'archeryDiagram', attrs: { src } }).run();
    saveNow(e);
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tb-row">
        <span className="tb-menu" ref={menu === 'block' ? menuRef : undefined}>
          <button type="button" className="tb-btn tb-select" disabled={off} onMouseDown={keepFocus} onClick={() => setMenu(menu === 'block' ? null : 'block')} title="Paragraph style">
            <span>{block.label}</span>
            <IconChevron />
          </button>
          {menu === 'block' && editor && (
            <div className="popover block-menu" onMouseDown={keepFocus}>
              {BLOCKS.map((b) => (
                <button
                  type="button"
                  key={b.label}
                  className={`menu-item block-${b.level}${b === block ? ' current' : ''}`}
                  onClick={() => {
                    if (b.level === 0) editor.chain().focus().setParagraph().run();
                    else editor.chain().focus().setHeading({ level: b.level }).run();
                    setMenu(null);
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </span>
        <Sep />
        <Btn title="Bold (Ctrl+B)" active={is('bold')} disabled={off} onClick={run((e) => e.chain().focus().toggleBold().run())}>
          <IconBold />
        </Btn>
        <Btn title="Italic (Ctrl+I)" active={is('italic')} disabled={off} onClick={run((e) => e.chain().focus().toggleItalic().run())}>
          <IconItalic />
        </Btn>
        <Btn title="Strikethrough (Ctrl+Shift+S)" active={is('strike')} disabled={off} onClick={run((e) => e.chain().focus().toggleStrike().run())}>
          <IconStrike />
        </Btn>
        <Btn title="Inline code (Ctrl+E)" active={is('code')} disabled={off} onClick={run((e) => e.chain().focus().toggleCode().run())}>
          <IconCode />
        </Btn>
        <span className="tb-menu" ref={menu === 'link' ? menuRef : undefined}>
          <Btn
            title={is('link') ? 'Remove link' : 'Link'}
            active={is('link')}
            disabled={off}
            onClick={run((e) => {
              if (e.isActive('link')) {
                e.chain().focus().unsetLink().run();
                return;
              }
              setHref('https://');
              setMenu('link');
            })}
          >
            <IconLink />
          </Btn>
          {menu === 'link' && editor && (
            <form
              className="popover link-form"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (href.trim()) editor.chain().focus().setLink({ href: href.trim() }).run();
                setMenu(null);
              }}
            >
              <input autoFocus value={href} onChange={(ev) => setHref(ev.target.value)} placeholder="https://" aria-label="Link address" />
              <button type="submit">Set link</button>
            </form>
          )}
        </span>
        <Btn title="Clear formatting" disabled={off} onClick={run((e) => e.chain().focus().unsetAllMarks().clearNodes().run())}>
          <IconClear />
        </Btn>
        <Sep />
        <Btn title="Bulleted list" active={is('bulletList')} disabled={off} onClick={run((e) => e.chain().focus().toggleBulletList().run())}>
          <IconBulletList />
        </Btn>
        <Btn title="Numbered list" active={is('orderedList')} disabled={off} onClick={run((e) => e.chain().focus().toggleOrderedList().run())}>
          <IconOrderedList />
        </Btn>
        <Btn title="Indent list item (Tab)" disabled={!can((e) => e.can().sinkListItem('listItem'))} onClick={run((e) => e.chain().focus().sinkListItem('listItem').run())}>
          <IconIndent />
        </Btn>
        <Btn title="Outdent list item (Shift+Tab)" disabled={!can((e) => e.can().liftListItem('listItem'))} onClick={run((e) => e.chain().focus().liftListItem('listItem').run())}>
          <IconOutdent />
        </Btn>
        <Sep />
        <Btn title="Quote" active={is('blockquote')} disabled={off} onClick={run((e) => e.chain().focus().toggleBlockquote().run())}>
          <IconQuote />
        </Btn>
        <Btn title="Code block" active={is('codeBlock')} disabled={off} onClick={run((e) => e.chain().focus().toggleCodeBlock().run())}>
          <IconCodeBlock />
        </Btn>
        <Btn title="Divider" disabled={off} onClick={run((e) => e.chain().focus().setHorizontalRule().run())}>
          <IconRule />
        </Btn>
        <Sep />
        <Btn title="Insert table" disabled={off || inTable} onClick={run((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
          <IconTable />
        </Btn>
        <Btn title="Insert image (you can also paste or drop images)" disabled={off} onClick={() => imageInput.current?.click()}>
          <IconImage />
        </Btn>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (editor && !editor.isDestroyed && files.length) void insertImages(editor, files);
          }}
        />
        <span className="tb-menu" ref={menu === 'diagram' ? menuRef : undefined}>
          <button type="button" className={`tb-btn tb-select${menu === 'diagram' ? ' active' : ''}`} title="Insert a diagram at the cursor" disabled={off} onMouseDown={keepFocus} onClick={() => setMenu(menu === 'diagram' ? null : 'diagram')}>
            <IconDiagram />
            <span>Diagram</span>
            <IconChevron />
          </button>
          {menu === 'diagram' && editor && (
            <div className="popover diagram-menu" onMouseDown={keepFocus}>
              {data.diagramFiles.length > 0 && <div className="menu-label">Existing diagrams</div>}
              {data.diagramFiles.map((d) => (
                <button
                  type="button"
                  key={d.file}
                  className="menu-item"
                  onClick={() => {
                    insertDiagram(editor, d.file);
                    setMenu(null);
                  }}
                >
                  <span>{d.title}</span>
                  <span className="menu-hint">{d.type}</span>
                </button>
              ))}
              <div className="menu-label">New diagram</div>
              {NEW_KINDS.map(([kind, label]) => (
                <button
                  type="button"
                  key={kind}
                  className="menu-item"
                  onClick={async () => {
                    setMenu(null);
                    const target = editor;
                    const src = await createDiagram(kind);
                    if (src && !target.isDestroyed) insertDiagram(target, src);
                    if (src) setTimeout(() => editDiagram(src), 300);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </span>
        <span className="tb-spacer" />
        <Btn title="Undo (Ctrl+Z)" disabled={!can((e) => e.can().undo())} onClick={run((e) => e.chain().focus().undo().run())}>
          <IconUndo />
        </Btn>
        <Btn title="Redo (Ctrl+Y)" disabled={!can((e) => e.can().redo())} onClick={run((e) => e.chain().focus().redo().run())}>
          <IconRedo />
        </Btn>
      </div>
      {inTable && (
        <div className="tb-row tb-table" aria-label="Table">
          <span className="tb-label">Table</span>
          <Btn title="Insert row above" onClick={run((e) => e.chain().focus().addRowBefore().run())}>
            <IconRowAbove />
          </Btn>
          <Btn title="Insert row below" onClick={run((e) => e.chain().focus().addRowAfter().run())}>
            <IconRowBelow />
          </Btn>
          <Btn title="Move row up" onClick={run((e) => moveTablePart(e, 'row', -1))}>
            <IconUp />
          </Btn>
          <Btn title="Move row down" onClick={run((e) => moveTablePart(e, 'row', 1))}>
            <IconDown />
          </Btn>
          <Btn title="Delete row" onClick={run((e) => e.chain().focus().deleteRow().run())}>
            <IconDeleteRow />
          </Btn>
          <Sep />
          <Btn title="Insert column left" onClick={run((e) => e.chain().focus().addColumnBefore().run())}>
            <IconColLeft />
          </Btn>
          <Btn title="Insert column right" onClick={run((e) => e.chain().focus().addColumnAfter().run())}>
            <IconColRight />
          </Btn>
          <Btn title="Move column left" onClick={run((e) => moveTablePart(e, 'col', -1))}>
            <IconLeft />
          </Btn>
          <Btn title="Move column right" onClick={run((e) => moveTablePart(e, 'col', 1))}>
            <IconRight />
          </Btn>
          <Btn title="Delete column" onClick={run((e) => e.chain().focus().deleteColumn().run())}>
            <IconDeleteCol />
          </Btn>
          <Sep />
          <Btn title="Merge the selected cells (drag across cells to select them)" disabled={!can((e) => e.can().mergeCells())} onClick={run((e) => e.chain().focus().mergeCells().run())}>
            <IconMerge />
          </Btn>
          <Btn title="Split the merged cell" disabled={!can((e) => e.can().splitCell())} onClick={run((e) => e.chain().focus().splitCell().run())}>
            <IconSplit />
          </Btn>
          <Sep />
          <Btn title="Delete table" onClick={run((e) => e.chain().focus().deleteTable().run())}>
            <IconDeleteTable />
          </Btn>
        </div>
      )}
    </div>
  );
}
