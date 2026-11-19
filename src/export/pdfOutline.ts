// Page numbers for the PDF's table of contents. Chromium cannot print them itself (no target-counter),
// so the export prints twice: the first PDF's outline (bookmarks of the headings, written with
// --generate-pdf-document-outline) tells on which page each heading landed; the second print has them.
// A small reader for the PDFs Chromium (Skia) writes: plain objects, a page tree, an outline.

interface PdfObject {
  /** The object's text up to its stream data. */
  body: string;
}

function objects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const out = new Map<number, PdfObject>();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    let body = text.slice(start, end);
    const stream = body.indexOf('stream');
    if (stream >= 0) body = body.slice(0, stream);
    out.set(Number(m[1]), { body });
    re.lastIndex = end;
  }
  return out;
}

const ref = (body: string, key: string): number | undefined => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(body);
  return m ? Number(m[1]) : undefined;
};

/** A PDF text string: (literal) with escapes, or <hex> (UTF-16BE with a byte order mark, or bytes). */
export function pdfString(raw: string): string {
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s+/g, '');
    const bytes = Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
    return decodeBytes(bytes);
  }
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== '\\') {
      bytes.push(c.charCodeAt(0) & 0xff);
      continue;
    }
    const n = body[++i] ?? '';
    const simple: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (n in simple) bytes.push(simple[n]!);
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[++i];
      bytes.push(parseInt(oct, 8) & 0xff);
    } else if (n === '\r' || n === '\n') {
      if (n === '\r' && body[i + 1] === '\n') i++;
    } else bytes.push(n.charCodeAt(0) & 0xff);
  }
  return decodeBytes(Buffer.from(bytes));
}

function decodeBytes(bytes: Buffer): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return s;
  }
  return bytes.toString('latin1');
}

/** The string value of a key: a balanced (literal) or a <hex> string. */
function stringValue(body: string, key: string): string | undefined {
  const m = new RegExp(`/${key}\\s*([(<])`).exec(body);
  if (!m) return undefined;
  let i = m.index + m[0].length - 1;
  if (m[1] === '<') return pdfString(body.slice(i, body.indexOf('>', i) + 1));
  const start = i;
  let depth = 0;
  for (; i < body.length; i++) {
    if (body[i] === '\\') {
      i++;
      continue;
    }
    if (body[i] === '(') depth++;
    else if (body[i] === ')' && --depth === 0) break;
  }
  return pdfString(body.slice(start, i + 1));
}

/** Every bookmark in reading order with its 1-based page number. */
export function outlinePages(pdf: Buffer): { title: string; page: number }[] {
  const objs = objects(pdf);
  const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.body));
  if (!catalog) return [];
  // Pages in order (the page tree may be nested).
  const pageIndex = new Map<number, number>();
  const walk = (id: number | undefined, seen = new Set<number>()) => {
    if (id === undefined || seen.has(id)) return;
    seen.add(id);
    const o = objs.get(id);
    if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.body)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.body)?.[1] ?? '';
      for (const k of kids.matchAll(/(\d+)\s+0\s+R/g)) walk(Number(k[1]), seen);
    } else if (/\/Type\s*\/Page\b/.test(o.body)) pageIndex.set(id, pageIndex.size + 1);
  };
  walk(ref(catalog.body, 'Pages'));
  // The outline, depth first.
  const out: { title: string; page: number }[] = [];
  const visit = (id: number | undefined, seen: Set<number>) => {
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      const o = objs.get(id);
      if (!o) return;
      const title = stringValue(o.body, 'Title');
      const dest = /\/(?:Dest|D)\s*\[\s*(\d+)\s+0\s+R/.exec(o.body);
      const page = dest ? pageIndex.get(Number(dest[1])) : undefined;
      if (title !== undefined && page !== undefined) out.push({ title, page });
      visit(ref(o.body, 'First'), seen);
      id = ref(o.body, 'Next');
    }
  };
  const outlines = ref(catalog.body, 'Outlines');
  if (outlines !== undefined) visit(ref(objs.get(outlines)?.body ?? '', 'First'), new Set());
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Page numbers for the table of contents entries (ids in document order, with their number and title):
 * each entry takes the next bookmark whose text ends with its title.
 */
export function tocPages(entries: { id: string; number: string; title: string }[], outline: { title: string; page: number }[]): Record<string, number> {
  const pages: Record<string, number> = {};
  let from = 0;
  for (const e of entries) {
    const want = norm(e.title);
    const i = outline.findIndex((o, k) => k >= from && norm(o.title).endsWith(want));
    if (i < 0) continue;
    pages[e.id] = outline[i]!.page;
    from = i + 1;
  }
  return pages;
}
