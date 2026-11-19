// The heading outline of a chapter's Markdown (for the sidebar's contents).

/** Plain text of a Markdown heading (no emphasis, code ticks or link targets). */
export function headingText(md: string): string {
  return md
    .replace(/\s+#+\s*$/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .trim();
}

/** The ## and ### headings of a chapter (outside code fences and HTML comments), with their lines. */
export function outlineOf(markdown: string): { level: 2 | 3; title: string; line: number }[] {
  const out: { level: 2 | 3; title: string; line: number }[] = [];
  let fence = false;
  let comment = false;
  markdown.split(/\r?\n/).forEach((text, line) => {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    if (fence) return;
    if (comment) {
      if (text.includes('-->')) comment = false;
      return;
    }
    if (/<!--/.test(text) && !/-->/.test(text)) comment = true;
    const m = /^(#{2,3})\s+(.+)$/.exec(text);
    if (m) out.push({ level: m[1]!.length as 2 | 3, title: headingText(m[2]!), line });
  });
  return out;
}
