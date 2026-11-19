// Renders the whole architecture document as one self-contained HTML file (also the input for
// PDF export): numbered chapters and headings, a contents list, diagrams as inline SVG, data
// tables, ADR index, images embedded as data URIs, numbered captions and the change history.
// arc42 guidance (help directives) is left out. No VS Code APIs here, so it can be tested.
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { parseDirective, type Directive } from '../doc/markdown';
import type { DocTable, DocumentData } from '../doc/protocol';
import { resolveMerges, tableFor } from '../doc/tables';
import type { ExportSettings } from '../model/schema';
import { fillPlaceholders, marginSlots, resolveExportSettings, type ResolvedExportSettings } from './exportSettings';
import { docDiagramScene } from '../render/docDiagram';
import type { DiagramStyle } from '../render/scene';
import { sceneToSvg } from '../render/svgExport';

export type ExportContent = Pick<DocumentData, 'system' | 'title' | 'version' | 'changeHistory' | 'sections' | 'diagrams' | 'model' | 'tables' | 'decisions'>;

export interface ExportOptions {
  /** Image paths as written in the Markdown (e.g. `../images/x.png`) -> data URIs. */
  images?: Map<string, string>;
  /** e.g. "Archery 0.1.0". */
  generator: string;
  /** Export date, e.g. "2026-11-18". */
  date: string;
  /** Font, page, header / footer, contents ... (archery.yaml `export`); defaults when missing. */
  settings?: ExportSettings;
  /** How diagrams are drawn: the extension setting archery.diagramStyle. */
  diagramStyle?: DiagramStyle;
  /** PDF: the page of each contents entry (heading id -> page), from a first print (pdfOutline.ts). */
  tocPages?: Record<string, number>;
}

/** The contents entries of a rendered document (heading id, number, title), for tocPages. */
export function tocEntries(html: string): { id: string; number: string; title: string }[] {
  const unesc = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return [...html.matchAll(/<li class="l\d"><a href="#([^"]+)"><span class="num">([^<]*)<\/span><span class="t">([^<]*)<\/span>/g)].map((m) => ({ id: m[1]!, number: unesc(m[2]!), title: unesc(m[3]!) }));
}

export { EXPORT_DEFAULTS, resolveExportSettings, type ResolvedExportSettings } from './exportSettings';

const MARGINS: Record<ResolvedExportSettings['margins'], string> = { narrow: '12mm 12mm 14mm', normal: '18mm 16mm 20mm', wide: '25mm 25mm 27mm' };

/** A font family stack with fallbacks. */
const fontStack = (name: string) => `'${name.replace(/['\\;{}<>]/g, '')}', 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;

/** A CSS `content` value: text with {page} / {pages} as page counters. */
export function cssContent(template: string, values: Record<string, string>): string {
  const text = fillPlaceholders(template, values);
  const parts = text.split(/(\{pages?\})/);
  const out = parts
    .filter((x) => x !== '')
    .map((x) => (x === '{page}' ? 'counter(page)' : x === '{pages}' ? 'counter(pages)' : `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/</g, '\\3C ')}"`));
  return out.length ? out.join(' ') : '""';
}

/** @page rules: size, margins and the margin boxes (header, footer, page numbers). */
export function pageCss(set: ResolvedExportSettings, values: Record<string, string>): string {
  const slots = marginSlots(set);
  const boxStyle = `font-family: ${fontStack(set.font)}; font-size: ${Math.max(7, set.fontSize - 2.5)}pt; color: #59636e;`;
  const boxes = Object.entries(slots)
    .map(([slot, text]) => `@${slot} { content: ${cssContent(text!, values)}; ${boxStyle} }`)
    .join(' ');
  const first = set.cover ? `@page :first { ${Object.keys(slots).map((slot) => `@${slot} { content: none; }`).join(' ')} }` : '';
  return `@page { size: ${set.pageSize} ${set.orientation}; margin: ${MARGINS[set.margins]}; ${boxes} } ${first}`;
}

const COMMENT = /<!--([\s\S]*?)-->/g;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';

interface TocEntry {
  id: string;
  number: string;
  title: string;
  level: number;
}

