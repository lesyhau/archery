// One arc42 section (one Markdown file) as a WYSIWYG editor. Saves on blur.
import { Extension, type Editor, type Extensions } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import { ArcheryDecisions, ArcheryDiagram, ArcheryHelp, ArcheryTable, RawHtml, sectionExtensions } from '../../src/doc/extensions';
import { jsonToMarkdown, markdownToJson } from '../../src/doc/markdown';
import type { DocSection } from '../../src/doc/protocol';
import { useDoc } from './context';
import { takeEdit } from './follow';
import { flashBlock, HelpIcons, ImageDrop, LiveFlash, TableCaptions, TableControls, TableWithFoot } from './editorTools';
import { DataTable, DecisionList, DiagramFrame, HelpNote, ImageFigure, RawHtmlView } from './nodeViews';

/** Holds the save function so node views can save after changing attributes. */
const ArcherySave = Extension.create<unknown, { save?: () => void }>({
  name: 'archerySave',
  addStorage: () => ({ save: undefined }),
});

let cached: Extensions | undefined;
function documentExtensions(): Extensions {
  if (cached) return cached;
  const views: Record<string, Extensions[number]> = {
    archeryDiagram: ArcheryDiagram.extend({ addNodeView: () => ReactNodeViewRenderer(DiagramFrame) }),
    archeryHelp: ArcheryHelp.extend({ addNodeView: () => ReactNodeViewRenderer(HelpNote) }),
    // Tables and the ADR list handle their own mouse and keyboard input; the editor must not select or
    // focus around them (that would close a cell editor right after it opened).
    archeryTable: ArcheryTable.extend({ addNodeView: () => ReactNodeViewRenderer(DataTable, { stopEvent: () => true }) }),
    archeryDecisions: ArcheryDecisions.extend({ addNodeView: () => ReactNodeViewRenderer(DecisionList, { stopEvent: () => true }) }),
    rawHtml: RawHtml.extend({ addNodeView: () => ReactNodeViewRenderer(RawHtmlView) }),
  };
  cached = [
    // Markdown tables with their "Add row" line.
    ...sectionExtensions({ tableView: TableWithFoot }).map((ext) =>
      // Images are figures: "Figure N: caption" under the image (the caption is the alt text).
      // Extend the configured extension so its options (inline images) stay.
      ext.name === 'image'
        ? ext.extend({ addNodeView: () => ReactNodeViewRenderer(ImageFigure, { as: 'span', stopEvent: ({ event }) => (event.target as Element | null)?.closest?.('.cap') != null }) })
        : (views[ext.name] ?? ext),
    ),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Click to write…'),
      showOnlyCurrent: false,
      includeChildren: false,
    }),
    ArcherySave,
    HelpIcons,
    ImageDrop,
    TableCaptions,
    TableControls,
    LiveFlash,
  ];
  return cached;
}

export function SectionEditor({ section, onEditor }: { section: DocSection; onEditor(id: string, editor: Editor | null): void }) {
  const { post, setActiveEditor } = useDoc();
  const lastSaved = useRef(section.markdown);
  const dirty = useRef(false);
  const fileRef = useRef(section.file);
  fileRef.current = section.file;

  const editor = useEditor(
    {
      extensions: documentExtensions(),
      content: markdownToJson(section.markdown),
      onUpdate: ({ transaction }) => {
        if (transaction.docChanged) dirty.current = true;
      },
      onFocus: ({ editor: e }) => setActiveEditor(e),
      onBlur: ({ editor: e }) => save(e),
      editorProps: { attributes: { class: 'section-body', spellcheck: 'true' } },
    },
    [],
  );

  function save(e: Editor | null = editor) {
    if (!e || e.isDestroyed || !dirty.current) return;
    dirty.current = false;
    const markdown = jsonToMarkdown(e.getJSON() as Record<string, unknown>);
    if (markdown === lastSaved.current) return;
    lastSaved.current = markdown;
    post({ type: 'save', file: fileRef.current, markdown });
  }

  useEffect(() => {
    if (!editor) return;
    (editor.storage as unknown as Record<string, { save?: () => void }>).archerySave!.save = () => {
      dirty.current = true;
      save(editor);
    };
    onEditor(section.id, editor);
    // Flush when the panel is hidden or closed.
    const flush = () => save(editor);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      onEditor(section.id, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Changes from outside (text editor, AI tools, rollback): replace the content unless the
  // user is typing in this section right now.
  useEffect(() => {
    if (!editor || section.markdown === lastSaved.current) return;
    if (editor.isFocused && dirty.current) return;
    const before = editor.state.doc;
    editor.commands.setContent(markdownToJson(section.markdown), { emitUpdate: false });
    lastSaved.current = section.markdown;
    dirty.current = false;
    // Live view: the agent's edit announced before lands; show the first block that changed.
    if (takeEdit(section.id)) {
      const after = editor.state.doc;
      // Same block: same kind and text (diagrams / tables: the same source); attribute defaults may differ.
      // Empty paragraphs (the editor's placeholder lines) do not count.
      type Block = typeof after;
      const same = (x: Block, y: Block) => x.type === y.type && x.textContent === y.textContent && (x.attrs.src ?? null) === (y.attrs.src ?? null);
      const blocks = (d: Block) => {
        const out: { node: Block; index: number }[] = [];
        d.forEach((node, _offset, index) => {
          if (!(node.type.name === 'paragraph' && node.childCount === 0)) out.push({ node, index });
        });
        return out;
      };
      const a = blocks(before);
      const b = blocks(after);
      let k = 0;
      while (k < a.length && k < b.length && same(a[k]!.node, b[k]!.node)) k++;
      const index = b[Math.min(k, b.length - 1)]?.index ?? 0;
      let pos = 0;
      for (let n = 0; n < index; n++) pos += after.child(n).nodeSize;
      window.setTimeout(() => flashBlock(editor, pos), 30);
    }
  }, [editor, section.markdown]);

  return <EditorContent editor={editor} />;
}
