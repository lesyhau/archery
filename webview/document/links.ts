// Links in the document view. VS Code would open every clicked link in the browser, relative ones as
// the webview's resource URL. Instead: a link to a chapter, a heading, a decision record or a diagram
// of the documentation goes there in the page; anything else (a source file, a web page) is opened by
// the extension (documentPanel.ts, openLink).
import type { DocumentData } from '../../src/doc/protocol';

export interface LinkTargets {
  data(): DocumentData | null;
  /** Scrolls to a chapter (and to a heading in it, by its anchor slug). */
  showSection(sectionId: string, slug?: string): void;
  openDecision(file: string): void;
  showDiagram(src: string): void;
  /** Anything else: `href` as written, relative to the folder `base` of the documentation. */
  openOutside(href: string, base: string): void;
}

/** "a/b/../c" -> "a/c"; leading ".." that leave the root stay. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** GitHub-style heading anchors: "## Quality Goals" -> "quality-goals". */
export const headingSlug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Follows a link written in a section (base "sections"), a decision ("decisions") or a data table (""). */
export function followLink(href: string, base: string, t: LinkTargets, from?: Element): void {
  const data = t.data();
  if (href.startsWith('#')) {
    const section = from?.closest('.doc-section')?.id.slice(4);
    if (section) t.showSection(section, decode(href.slice(1)));
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) {
    if (/^(https?|mailto|file):/i.test(href)) t.openOutside(href, base);
    return;
  }
  const [rawPath = '', fragment] = href.split('#', 2);
  const path = rawPath.startsWith('/') || /^[a-z]:[\\/]/i.test(rawPath) ? null : normalizePath(`${base}/${decode(rawPath)}`);
  if (data && path !== null) {
    const section = data.sections.find((s) => s.file === path);
    if (section) return t.showSection(section.id, fragment ? decode(fragment) : undefined);
    const decision = data.decisions.find((d) => d.file === path);
    if (decision) return t.openDecision(decision.file);
    if (data.diagrams[path] || data.diagramFiles.some((f) => f.file === path)) return t.showDiagram(path);
  }
  t.openOutside(href, base);
}

/** Catches link clicks before VS Code does. Returns the function that removes the listeners. */
export function installLinkHandler(t: LinkTargets): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.type === 'auxclick' && e.button !== 1) return;
    // Only links written in the content (chapters, decision fields, table cells); the page's own links,
    // like the contents entries, handle their clicks themselves.
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!a || a.closest('svg') || !a.closest('[data-link-base]')) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute('href') ?? '';
    // Selecting text across a link is not a click on it.
    const sel = window.getSelection();
    if (e.type === 'click' && sel && !sel.isCollapsed && a.contains(sel.anchorNode)) return;
    const base = a.closest<HTMLElement>('[data-link-base]')?.dataset.linkBase ?? 'sections';
    if (href) followLink(href, base, t, a);
  };
  // Capture on the window: runs before (and stops) the click handling VS Code adds to the page.
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
  return () => {
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('auxclick', onClick, true);
  };
}