export function renderDocumentHtml(content: ExportContent, options: ExportOptions): string {
  const set = resolveExportSettings(options.settings);
  const diagramStyle = options.diagramStyle;
  const images = options.images ?? new Map<string, string>();
  const counters = { table: 0, diagram: 0, figure: 0 };
  const usedIds = new Set<string>();
  const uniqueId = (base: string) => {
    let id = base;
    for (let i = 2; usedIds.has(id); i++) id = `${base}-${i}`;
    usedIds.add(id);
    return id;
  };

  const md = new MarkdownIt('default', { html: true, linkify: true, typographer: false });
  const cellMd = new MarkdownIt('default', { html: false, linkify: true, breaks: true });
  const imageSrc = (src: string | number | null) => images.get(String(src ?? '')) ?? String(src ?? '');
  // Images in the text are figures: "Figure N: alt".
  md.renderer.rules.image = (tokens, idx) => {
    const t = tokens[idx]!;
    const alt = t.content || '';
    const n = ++counters.figure;
    const title = t.attrGet('title');
    return `<span class="figure"><img src="${esc(imageSrc(t.attrGet('src')))}" alt="${esc(alt)}"${title ? ` title="${esc(String(title))}"` : ''}><span class="caption"><b>Figure ${n}${alt ? ':' : ''}</b>${alt ? ` ${esc(alt)}` : ''}</span></span>`;
  };
  // Images inside table cells are plain images.
  cellMd.renderer.rules.image = (tokens, idx) => {
    const t = tokens[idx]!;
    return `<img class="cell-image" src="${esc(imageSrc(t.attrGet('src')))}" alt="${esc(t.content || '')}">`;
  };

  const caption = (kind: 'Table' | 'Diagram', n: number, text: string | null | undefined, tag = 'p') =>
    `<${tag} class="caption"><b>${kind} ${n}${text ? ':' : ''}</b>${text ? ` ${esc(text)}` : ''}</${tag}>`;

  // Figures are anchored by their diagram (the first place it is shown), so drill-down markers can link to them.
  const anchorOf = (src: string) => `diagram-${src.replace(/^diagrams\//, '').replace(/\.(uml|seq|timing)\.json$/, '').replace(/[^A-Za-z0-9_-]+/g, '-')}`;
  const anchored = new Set<string>();
  const linkTo = (file: string) => {
    const target = content.diagrams[file];
    return target && target.kind !== 'missing' ? `#${anchorOf(file)}` : undefined;
  };
  const diagramHtml = (d: Extract<Directive, { kind: 'diagram' }>) => {
    const entry = content.diagrams[d.src];
    const n = ++counters.diagram;
    const id = anchored.has(d.src) ? '' : ` id="${anchorOf(d.src)}"`;
    anchored.add(d.src);
    if (!entry || entry.kind === 'missing') {
      return `<figure class="diagram missing"><p>Diagram not available: ${esc(entry?.kind === 'missing' ? entry.message : d.src)}</p>${caption('Diagram', n, d.caption ?? d.src, 'figcaption')}</figure>`;
    }
    let svg: string;
    try {
      const scene = docDiagramScene(entry, content.model, diagramStyle, d.src);
      svg = sceneToSvg(scene, { theme: 'light', background: false, title: d.caption || entry.title, link: linkTo })
        .replace(/^\s*<\?xml[^>]*>\s*/, '')
        .replace('<svg ', '<svg class="diagram-svg" role="img" ');
    } catch (e) {
      svg = `<p>Diagram could not be drawn: ${esc(e instanceof Error ? e.message : String(e))}</p>`;
    }
    return `<figure class="diagram"${id}><div class="diagram-body">${svg}</div>${caption('Diagram', n, d.caption || entry.title, 'figcaption')}</figure>`;
  };

  const dataTableHtml = (table: DocTable, title: string | null) => {
    const n = ++counters.table;
    const spans = resolveMerges(table.merges, table.rows, table.columns, table.keyField);
    const covered = new Set<string>();
    for (const s of spans) for (let i = s.r; i < s.r + s.rows; i++) for (let j = s.c; j < s.c + s.cols; j++) if (i !== s.r || j !== s.c) covered.add(`${i}:${j}`);
    const widths = table.columns.some((c) => c.width) ? `<colgroup>${table.columns.map((c) => `<col${c.width ? ` style="width:${c.width}%"` : ''}>`).join('')}</colgroup>` : '';
    const head = `<thead><tr>${table.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>`;
    const body = table.rows.length
      ? table.rows
          .map(
            (row, r) =>
              `<tr>${table.columns
                .map((col, c) => {
                  if (covered.has(`${r}:${c}`)) return '';
                  const s = spans.find((x) => x.r === r && x.c === c);
                  const attrs = s ? `${s.rows > 1 ? ` rowspan="${s.rows}"` : ''}${s.cols > 1 ? ` colspan="${s.cols}"` : ''}` : '';
                  return `<td${attrs}>${cellMd.renderInline(row[col.field] ?? '')}</td>`;
                })
                .join('')}</tr>`,
          )
          .join('')
      : `<tr><td class="empty" colspan="${table.columns.length || 1}">No entries yet.</td></tr>`;
    return `<figure class="table">${caption('Table', n, title || table.title, 'figcaption')}<table>${widths}${head}<tbody>${body}</tbody></table></figure>`;
  };

  const decisionsHtml = () => {
    const n = ++counters.table;
    const rows = content.decisions.length
      ? content.decisions.map((d) => `<tr><td class="nowrap">ADR-${esc(d.number)}</td><td>${esc(d.title)}</td><td>${esc(d.status ?? '')}</td><td class="nowrap">${esc(d.date ?? '')}</td></tr>`).join('')
      : '<tr><td class="empty" colspan="4">No decisions recorded yet.</td></tr>';
    return `<figure class="table">${caption('Table', n, 'Architecture decisions', 'figcaption')}<table><thead><tr><th>#</th><th>Decision</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></figure>`;
  };

  const toc: TocEntry[] = [];

  const renderSection = (section: ExportContent['sections'][number]) => {
    const tokens = md.parse(section.markdown, {});
    const out: Token[] = [];
    const TokenCtor = tokens[0]?.constructor as (new (type: string, tag: string, nesting: number) => Token) | undefined;
    const html = (text: string) => {
      const t = new TokenCtor!('html_block', '', 0);
      t.content = text;
      return t;
    };
    let pendingCaption: string | null = null;
    let h2 = 0;
    let h3 = 0;
    let h4 = 0;
    const chapter = set.numberHeadings && section.number !== undefined ? String(section.number) : '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.type === 'html_block' && TokenCtor) {
        const comments = [...t.content.matchAll(COMMENT)];
        const leftover = t.content.replace(COMMENT, '').trim();
        const directives = comments.map((c) => parseDirective(c[1]!));
        if (comments.length > 0 && !leftover && directives.every(Boolean)) {
          for (const d of directives as Directive[]) {
            if (d.kind === 'caption') pendingCaption = d.text;
            else if (d.kind === 'diagram') out.push(html(diagramHtml(d)));
            else if (d.kind === 'table') {
              const table = tableFor(content.tables, d.src);
              out.push(html(table ? dataTableHtml(table, d.caption) : `<p class="missing">Data not found: ${esc(d.src)}</p>`));
            } else if (d.kind === 'decisions') out.push(html(decisionsHtml()));
            // help: arc42 guidance is for authors, not part of the exported document
          }
          continue;
        }
        if (/^\s*<table[\s>]/i.test(t.content)) {
          // A Markdown table with merged cells (stored as HTML).
          out.push(html(`<figure class="table">${caption('Table', ++counters.table, pendingCaption, 'figcaption')}${t.content}</figure>`));
          pendingCaption = null;
          continue;
        }
      }
      if (t.type === 'table_open' && TokenCtor) {
        out.push(html(`<figure class="table">${caption('Table', ++counters.table, pendingCaption, 'figcaption')}`));
        pendingCaption = null;
        out.push(t);
        continue;
      }
      if (t.type === 'table_close' && TokenCtor) {
        out.push(t, html('</figure>'));
        continue;
      }
      // Inline HTML (e.g. a literal "<building block 1>" placeholder) is text, as in the editor.
      if (t.type === 'inline' && t.children && TokenCtor) {
        t.children = t.children.map((c) => {
          if (c.type !== 'html_inline' || c.meta?.generated) return c;
          const text = new TokenCtor('text', '', 0);
          text.content = c.content;
          return text;
        });
      }
      if (t.type === 'heading_open') {
        const level = Number(t.tag.slice(1));
        const inline = tokens[i + 1];
        const text = inline?.content ?? '';
        let number = '';
        if (level === 1) number = chapter;
        else if (level === 2) {
          h2++;
          h3 = 0;
          h4 = 0;
          number = chapter && `${chapter}.${h2}`;
        } else if (level === 3) {
          h3++;
          h4 = 0;
          number = chapter && `${chapter}.${h2}.${h3}`;
        } else if (level === 4) {
          h4++;
          number = chapter && `${chapter}.${h2}.${h3}.${h4}`;
        }
        const id = level === 1 ? uniqueId(`sec-${section.id}`) : uniqueId(`${section.id}-${slug(text)}`);
        t.attrSet('id', id);
        if (level <= set.tocDepth) toc.push({ id, number, title: text, level });
        if (number && inline?.children && TokenCtor) {
          const num = new TokenCtor('html_inline', '', 0);
          num.content = `<span class="num">${esc(number)}</span> `;
          num.meta = { generated: true };
          inline.children.unshift(num);
        }
      }
      out.push(t);
    }
    return `<section class="chapter" id="chapter-${esc(section.id)}">${md.renderer.render(out, md.options, {})}</section>`;
  };

  const chapters = content.sections.map(renderSection).join('\n');

  const historyNumber = set.numberHeadings ? String(Math.max(0, ...content.sections.map((s) => s.number ?? 0)) + 1) : '';
  const historyId = uniqueId('sec-change-history');
  if (set.changeHistory && set.tocDepth >= 1) toc.push({ id: historyId, number: historyNumber, title: 'Change history', level: 1 });
  const released = content.changeHistory.at(-1)?.version;
  const historyRows = content.changeHistory.length
    ? content.changeHistory.map((r) => `<tr><td class="nowrap">${esc(r.version)}</td><td class="nowrap">${esc(r.date)}</td><td class="nowrap">${esc(r.author ?? '')}</td><td>${esc(r.changes)}</td></tr>`).join('')
    : '<tr><td class="empty" colspan="4">No releases yet.</td></tr>';
  const history = !set.changeHistory ? '' : `<section class="chapter" id="chapter-change-history"><h1 id="${historyId}">${historyNumber ? `<span class="num">${historyNumber}</span> ` : ''}Change history</h1>
<p>Current version: v${esc(content.version)}${released && released !== content.version ? ` (unreleased changes since v${esc(released)})` : ''}</p>
<figure class="table">${caption('Table', ++counters.table, 'Change history', 'figcaption')}<table><thead><tr><th>Version</th><th>Date</th><th>Author</th><th>Changes</th></tr></thead><tbody>${historyRows}</tbody></table></figure></section>`;

  const tocHtml = !toc.length ? '' : `<nav class="toc" aria-label="Contents"><h2>Contents</h2><ol>${toc
    .map((e) => {
      const page = options.tocPages?.[e.id];
      // PDF: the page number on the right, after a dotted leader.
      const pg = page === undefined ? '' : `<span class="lead" aria-hidden="true"></span><span class="pg">${page}</span>`;
      return `<li class="l${e.level}"><a href="#${e.id}"><span class="num">${esc(e.number)}</span><span class="t">${esc(e.title)}</span>${pg}</a></li>`;
    })
    .join('')}</ol></nav>`;

  const docTitle = `${content.system} - Architecture Design Document`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(options.generator)}">
