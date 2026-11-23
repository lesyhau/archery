// Find and replace in the document, laid out like VS Code's editor find widget: a toggle for the
// replace row, the find box with Match Case / Whole Word / Regular Expression, the match count,
// previous / next / close, and Replace / Replace All. Matches are painted with the CSS Custom
// Highlight API (the page's DOM is left alone); replacing goes through the chapter's editor, so it
// is saved and undone (Ctrl+Z) like typing.
import type { Editor } from '@tiptap/core';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { saveNow } from './context';

export interface FindWidgetHandle {
  open(replace: boolean): void;
  /** F3 / Shift+F3: the next / previous match (opens the widget when it is closed). */
  step(dir: 1 | -1): void;
}

interface Match {
  range: Range;
  text: string;
}

interface Options {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

const MAX_MATCHES = 5000;
/** Text inside these is not part of the document's text (controls, pop-ups, drawings). */
const SKIP = '.toolbar, .find-widget, button, input, textarea, select, svg, style, script, .help-pop, [aria-hidden="true"]';
/** A match never runs from one of these into the next. */
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, figcaption, caption, dt, dd, blockquote, summary, div, section, main';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The search as a regular expression, or an error message when it is not a valid one. */
function compile(query: string, o: Options): RegExp | string | null {
  if (!query) return null;
  let source = o.regex ? query : escapeRegExp(query);
  if (o.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${o.caseSensitive ? '' : 'i'}`);
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid regular expression';
  }
}

/** The document's text, block by block: each block's text nodes and their joined text. */
function textBlocks(root: Element): { nodes: Text[]; text: string }[] {
  const blocks: { nodes: Text[]; text: string }[] = [];
  let block: Element | null = null;
  let current: { nodes: Text[]; text: string } | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n instanceof Element ? (n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    const parent = text.parentElement;
    if (!text.data || !parent || (parent.offsetParent === null && getComputedStyle(parent).position !== 'fixed')) continue;
    const owner = parent.closest(BLOCK);
    if (owner !== block || !current) {
      block = owner;
      current = { nodes: [], text: '' };
      blocks.push(current);
    }
    current.nodes.push(text);
    current.text += text.data;
  }
  return blocks;
}

function search(root: Element, re: RegExp): Match[] {
  const matches: Match[] = [];
  for (const { nodes, text } of textBlocks(root)) {
    re.lastIndex = 0;
    let node = 0;
    let base = 0;
    // Text node and offset for a position in the block's text (positions only grow).
    const locate = (pos: number, end: boolean): [Text, number] => {
      while (node < nodes.length - 1 && (end ? pos > base + nodes[node]!.data.length : pos >= base + nodes[node]!.data.length)) {
        base += nodes[node]!.data.length;
        node++;
      }
      return [nodes[node]!, pos - base];
    };
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      const range = document.createRange();
      range.setStart(...locate(m.index, false));
      range.setEnd(...locate(m.index + m[0].length, true));
      matches.push({ range, text: m[0] });
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }
  return matches;
}

/** Where a match is in a chapter's editor, if it can be replaced there. */
function editTarget(match: Match): { editor: Editor; from: number; to: number } | null {
  const host = (n: Node) => (n.parentElement?.closest('.ProseMirror') ?? null) as (HTMLElement & { editor?: Editor }) | null;
  const pm = host(match.range.startContainer);
  const editor = pm?.editor;
  if (!pm || !editor || editor.isDestroyed || !editor.isEditable || host(match.range.endContainer) !== pm) return null;
  try {
    const from = editor.view.posAtDOM(match.range.startContainer, match.range.startOffset);
    const to = editor.view.posAtDOM(match.range.endContainer, match.range.endOffset);
    return to > from && editor.state.doc.textBetween(from, to) === match.text ? { editor, from, to } : null;
  } catch {
    return null;
  }
}

function paint(matches: Match[], current: number) {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return;
  CSS.highlights.set('archery-find', new Highlight(...matches.filter((_, i) => i !== current).map((m) => m.range)));
  const cur = matches[current];
  if (cur) CSS.highlights.set('archery-find-current', new Highlight(cur.range));
  else CSS.highlights.delete('archery-find-current');
}

function unpaint() {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return;
  CSS.highlights.delete('archery-find');
  CSS.highlights.delete('archery-find-current');
}

/** The bottom of the sticky formatting toolbar: what is under it is out of view. */
const toolbarBottom = () => document.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? 0;

function scrollToMatch(match: Match) {
  const inView = () => {
    const r = match.range.getBoundingClientRect();
    return r.top >= toolbarBottom() + 8 && r.bottom <= window.innerHeight - 8 && r.left >= 0 && r.right <= window.innerWidth;
  };
  if (inView()) return;
  // Brings the match into wide tables' own scroll areas, then centers it in the window.
  match.range.startContainer.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = match.range.getBoundingClientRect();
  const top = toolbarBottom();
  window.scrollBy({ top: r.top + r.height / 2 - (top + (window.innerHeight - top) / 2) });
}

function OptionToggle({ icon, title, on, onToggle }: { icon: string; title: string; on: boolean; onToggle(): void }) {
  return (
    <button type="button" className={`fw-option${on ? ' on' : ''}`} title={title} aria-label={title} aria-pressed={on} onClick={onToggle}>
      <span className={`codicon codicon-${icon}`} aria-hidden="true" />
    </button>
  );
}

function Action({ icon, title, disabled, onClick }: { icon: string; title: string; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" className="fw-action" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <span className={`codicon codicon-${icon}`} aria-hidden="true" />
    </button>
  );
}

export const FindWidget = forwardRef<FindWidgetHandle>(function FindWidget(_, ref) {
  const [open, setOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<Options>({ caseSensitive: false, wholeWord: false, regex: false });
  const [matches, setMatches] = useState<Match[]>([]);
  const [current, setCurrent] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [top, setTop] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const state = useRef({ matches, current });
  state.current = { matches, current };
  /** The next search result brings its current match into view (not after edits made elsewhere). */
  const reveal = useRef(false);

  const root = () => document.querySelector('main.content');

  /** Searches again; `pick` chooses the current match among the new ones. */
  const run = useCallback(
    (pick: (found: Match[]) => number) => {
      const re = compile(query, options);
      if (typeof re === 'string') {
        setError(re);
        setMatches([]);
        setCurrent(-1);
        return;
      }
      setError(null);
      const host = root();
      const found = re && host ? search(host, re) : [];
      setMatches(found);
      setCurrent(found.length ? Math.max(0, Math.min(found.length - 1, pick(found))) : -1);
    },
    [query, options],
  );

  // A new search starts at the first match in view (or after it), as VS Code starts at the cursor.
  useEffect(() => {
    if (!open) return;
    reveal.current = true;
    run((found) => {
      const at = found.findIndex((m) => m.range.getBoundingClientRect().bottom >= toolbarBottom());
      return at < 0 ? 0 : at;
    });
  }, [open, run]);

  // The document changes under the search (typing, a replace, an agent's edit): search again,
  // keeping the place.
  useEffect(() => {
    const host = root();
    if (!open || !host || !query) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver((records) => {
      if (records.every((r) => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('.toolbar'))) return;
      clearTimeout(timer);
      timer = setTimeout(() => run(() => state.current.current), 120);
    });
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [open, query, run]);

  useEffect(() => {
    if (open) paint(matches, current);
    else unpaint();
  }, [open, matches, current]);

  // Sits right under the sticky formatting toolbar, as the editor's find widget sits under the tabs.
  useEffect(() => {
    if (!open) return;
    const toolbar = document.querySelector('.toolbar');
    const place = () => setTop(Math.max(0, toolbarBottom()));
    place();
    const observer = new ResizeObserver(place);
    if (toolbar) observer.observe(toolbar);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place);
    };
  }, [open]);

  const go = (step: 1 | -1) => {
    if (!matches.length) return;
    const next = current < 0 ? (step > 0 ? 0 : matches.length - 1) : (current + step + matches.length) % matches.length;
    setCurrent(next);
    scrollToMatch(matches[next]!);
  };

  // The current match comes into view after a search from the find box or a replace.
  useEffect(() => {
    const m = matches[current];
    if (!reveal.current || !open) return;
    reveal.current = false;
    if (m) scrollToMatch(m);
  }, [matches]);

  const close = () => {
    setOpen(false);
    // Like the editor, leave the caret on the match that was current.
    const m = matches[current];
    const target = m && editTarget(m);
    if (target) target.editor.chain().setTextSelection({ from: target.from, to: target.to }).focus(undefined, { scrollIntoView: false }).run();
  };

  const replacementFor = (m: Match) => {
    if (!options.regex) return replacement;
    const re = compile(query, options);
    return re instanceof RegExp ? m.text.replace(new RegExp(re.source, re.flags.replace('g', '')), replacement) : replacement;
  };

  const replaceOne = () => {
    const m = matches[current];
    if (!m) return;
    const target = editTarget(m);
    if (!target) return go(1);
    const { editor, from, to } = target;
    reveal.current = true;
    editor.view.dispatch(editor.state.tr.insertText(replacementFor(m), from, to));
    saveNow(editor);
    // The next match takes the replaced one's place in the list (the observer searches again).
  };

  const replaceAll = () => {
    const byEditor = new Map<Editor, { from: number; to: number; text: string }[]>();
    for (const m of matches) {
      const target = editTarget(m);
      if (!target) continue;
      const list = byEditor.get(target.editor) ?? [];
      list.push({ from: target.from, to: target.to, text: replacementFor(m) });
      byEditor.set(target.editor, list);
    }
    for (const [editor, list] of byEditor) {
      const tr = editor.state.tr;
      // From the end, so earlier positions stay valid.
      for (const r of list.sort((a, b) => b.from - a.from)) tr.insertText(r.text, r.from, r.to);
      editor.view.dispatch(tr);
      saveNow(editor);
    }
  };

  useImperativeHandle(ref, () => ({
    open(replace: boolean) {
      // Like the editor, a short selection on one line becomes the search.
      const selected = window.getSelection()?.toString() ?? '';
      if (selected && selected.length <= 200 && !/\n/.test(selected) && !findInput.current?.contains(document.activeElement)) setQuery(options.regex ? escapeRegExp(selected) : selected);
      setOpen(true);
      if (replace) setReplaceOpen(true);
      requestAnimationFrame(() => {
        const input = replace ? replaceInput.current : findInput.current;
        input?.focus();
        input?.select();
      });
    },
    step(dir) {
      if (open && query) go(dir);
      else this.open(false);
    },
  }));

  const toggle = (key: keyof Options) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.altKey && !mod && ['c', 'w', 'r'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      toggle(({ c: 'caseSensitive', w: 'wholeWord', r: 'regex' } as const)[e.key.toLowerCase() as 'c' | 'w' | 'r']);
    }
  };

  if (!open) return null;

  const count = error ? 'Invalid' : !query ? 'No results' : matches.length ? `${current + 1} of ${matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : matches.length}` : 'No results';
  const none = !matches.length;

  return (
    <div className={`find-widget${replaceOpen ? ' with-replace' : ''}`} style={{ top }} role="dialog" aria-label="Find and Replace" onKeyDown={onKeyDown}>
      <button type="button" className="fw-expand" title="Toggle Replace" aria-label="Toggle Replace" aria-expanded={replaceOpen} onClick={() => setReplaceOpen(!replaceOpen)}>
        <span className={`codicon codicon-chevron-${replaceOpen ? 'down' : 'right'}`} aria-hidden="true" />
      </button>
      <div className="fw-rows">
        <div className="fw-row">
          <div className={`fw-input${error ? ' invalid' : ''}`} title={error ?? undefined}>
            <input
              ref={findInput}
              type="text"
              placeholder="Find"
              aria-label="Find"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  go(e.shiftKey ? -1 : 1);
                }
              }}
            />
            <OptionToggle icon="case-sensitive" title="Match Case (Alt+C)" on={options.caseSensitive} onToggle={() => toggle('caseSensitive')} />
            <OptionToggle icon="whole-word" title="Match Whole Word (Alt+W)" on={options.wholeWord} onToggle={() => toggle('wholeWord')} />
            <OptionToggle icon="regex" title="Use Regular Expression (Alt+R)" on={options.regex} onToggle={() => toggle('regex')} />
          </div>
          <span className={`fw-count${query && none ? ' none' : ''}`} aria-live="polite">
            {count}
          </span>
          <Action icon="arrow-up" title="Previous Match (Shift+Enter)" disabled={none} onClick={() => go(-1)} />
          <Action icon="arrow-down" title="Next Match (Enter)" disabled={none} onClick={() => go(1)} />
          <Action icon="close" title="Close (Escape)" onClick={close} />
        </div>
        {replaceOpen && (
          <div className="fw-row">
            <div className="fw-input">
              <input
                ref={replaceInput}
                type="text"
                placeholder="Replace"
                aria-label="Replace"
                spellCheck={false}
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if ((e.ctrlKey || e.metaKey) && e.altKey) replaceAll();
                  else replaceOne();
                }}
              />
            </div>
            <Action icon="replace" title="Replace (Enter)" disabled={none} onClick={replaceOne} />
            <Action icon="replace-all" title="Replace All (Ctrl+Alt+Enter)" disabled={none} onClick={replaceAll} />
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * The page's find keys, taken before VS Code sees them (the webview passes unhandled keys on to the
 * workbench): Ctrl+F finds, Ctrl+H replaces, F3 / Shift+F3 step through the matches.
 */
export function installFindKeys(widget: () => FindWidgetHandle | null): () => void {
  const onKey = (e: KeyboardEvent) => {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'f' || key === 'h')) {
      e.preventDefault();
      e.stopPropagation();
      widget()?.open(key === 'h');
    } else if (e.key === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      widget()?.step(e.shiftKey ? -1 : 1);
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
