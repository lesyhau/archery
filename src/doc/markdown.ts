// Markdown <-> ProseMirror document for one arc42 section file.
//
// markdown-it tokenizes (GFM tables, HTML enabled so directives survive), a token
// rewrite step turns `<!-- archery:... -->` comments into directive nodes, and
// prosemirror-markdown builds the document. Serialization writes the same Markdown
// dialect back, so a section that is opened and saved unchanged keeps its text.
import { getSchema } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { MarkdownParser, MarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import { sectionExtensions, type DiagramAttrs } from './extensions';
import { htmlTable, parseHtmlTable } from './htmlTable';

// ---------------------------------------------------------------------------
// directives
// ---------------------------------------------------------------------------

export type Directive =
  | { kind: 'help'; text: string }
  | ({ kind: 'diagram' } & DiagramAttrs)
  | { kind: 'table'; src: string; caption: string | null }
  | { kind: 'decisions'; src: string }
  /** The caption of the Markdown table that follows. */
  | { kind: 'caption'; text: string };

const COMMENT = /<!--([\s\S]*?)-->/g;

/** Splits `a key=1 key2="x y" flag` into words, keeping quoted values together. */
function words(s: string): string[] {
  return s.match(/[^\s"=]+="(?:[^"\\]|\\.)*"|[^\s]+/g) ?? [];
}

export function parseDirective(comment: string): Directive | undefined {
  const m = /^\s*archery:(\w+)\b([\s\S]*)$/.exec(comment);
  if (!m) return undefined;
  const [, kind, rest = ''] = m;
  if (kind === 'help') return { kind: 'help', text: rest.replace(/^\s*\n/, '').replace(/\s+$/, '') };
  if (kind === 'caption') {
    const raw = rest.trim();
    return { kind: 'caption', text: raw.startsWith('"') ? (JSON.parse(raw) as string) : raw };
  }
  const [src = '', ...args] = words(rest.trim());
  const option = (arg: string) => {
    const [key, raw] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    return [key, raw?.startsWith('"') ? (JSON.parse(raw) as string) : raw] as const;
  };
  if (kind === 'table') {
    let caption: string | null = null;
    for (const arg of args) {
      const [key, value] = option(arg);
      if (key === 'caption' && value) caption = value;
    }
    return { kind: 'table', src, caption };
  }
  if (kind === 'decisions') return { kind: 'decisions', src: src || 'decisions' };
  if (kind === 'diagram') {
    const attrs: DiagramAttrs = { src, width: null, height: null, collapsed: false, caption: null };
    for (const arg of args) {
      const [key, raw] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
      const value = raw?.startsWith('"') ? (JSON.parse(raw) as string) : raw;
      if (key === 'width' && value) attrs.width = /^\d+$/.test(value) ? `${value}px` : value;
      else if (key === 'height' && value && Number(value) > 0) attrs.height = Math.round(Number(value));
      else if (key === 'collapsed') attrs.collapsed = value !== 'false';
      else if (key === 'caption' && value !== undefined) attrs.caption = value;
    }
    return { kind: 'diagram', ...attrs };
  }
  return undefined;
}

export function formatDirective(d: Directive): string {
  switch (d.kind) {
    case 'help':
      return `<!-- archery:help\n${d.text.replaceAll('-->', '- ->')}\n-->`;
    case 'table':
      return `<!-- archery:table ${d.src}${d.caption ? ` caption=${JSON.stringify(d.caption.replaceAll('-->', '- ->'))}` : ''} -->`;
    case 'caption':
      return `<!-- archery:caption ${JSON.stringify(d.text.replaceAll('-->', '- ->'))} -->`;
    case 'decisions':
      return `<!-- archery:decisions ${d.src} -->`;
    case 'diagram': {
      const parts = [d.src];
      if (d.width) parts.push(`width=${d.width.endsWith('px') ? d.width.slice(0, -2) : d.width}`);
      if (d.height) parts.push(`height=${Math.round(d.height)}`);
      if (d.collapsed) parts.push('collapsed');
      if (d.caption) parts.push(`caption=${JSON.stringify(d.caption.replaceAll('-->', '- ->'))}`);
      return `<!-- archery:diagram ${parts.join(' ')} -->`;
    }
  }
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

let cachedSchema: Schema | undefined;
export function sectionSchema(): Schema {
  return (cachedSchema ??= getSchema(sectionExtensions()));
}

const md = new MarkdownIt('default', { html: true, linkify: false, typographer: false });

function directiveToken(TokenCtor: typeof Token, d: Directive): Token {
  const type = { help: 'archery_help', diagram: 'archery_diagram', table: 'archery_table', decisions: 'archery_decisions', caption: 'archery_caption' }[d.kind];
  const t = new TokenCtor(type, '', 0);
  t.block = true;
  t.meta = d as unknown as Record<string, unknown>;
  return t;
}

/** Rewrites markdown-it tokens into what the ProseMirror parser understands. */
function rewrite(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const TokenCtor = tokens[0]?.constructor as typeof Token | undefined;
  // `<!-- archery:caption "..." -->` belongs to the table right after it.
  let caption: string | null = null;
  const captioned = (table: Token) => {
    table.meta = { ...(table.meta ?? {}), caption };
    caption = null;
    return table;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'table_open') {
      out.push(captioned(t));
      continue;
    }
    if (t.type === 'html_block' && TokenCtor) {
      const htmlRows = parseHtmlTable(t.content);
      if (htmlRows) {
        const table = htmlTableTokens(TokenCtor, htmlRows);
        captioned(table[0]!);
        out.push(...table);
        continue;
      }
      // A block may hold several comments; it becomes directives only if it is nothing else.
      const comments = [...t.content.matchAll(COMMENT)];
      const leftover = t.content.replace(COMMENT, '').trim();
      const directives = comments.map((c) => parseDirective(c[1]!));
      if (comments.length > 0 && !leftover && directives.every(Boolean)) {
        for (const d of directives) {
          if (d!.kind === 'caption') caption = d!.text;
          else out.push(directiveToken(TokenCtor, d!));
        }
      } else {
        const raw = new TokenCtor('raw_html', '', 0);
        raw.block = true;
        raw.content = t.content.replace(/\n+$/, '');
        out.push(raw);
      }
      continue;
    }
    // Table cells hold inline content in markdown-it but paragraphs in the editor schema.
    if ((t.type === 'th_open' || t.type === 'td_open') && TokenCtor) {
      out.push(t, new TokenCtor('paragraph_open', 'p', 1));
      continue;
    }
    if ((t.type === 'th_close' || t.type === 'td_close') && TokenCtor) {
      out.push(new TokenCtor('paragraph_close', 'p', -1), t);
      continue;
    }
    if (t.type === 'inline' && t.children) {
      // Inline HTML (e.g. "<br>", or a literal "<placeholder>") is kept as plain text.
      t.children = t.children.map((c) => {
        if (c.type !== 'html_inline' || !TokenCtor) return c;
        const text = new TokenCtor('text', '', 0);
        text.content = c.content;
        return text;
      });
    }
    out.push(t);
  }
  return out;
}

/** Tokens for a table read from HTML (merged cells), as if it had been a Markdown table. */
function htmlTableTokens(TokenCtor: typeof Token, rows: ReturnType<typeof parseHtmlTable> & object): Token[] {
  const tok = (type: string, tag: string, nesting: 1 | 0 | -1) => {
    const t = new TokenCtor(type, tag, nesting);
    t.block = true;
    return t;
  };
  const out: Token[] = [tok('table_open', 'table', 1)];
  for (const row of rows) {
    out.push(tok('tr_open', 'tr', 1));
    for (const cell of row) {
      const open = tok(cell.header ? 'th_open' : 'td_open', cell.header ? 'th' : 'td', 1);
      if (cell.colspan > 1) open.attrSet('colspan', String(cell.colspan));
      if (cell.rowspan > 1) open.attrSet('rowspan', String(cell.rowspan));
      const [inline] = md.parseInline(cell.markdown, {});
      if (inline?.children) inline.children = inline.children.map((c) => (c.type === 'html_inline' ? Object.assign(new TokenCtor('text', '', 0), { content: c.content }) : c));
      out.push(open, tok('paragraph_open', 'p', 1), ...(inline ? [inline] : []), tok('paragraph_close', 'p', -1), tok(cell.header ? 'th_close' : 'td_close', cell.header ? 'th' : 'td', -1));
    }
    out.push(tok('tr_close', 'tr', -1));
  }
  out.push(tok('table_close', 'table', -1));
  return out;
}

const spans = (t: Token) => ({ colspan: Number(t.attrGet('colspan')) || 1, rowspan: Number(t.attrGet('rowspan')) || 1 });

let cachedParser: MarkdownParser | undefined;
function parser(): MarkdownParser {
  if (cachedParser) return cachedParser;
  const schema = sectionSchema();
  const tokenizer = { parse: (src: string, env: Record<string, unknown>) => rewrite(md.parse(src, env)) } as unknown as ConstructorParameters<typeof MarkdownParser>[1];
  const directive = (node: string, attrs: (d: any) => Record<string, unknown>) => ({ node, noCloseToken: true, getAttrs: (t: Token) => attrs(t.meta) });
  cachedParser = new MarkdownParser(schema, tokenizer, {
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    list_item: { block: 'listItem' },
    bullet_list: { block: 'bulletList', getAttrs: () => ({ tight: true }) },
    ordered_list: { block: 'orderedList', getAttrs: (t) => ({ start: Number(t.attrGet('start')) || 1, tight: true }) },
    heading: { block: 'heading', getAttrs: (t) => ({ level: Number(t.tag.slice(1)) }) },
    code_block: { block: 'codeBlock', noCloseToken: true },
    fence: { block: 'codeBlock', getAttrs: (t) => ({ language: t.info.trim() || null }), noCloseToken: true },
    hr: { node: 'horizontalRule' },
    image: { node: 'image', getAttrs: (t) => ({ src: t.attrGet('src'), title: t.attrGet('title') || null, alt: t.children?.[0]?.content || null }) },
    hardbreak: { node: 'hardBreak' },
    table: { block: 'table', getAttrs: (t) => ({ caption: (t.meta as { caption?: string | null } | null)?.caption ?? null }) },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: 'tableRow' },
    th: { block: 'tableHeader', getAttrs: (t) => spans(t) },
    td: { block: 'tableCell', getAttrs: (t) => spans(t) },
    em: { mark: 'italic' },
    strong: { mark: 'bold' },
    s: { mark: 'strike' },
    link: { mark: 'link', getAttrs: (t) => ({ href: t.attrGet('href'), title: t.attrGet('title') || null }) },
    code_inline: { mark: 'code', noCloseToken: true },
    raw_html: { node: 'rawHtml', noCloseToken: true, getAttrs: (t) => ({ html: t.content }) },
    archery_help: directive('archeryHelp', (d) => ({ text: d.text })),
    archery_diagram: directive('archeryDiagram', (d) => ({ src: d.src, width: d.width, height: d.height, collapsed: d.collapsed, caption: d.caption })),
    archery_table: directive('archeryTable', (d) => ({ src: d.src, caption: d.caption })),
    archery_decisions: directive('archeryDecisions', (d) => ({ src: d.src })),
  });
  return cachedParser;
}

export function parseMarkdown(markdown: string): PMNode {
  return parser().parse(markdown);
}

// ---------------------------------------------------------------------------
// serializing
// ---------------------------------------------------------------------------

function cellText(state: MarkdownSerializerState, cell: PMNode): string {
  // Serialize the cell's paragraphs on their own and flatten them into one table line.
  const inner = serializer().serialize(cell.type.schema.topNodeType.create(null, cell.content), { tightLists: true });
  return inner.trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|') || ' ';
}

/**
 * Text in square brackets that is no Markdown syntax, such as a traceability tag "[BOOTLOADER-AD 001]",
 * "[SRS_BL_012]" or "[REQ-1.2]": letters, digits, spaces and . / # : - (and "_" inside a word).
 */
export const BRACKETED = /\[[A-Za-z0-9](?:[A-Za-z0-9 ./#:-]|(?<=[A-Za-z0-9])_(?=[A-Za-z0-9]))*\]/g;

/**
 * Writes text escaped, except for bracketed text that stays plain text unescaped: what follows it is
 * not "(", "[" or ":" (an inline link, a reference or a link definition), it is not in a link, and it is
 * not a task list box "[x]". Tools that look for tags in the Markdown files then find them as typed.
 */
function writeText(state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number): void {
  const text = node.text ?? '';
  if (node.marks.some((m) => m.type.name === 'link')) return state.text(text);
  const after = (end: number) => (end < text.length ? text[end] : index + 1 < parent.childCount ? parent.child(index + 1).text?.[0] : undefined);
  let last = 0;
  for (const m of text.matchAll(BRACKETED)) {
    const end = m.index + m[0].length;
    if (/^\[[xX]\]$/.test(m[0]) || ['(', '[', ':'].includes(after(end) ?? '')) continue;
    if (m.index > last) state.text(text.slice(last, m.index));
    state.text(m[0], false);
    last = end;
  }
  if (last < text.length || !text) state.text(text.slice(last));
}

let cachedSerializer: MarkdownSerializer | undefined;
function serializer(): MarkdownSerializer {
  if (cachedSerializer) return cachedSerializer;
  const directiveNode = (toDirective: (node: PMNode) => Directive) => (state: MarkdownSerializerState, node: PMNode) => {
    state.write(formatDirective(toDirective(node)));
    state.closeBlock(node);
  };
  cachedSerializer = new MarkdownSerializer(
    {
      doc: (state, node) => state.renderContent(node),
      text: writeText,
      paragraph: (state, node) => {
        state.renderInline(node);
        state.closeBlock(node);
      },
      heading: (state, node) => {
        state.write(`${'#'.repeat(node.attrs.level as number)} `);
        state.renderInline(node, false);
        state.closeBlock(node);
      },
      blockquote: (state, node) => state.wrapBlock('> ', null, node, () => state.renderContent(node)),
      codeBlock: (state, node) => {
        const backticks = node.textContent.match(/`{3,}/gm);
        const fence = backticks ? `${backticks.sort().slice(-1)[0]}\`` : '```';
        state.write(`${fence}${(node.attrs.language as string | null) ?? ''}\n`);
        state.text(node.textContent, false);
        state.write('\n');
        state.write(fence);
        state.closeBlock(node);
      },
      horizontalRule: (state, node) => {
        state.write('---');
        state.closeBlock(node);
      },
      bulletList: (state, node) => state.renderList(node, '  ', () => '- '),
      orderedList: (state, node) => {
        const start = (node.attrs.start as number) ?? 1;
        const maxW = String(start + node.childCount - 1).length;
        const space = ' '.repeat(maxW + 2);
        state.renderList(node, space, (i) => {
          const n = String(start + i);
          return `${' '.repeat(maxW - n.length)}${n}. `;
        });
      },
      listItem: (state, node) => state.renderContent(node),
      hardBreak: (state, node, parent, index) => {
        for (let i = index + 1; i < parent.childCount; i++) {
          if (parent.child(i).type !== node.type) {
            state.write('\\\n');
            return;
          }
        }
      },
      image: (state, node) => {
        const alt = state.esc((node.attrs.alt as string) || '');
        const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : '';
        state.write(`![${alt}](${String(node.attrs.src).replace(/[()]/g, '\\$&')}${title})`);
      },
      table: (state, node) => {
        if (node.attrs.caption) {
          state.write(formatDirective({ kind: 'caption', text: String(node.attrs.caption) }));
          state.closeBlock(node);
        }
        let merged = false;
        node.descendants((n) => {
          if ((n.attrs.colspan as number) > 1 || (n.attrs.rowspan as number) > 1) merged = true;
          return !merged;
        });
        if (merged) {
          const htmlRows: Parameters<typeof htmlTable>[0] = [];
          node.forEach((row) => {
            const cells: Parameters<typeof htmlTable>[0][number] = [];
            row.forEach((cell) =>
              cells.push({
                header: cell.type.name === 'tableHeader',
                colspan: (cell.attrs.colspan as number) || 1,
                rowspan: (cell.attrs.rowspan as number) || 1,
                markdown: serializer().serialize(cell.type.schema.topNodeType.create(null, cell.content), { tightLists: true }).trim().replace(/\n\n+/g, '\\\n'),
              }),
            );
            htmlRows.push(cells);
          });
          state.write(htmlTable(htmlRows));
          state.closeBlock(node);
          return;
        }
        const rows: string[][] = [];
        node.forEach((row) => {
          const cells: string[] = [];
          row.forEach((cell) => cells.push(cellText(state, cell)));
          rows.push(cells);
        });
        const width = Math.max(...rows.map((r) => r.length));
        const line = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill(' ')].join(' | ')} |`;
        rows.forEach((cells, i) => {
          state.write(line(cells));
          state.ensureNewLine();
          if (i === 0) {
            state.write(`|${Array(width).fill('---').join('|')}|`);
            state.ensureNewLine();
          }
        });
        state.closeBlock(node);
      },
      tableRow: () => undefined,
      tableHeader: () => undefined,
      tableCell: () => undefined,
      rawHtml: (state, node) => {
        state.write(node.attrs.html as string);
        state.closeBlock(node);
      },
      archeryHelp: directiveNode((n) => ({ kind: 'help', text: n.attrs.text as string })),
      archeryDiagram: directiveNode((n) => ({ kind: 'diagram', ...(n.attrs as DiagramAttrs) })),
      archeryTable: directiveNode((n) => ({ kind: 'table', src: n.attrs.src as string, caption: (n.attrs.caption as string | null) ?? null })),
      archeryDecisions: directiveNode((n) => ({ kind: 'decisions', src: n.attrs.src as string })),
    },
    {
      italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
      bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
      strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
      code: {
        open: (_state, _mark, parent, index) => backticksFor(parent.child(index).text ?? '', -1),
        close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1).text ?? '', 1),
        escape: false,
      },
      link: {
        open: () => '[',
        close: (_state, mark) => `](${String(mark.attrs.href).replace(/[()"]/g, '\\$&')}${mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : ''})`,
        mixable: true,
      },
    },
  );
  return cachedSerializer;
}

function backticksFor(text: string, side: number): string {
  const ticks = /`+/g;
  let len = 0;
  for (let m; (m = ticks.exec(text)); ) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) result += '`';
  if (len > 0 && side < 0) result += ' ';
  return result;
}

export function serializeMarkdown(doc: PMNode): string {
  return serializer().serialize(doc, { tightLists: true }).replace(/\s+$/, '') + '\n';
}

/** Markdown -> editor JSON (what TipTap's setContent takes). */
export function markdownToJson(markdown: string): Record<string, unknown> {
  return ensureWritable(parseMarkdown(markdown).toJSON() as JsonNode) as unknown as Record<string, unknown>;
}

/** Editor JSON -> Markdown. */
export function jsonToMarkdown(json: Record<string, unknown>): string {
  return serializeMarkdown(sectionSchema().nodeFromJSON(json));
}

// ---------------------------------------------------------------------------

interface JsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
}

const WRITABLE = new Set(['paragraph', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'table', 'horizontalRule']);

/**
 * Gives every heading somewhere to type: if a heading is followed only by directives
 * (help, diagrams, tables) before the next heading, an empty paragraph is added after
 * the help text. Empty paragraphs are not written back to Markdown.
 */
export function ensureWritable(doc: JsonNode): JsonNode {
  const blocks = doc.content ?? [];
  const out: JsonNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    out.push(block);
    if (block.type !== 'heading') continue;
    let j = i + 1;
    let writable = false;
    while (j < blocks.length && blocks[j]!.type !== 'heading') {
      if (WRITABLE.has(blocks[j]!.type)) writable = true;
      j++;
    }
    if (writable) continue;
    // Insert after any help directly below the heading.
    while (blocks[i + 1]?.type === 'archeryHelp') out.push(blocks[++i]!);
    out.push({ type: 'paragraph' });
  }
  if (out.length === 0) out.push({ type: 'paragraph' });
  return { ...doc, content: out };
}
