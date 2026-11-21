// Architecture decision records (decisions/NNNN-title.md): YAML front matter, a "# Title" and "## " parts.
// The parts follow Michael Nygard's format (Context, Decision, Consequences), as arc42 chapter 9
// recommends, with the optional parts of MADR 4.0 (Decision Drivers, Considered Options, Confirmation).
// MADR's own headings ("Context and Problem Statement", "Decision Outcome") are read as the same parts.

export const ADR_PARTS = [
  { key: 'context', heading: 'Context', aliases: ['context', 'context and problem statement'], core: true },
  { key: 'drivers', heading: 'Decision Drivers', aliases: ['decision drivers', 'drivers'], core: false },
  { key: 'options', heading: 'Considered Options', aliases: ['considered options', 'options'], core: false },
  { key: 'decision', heading: 'Decision', aliases: ['decision', 'decision outcome'], core: true },
  { key: 'consequences', heading: 'Consequences', aliases: ['consequences'], core: true },
  { key: 'confirmation', heading: 'Confirmation', aliases: ['confirmation'], core: false },
] as const;

export type AdrPart = (typeof ADR_PARTS)[number]['key'];

export const ADR_STATUSES = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'] as const;

/** The front matter text (without the --- lines) and the Markdown after it. */
export function splitAdrText(text: string): { front: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { front: m[1]!, body: text.slice(m[0].length) } : { front: null, body: text };
}

interface Block {
  heading: string;
  text: string;
}

/** The body as the part before the first "## " heading and one block per "## " heading (code fences respected). */
function blocks(body: string): { preamble: string; blocks: Block[] } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  const pre: string[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  let fence: string | null = null;
  for (const line of lines) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
    const h = fence === null && !f ? /^##[ \t]+(.+?)[ \t#]*$/.exec(line) : null;
    if (h) {
      if (current) out.push({ heading: current.heading, text: current.lines.join('\n').trim() });
      current = { heading: h[1]!, lines: [] };
    } else (current ? current.lines : pre).push(line);
  }
  if (current) out.push({ heading: current.heading, text: current.lines.join('\n').trim() });
  return { preamble: pre.join('\n').trim(), blocks: out };
}

const partOf = (heading: string) => ADR_PARTS.findIndex((p) => (p.aliases as readonly string[]).includes(heading.trim().toLowerCase()));

export function adrTitle(body: string): string | undefined {
  return /^#[ \t]+(.+?)[ \t]*$/m.exec(blocks(body).preamble)?.[1];
}

/** The text of each known part (raw Markdown). */
export function readAdrParts(body: string): Partial<Record<AdrPart, string>> {
  const out: Partial<Record<AdrPart, string>> = {};
  for (const b of blocks(body).blocks) {
    const i = partOf(b.heading);
    if (i >= 0 && out[ADR_PARTS[i]!.key] === undefined) out[ADR_PARTS[i]!.key] = b.text;
  }
  return out;
}

function join(preamble: string, list: Block[]): string {
  const parts = [preamble, ...list.map((b) => `## ${b.heading}${b.text ? `\n\n${b.text}` : ''}`)].filter((p) => p !== '');
  return `${parts.join('\n\n')}\n`;
}

/**
 * Replaces the text of a part, keeping its heading as written. A missing part is added (when it has
 * text) in the usual order; an emptied optional part (drivers, options, confirmation) is removed.
 * Other parts stay.
 */
export function setAdrPart(body: string, key: AdrPart, text: string): string {
  const { preamble, blocks: list } = blocks(body);
  const index = ADR_PARTS.findIndex((p) => p.key === key);
  const def = ADR_PARTS[index]!;
  const value = text.replace(/\r\n/g, '\n').trim();
  const at = list.findIndex((b) => partOf(b.heading) === index);
  if (at >= 0) {
    if (!value && !def.core) list.splice(at, 1);
    else list[at] = { ...list[at]!, text: value };
  } else if (value) {
    const before = list.findIndex((b) => partOf(b.heading) > index);
    list.splice(before < 0 ? list.length : before, 0, { heading: def.heading, text: value });
  }
  return join(preamble, list);
}

/** Sets the "# Title" line (adds it at the top when there is none). */
export function setAdrTitle(body: string, title: string): string {
  const { preamble, blocks: list } = blocks(body);
  const next = /^#[ \t]+.*$/m.test(preamble) ? preamble.replace(/^#[ \t]+.*$/m, `# ${title.trim()}`) : `# ${title.trim()}${preamble ? `\n\n${preamble}` : ''}`;
  return join(next, list);
}