<title>${esc(docTitle)}</title>
<style>${EXPORT_CSS}
:root { --font: ${fontStack(set.font)}; --heading-font: ${fontStack(set.headingFont)}; --size: ${set.fontSize}pt; }
${pageCss(set, { title: content.title || docTitle, system: content.system, version: content.version, date: options.date })}
${set.chapterBreaks ? '' : '@media print { .chapter { break-before: auto; } .chapter h1 { margin-top: 28px; } }'}</style>
</head>
<body>
<header class="cover${set.cover ? '' : ' compact'}">
<h1 class="doc-title">${esc(content.title || docTitle)}</h1>
<p class="doc-kind">Architecture Design Document</p>
<p class="doc-meta">${esc(content.system)} · Version ${esc(content.version)} · ${esc(options.date)}</p>
</header>
${tocHtml}
<main>
${chapters}
${history}
</main>
<footer class="doc-footer">Structure based on the arc42 template. Generated with ${esc(options.generator)}.</footer>
</body>
</html>
`;
}

/** Image paths referenced by the document (Markdown text and data table cells), for embedding. */
export function imageReferences(content: ExportContent): string[] {
  const found = new Set<string>();
  const scan = (text: string) => {
    for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.add(m[1]!);
  };
  for (const s of content.sections) scan(s.markdown);
  for (const t of Object.values(content.tables)) for (const row of t.rows) for (const v of Object.values(row)) scan(v);
  return [...found].filter((src) => !/^(https?:|data:)/i.test(src));
}

const EXPORT_CSS = `
:root { color-scheme: light; --ink: #1f2328; --muted: #59636e; --line: #d1d9e0; --well: #f6f8fa; --accent: #0969da; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0 auto; max-width: 900px; padding: 32px 40px 48px; background: #fff; color: var(--ink);
  font-family: var(--font); font-size: var(--size); line-height: 1.6; }
