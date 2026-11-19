// Tables with merged cells. GitHub-flavored Markdown has no colspan/rowspan, so such a table is
// written as an HTML <table> (rendered by GitHub, VS Code's preview and Pandoc) and read back
// into an editable table. Cell content stays Markdown-equivalent: the inline HTML used here is
// exactly what markdown-it renders for inline Markdown, and it is converted back on reading.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt('default', { html: false, linkify: false, breaks: false });

export interface HtmlCell {
  header: boolean;
  colspan: number;
  rowspan: number;
  /** Inline Markdown of the cell. */
  markdown: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : m));
const escapeMd = (s: string) => s.replace(/([\\`*_[\]~])/g, '\\$1');
const attr = (tag: string, name: string) => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? decode(m[1]!) : undefined;
};

/** Inline HTML (as produced by markdown-it renderInline) back to inline Markdown. */
export function inlineHtmlToMarkdown(html: string): string {
  let out = '';
  const re = /<(\/?)(strong|em|s|del|code|a|img|br)\b([^>]*)>|([^<]+)|(<)/gi;
  let inCode = false;
  let codeText = '';
  const links: string[] = [];
  for (const m of html.matchAll(re)) {
    const [, close, rawTag, attrs = '', text, lt] = m;
    if (text !== undefined || lt !== undefined) {
      const t = decode(text ?? '<');
      if (inCode) codeText += t;
      else out += escapeMd(t);
      continue;
    }
    const tag = rawTag!.toLowerCase();
    if (tag === 'code') {
      if (!close) {
        inCode = true;
        codeText = '';
      } else {
        inCode = false;
        const ticks = codeText.includes('`') ? '``' : '`';
        out += `${ticks}${codeText.includes('`') ? ` ${codeText} ` : codeText}${ticks}`;
      }
      continue;
    }
    if (tag === 'strong') out += '**';
    else if (tag === 'em') out += '*';
    else if (tag === 's' || tag === 'del') out += '~~';
    else if (tag === 'br') out += '\\\n';
    else if (tag === 'img') out += `![${escapeMd(attr(attrs, 'alt') ?? '')}](${(attr(attrs, 'src') ?? '').replace(/[()]/g, '\\$&')})`;
    else if (tag === 'a') {
      if (!close) {
        links.push(attr(attrs, 'href') ?? '');
        out += '[';
      } else out += `](${(links.pop() ?? '').replace(/[()]/g, '\\$&')})`;
    }
  }
  return out;
}

/** Parses an HTML <table> written by `htmlTable`. Returns undefined for other HTML. */
export function parseHtmlTable(html: string): HtmlCell[][] | undefined {
  const t = html.trim();
  if (!/^<table[\s>]/i.test(t) || !/<\/table>\s*$/i.test(t)) return undefined;
  const rows: HtmlCell[][] = [];
  for (const row of t.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: HtmlCell[] = [];
    for (const cell of row[1]!.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      cells.push({
        header: cell[1]!.toLowerCase() === 'th',
        colspan: Math.max(1, Number(attr(cell[2]!, 'colspan')) || 1),
        rowspan: Math.max(1, Number(attr(cell[2]!, 'rowspan')) || 1),
        markdown: inlineHtmlToMarkdown(cell[3]!.trim()),
      });
    }
    rows.push(cells);
  }
  return rows.length > 0 ? rows : undefined;
}

/** Writes cells (inline Markdown) as an HTML table, one row per line. */
export function htmlTable(rows: HtmlCell[][]): string {
  const lines = ['<table>'];
  for (const row of rows) {
    const cells = row.map((c) => {
      const tag = c.header ? 'th' : 'td';
      const span = `${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}`;
      // Hard breaks render as "<br>\n", soft breaks as "\n": keep each cell on one line.
      return `<${tag}${span}>${md.renderInline(c.markdown).replace(/<br>\n/g, '<br>').replace(/\n/g, ' ')}</${tag}>`;
    });
    lines.push(`<tr>${cells.join('')}</tr>`);
  }
  lines.push('</table>');
  return lines.join('\n');
}
