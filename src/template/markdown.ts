// Pure Markdown helpers.

/** Level-2 headings (`## ...`) of a Markdown file, skipping fenced code blocks. */
export function headingsOf(markdown: string): { title: string; line: number }[] {
  const result: { title: string; line: number }[] = [];
  let inFence = false;
  markdown.split(/\r?\n/).forEach((text, line) => {
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence;
    if (inFence) return;
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(text);
    if (m?.[1]) result.push({ title: m[1], line });
  });
  return result;
}
