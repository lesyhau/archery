// ReqIF's formatted text (XHTML) and the Markdown text of Archery's table cells, both ways.
// Paragraphs, line breaks, lists, bold, italic and links survive; other markup becomes its text.
import { el, localName, type XElement, type XNode } from './xml';

const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'tr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'hr', 'caption', 'thead', 'tbody', 'tfoot']);

/** XHTML content (the children of THE-VALUE) as Markdown. */
export function xhtmlToMarkdown(nodes: XNode[]): string {
  const blocks: string[] = [];
  let line = '';
  const flush = () => {
    const t = line.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
    if (t) blocks.push(t);
    line = '';
  };

  const inline = (n: XNode, pre: boolean): void => {
    if (n.type === 'text') {
      line += pre ? n.value : n.value.replace(/[ \t\r\n]+/g, ' ');
      return;
    }
    if (n.type === 'raw') {
      if (n.text.startsWith('<![CDATA[')) line += n.text.slice(9, -3);
      return;
    }
    const name = localName(n.name).toLowerCase();
    const inner = () => n.children.forEach((c) => inline(c, pre || name === 'pre'));
    if (name === 'br') {
      line += '\n';
      return;
    }
    if (BLOCKS.has(name)) {
      flush();
      if (name === 'ul' || name === 'ol') {
        // The items are the lines of one block.
        const items = n.children
          .filter((c): c is XElement => c.type === 'element')
          .map((c, k) => `${name === 'ol' ? `${k + 1}.` : '-'} ${xhtmlToMarkdown(c.children).replace(/\s*\n\s*/g, ' ')}`);
        if (items.length) blocks.push(items.join('\n'));
        return;
      }
      if (name === 'tr') {
        const cells = n.children.filter((c): c is XElement => c.type === 'element');
        line = cells.map((c) => xhtmlToMarkdown(c.children).replace(/\n+/g, ' ')).join(' | ');
        flush();
        return;
      }
      inner();
      flush();
      return;
    }
    const wrap = (mark: string) => {
      const before = line;
      line = '';
      inner();
      const content = line;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!;
      line = before + (m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : content);
    };
    if (name === 'b' || name === 'strong') return wrap('**');
    if (name === 'i' || name === 'em') return wrap('*');
    if (name === 'a') {
      const href = n.attrs.find((a) => a.name === 'href')?.value;
      const before = line;
      line = '';
      inner();
      const text = line.trim();
      line = before + (href && href !== text ? `[${text || href}](${href})` : text);
      return;
    }
    if (name === 'object') {
      const data = n.attrs.find((a) => a.name === 'data')?.value;
      const before = line;
      line = '';
      inner();
      const text = line.trim();
      line = before + (text || (data ? `[${data.split('/').pop()}]` : ''));
      return;
    }
    inner();
  };

  nodes.forEach((n) => inline(n, false));
  flush();
  return blocks.join('\n\n');
}

const X = 'xhtml:';

/** Inline Markdown (bold, italic, links) as XHTML nodes. */
function inlineNodes(text: string): XNode[] {
  const out: XNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push(el(`${X}b`, {}, inlineNodes(m[1])));
    else if (m[2] !== undefined) out.push(el(`${X}i`, {}, inlineNodes(m[2])));
    else out.push(el(`${X}a`, { href: m[4] }, [m[3]!]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Markdown as XHTML: one `xhtml:div` with paragraphs and lists (the content of THE-VALUE). */
export function markdownToXhtml(markdown: string): XElement {
  const div = el(`${X}div`);
  for (const block of markdown.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const bullets = lines.every((l) => /^[-*] /.test(l));
    const numbers = lines.every((l) => /^\d+[.)] /.test(l));
    if (bullets || numbers) {
      div.children.push(el(`${X}${bullets ? 'ul' : 'ol'}`, {}, lines.map((l) => el(`${X}li`, {}, inlineNodes(l.replace(/^([-*]|\d+[.)]) /, ''))))));
      continue;
    }
    const p = el(`${X}p`);
    lines.forEach((l, i) => {
      if (i) p.children.push(el(`${X}br`));
      p.children.push(...inlineNodes(l));
    });
    div.children.push(p);
  }
  return div;
}

/** XHTML content as plain text, for attributes of type string. */
export const plainOf = (md: string) => md.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