h1, h2, h3, h4, .doc-title { font-family: var(--heading-font); }
a { color: var(--accent); text-decoration: none; }
.cover { padding: 48px 0 32px; border-bottom: 1px solid var(--line); margin-bottom: 24px; }
.doc-title { margin: 0 0 8px; font-size: 2.1em; line-height: 1.25; }
.doc-kind { margin: 0; font-size: 1.2em; color: var(--muted); }
.doc-meta { margin: 6px 0 0; color: var(--muted); font-size: 0.93em; }
.cover.compact { padding: 8px 0 16px; }
.cover.compact .doc-title { font-size: 1.75em; }
.toc h2 { font-size: 1.33em; margin: 0 0 8px; }
.toc ol { list-style: none; margin: 0 0 24px; padding: 0; }
.toc li a { display: flex; align-items: baseline; padding: 2px 0; color: var(--ink); }
.toc li.l1 a { font-weight: 600; }
.toc .num { flex: none; color: var(--muted); font-variant-numeric: tabular-nums; }
.toc .t { min-width: 0; }
/* A child's number starts where its parent's title starts. */
.toc li.l1 .num { width: 1.8em; }
.toc li.l2 { padding-left: 1.8em; }
.toc li.l2 .num { width: 2.6em; }
.toc li.l3 { padding-left: 4.4em; }
.toc li.l3 .num { width: 3.4em; }
.toc li.l4 { padding-left: 7.8em; }
.toc li.l4 .num { width: 4.2em; }
.toc .lead { flex: 1 1 auto; min-width: 1.5em; margin: 0 0.4em; border-bottom: 1.5px dotted var(--muted); transform: translateY(-0.28em); }
.toc .pg { flex: none; min-width: 1.6em; text-align: right; font-weight: 400; font-variant-numeric: tabular-nums; }
.chapter h1 { font-size: 1.75em; line-height: 1.3; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.chapter h2 { font-size: 1.33em; margin: 28px 0 8px; }
.chapter h3 { font-size: 1.1em; margin: 22px 0 6px; }
.chapter h4 { font-size: 1em; margin: 18px 0 4px; }
h1 .num, h2 .num, h3 .num { color: var(--muted); font-weight: 500; margin-right: 0.35em; }
p, ul, ol { margin: 0 0 12px; }
blockquote { margin: 0 0 12px; padding: 4px 16px; background: var(--well); color: var(--muted); border-radius: 4px; }
code { font-family: Consolas, 'SF Mono', Menlo, monospace; font-size: 0.9em; background: var(--well); padding: 1px 4px; border-radius: 3px; }
pre { background: var(--well); padding: 12px; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; }
figure { margin: 16px 0 20px; }
.caption { margin: 0 0 6px; font-size: 0.9em; color: var(--ink); }
.caption b { font-weight: 600; }
figure.diagram .caption { margin: 6px 0 0; text-align: center; }
figure.table .caption { margin: 0 0 10px; text-align: center; }
table { width: 100%; border-collapse: collapse; font-size: 0.93em; }
th, td { padding: 6px 10px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
th { background: var(--well); font-weight: 600; }
td.empty { color: var(--muted); font-style: italic; }
td.nowrap { white-space: nowrap; }
.cell-image { max-width: 220px; max-height: 160px; vertical-align: middle; }
.diagram-body { text-align: center; }
.diagram-svg { max-width: 100%; height: auto; }
.figure { display: flex; flex-direction: column; align-items: center; gap: 6px; width: fit-content; max-width: 100%; margin: 8px auto; }
.figure img { max-width: 100%; }
.figure .caption { margin: 0; text-align: center; }
.missing { color: #d1242f; }
.doc-footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8em; }
@media print {
  body { max-width: none; padding: 0; }
  .cover:not(.compact) { padding-top: 30vh; border-bottom: 0; break-after: page; }
  .toc { break-after: page; }
  .chapter { break-before: page; }
  .chapter h1 { margin-top: 0; }
  h1, h2, h3, h4 { break-after: avoid; }
  figure, tr, .figure { break-inside: avoid; }
  a { color: inherit; }
}
`;
