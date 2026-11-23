// Table column widths measured in a real browser: the table is rendered with the export's own HTML
// and CSS (theme, fonts, font size) in headless Edge / Chrome, for the screen page and the printed
// page. Used by the fit_table_columns and get_table_layout tools, `validate`, and the export of
// tables whose view says `fit: auto`.
//
// Fitting (one table): start from the current widths (or, without them, from each column's widest
// cell, no narrower than its longest word), then move 5, 2 or 1 percent of width from one column to
// another while the table gets shorter (its rendered height on screen plus in print, which counts
// wrapped lines the way a reader sees them: a row is as tall as its tallest cell). A candidate where
// a column is narrower than its longest word is invalid: the browser would widen that column itself.
// The search runs inside the page (hundreds of layouts in one browser start), started from the command
// line with --dump-dom; the page writes its result into the DOM.
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedExportSettings } from './exportSettings';

export type Target = 'screen' | 'print';

/** The exported page's text width on screen: body max-width 900px less 2 x 40px padding (EXPORT_CSS). */
export const SCREEN_CONTENT_PX = 820;

const PAGE_MM: Record<ResolvedExportSettings['pageSize'], [number, number]> = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A3: [297, 420], A5: [148, 210] };

/** The printed page's text width in CSS px (96 dpi): the page width less the left and right margins. */
export function printContentPx(set: Pick<ResolvedExportSettings, 'pageSize' | 'orientation' | 'margins'>, margins: Record<string, string>): number {
  const [w, h] = PAGE_MM[set.pageSize];
  const width = set.orientation === 'landscape' ? h : w;
  // "top right bottom [left]": left = right unless given.
  const parts = margins[set.margins]!.split(/\s+/).map((m) => parseFloat(m));
  const right = parts[1] ?? parts[0]!;
  const left = parts[3] ?? right;
  return Math.round(((width - left - right) * 96) / 25.4);
}

export interface ColumnLimits {
  /** Percent; default 3. */
  min?: number;
  max?: number;
  /** Keeps its current width. */
  fixed?: boolean;
}

export interface TableJob {
  /** List name (figure[data-list]). */
  list: string;
  mode: 'fit' | 'layout';
  targets: { name: Target; width: number }[];
  /** Current width of each visible column in percent; null = automatic. */
  widths: (number | null)[];
  /** Per column; fixed columns need a width. */
  limits: ColumnLimits[];
}

export interface CellLines {
  row: string;
  field: string;
  /** Lines of the cell as drawn: its height less its padding, by its line height (a cell is as tall as its row). */
  lines: number;
  /** Lines of the cell's own text (which cell of a row wraps). */
  textLines: number;
}

export interface TargetLayout {
  target: Target;
  /** The table's rendered height in px. */
  height: number;
  columns: { field: string; px: number; percent: number }[];
  /** Lines of each body cell. */
  cells: CellLines[];
  /** Cells whose content is wider than the cell. */
  overflow: { row: string; field: string }[];
  /** Columns the browser made wider than their width, to fit their longest word. */
  forced: { field: string; requested: number; rendered: number }[];
}

export interface JobResult {
  list: string;
  error?: string;
  fields: string[];
  /** Widths as rendered now (percent, from the first target). */
  current: number[];
  layouts: TargetLayout[];
  /** fit: the proposed widths and their layout (undefined when no width fits every word). */
  fitted?: number[];
  fittedLayouts?: TargetLayout[];
  /** fit without a valid result: the cells whose word is wider than their column can get. */
  tooWide?: { row: string; field: string; wordPx: number; maxPx: number }[];
}

/**
 * Runs in the page (serialized with toString, so self-contained, plain JavaScript semantics).
 * Measures each job's table in a box of each target's width, and fits its widths.
 */
function measurePage(jobs: TableJob[]): JobResult[] {
  const results: JobResult[] = [];
  const lineCount = (el: Element): { lines: number; textLines: number } => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const box = el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    const lines = Math.max(1, Math.round(box / lh));
    if (!el.textContent?.trim() && !el.querySelector('img')) return { lines, textLines: 0 };
    const range = document.createRange();
    range.selectNodeContents(el);
    return { lines, textLines: Math.max(1, Math.round(range.getBoundingClientRect().height / lh)) };
  };
  for (const job of jobs) {
    const figure = document.querySelector(`figure[data-list="${job.list}"]`);
    if (!figure) {
      results.push({ list: job.list, error: 'The table is not rendered.', fields: [], current: [], layouts: [] });
      continue;
    }
    const fields = [...figure.querySelectorAll('thead th')].map((th) => (th as HTMLElement).dataset.field ?? '');
    const n = fields.length;
    const stages = job.targets.map((t) => {
      const box = document.createElement('div');
      box.style.width = `${t.width}px`;
      const clone = figure.cloneNode(true) as HTMLElement;
      box.append(clone);
      document.body.append(box);
      const table = clone.querySelector('table')!;
      let group = table.querySelector('colgroup');
      if (!group) {
        group = document.createElement('colgroup');
        for (let i = 0; i < n; i++) group.append(document.createElement('col'));
        table.prepend(group);
      }
      return { name: t.name, width: t.width, table, cols: [...group.children] as HTMLElement[] };
    });
    const apply = (w: (number | null)[]) => stages.forEach((s) => s.cols.forEach((c, i) => (c.style.width = w[i] == null ? '' : `${w[i]}%`)));

    // Each column's widest word (min-content) and widest cell (max-content), in px.
    const natural = (mode: 'min-content' | 'max-content') => {
      const table = stages[0]!.table.cloneNode(true) as HTMLTableElement;
      table.querySelectorAll('col').forEach((c) => ((c as HTMLElement).style.width = ''));
      table.style.width = mode;
      stages[0]!.table.parentElement!.append(table);
      const px = [...table.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().width);
      table.remove();
      return px;
    };
    const colMin = natural('min-content');
    const colMax = natural('max-content');

    const measure = (s: (typeof stages)[number], w: (number | null)[]): TargetLayout => {
      const tw = s.table.getBoundingClientRect().width;
      const heads = [...s.table.querySelectorAll('thead th')];
      const columns = heads.map((th, i) => {
        const px = th.getBoundingClientRect().width;
        return { field: fields[i]!, px: Math.round(px), percent: Math.round((px / tw) * 1000) / 10 };
      });
      const cells: CellLines[] = [];
      for (const tr of s.table.querySelectorAll('tbody tr')) {
        for (const td of tr.children) {
          const field = (td as HTMLElement).dataset.field;
          if (field) cells.push({ row: (tr as HTMLElement).dataset.row ?? '', field, ...lineCount(td) });
        }
      }
      const overflow: { row: string; field: string }[] = [];
      for (const c of s.table.querySelectorAll('td, th')) {
        if (c.scrollWidth > c.clientWidth + 1) overflow.push({ row: (c.closest('tr') as HTMLElement).dataset.row ?? 'header', field: (c as HTMLElement).dataset.field ?? '' });
      }
      const forced = columns
        .map((c, i) => ({ field: c.field, requested: w[i] ?? null, rendered: c.percent }))
        .filter((c): c is { field: string; requested: number; rendered: number } => c.requested != null && c.rendered > c.requested + 1);
      return { target: s.name, height: s.table.getBoundingClientRect().height, columns, cells, overflow, forced };
    };
    const layouts = (w: (number | null)[]) => {
      apply(w);
      return stages.map((s) => measure(s, w));
    };

    const before = layouts(job.widths);
    const current = before[0]!.columns.map((c) => c.percent);
    const result: JobResult = { list: job.list, fields, current, layouts: before };
    if (job.mode === 'layout') {
      results.push(result);
      continue;
    }

    // --- fit -----------------------------------------------------------------------------------
    const lim = job.limits.map((l, i) => ({ min: l.min ?? 3, max: l.max ?? 100, fixed: !!l.fixed && job.widths[i] != null }));
    const narrowest = Math.min(...stages.map((s) => s.table.parentElement!.clientWidth));
    const wordPct = colMin.map((px) => Math.ceil((px / narrowest) * 100));
    // Start: the current widths; without them each free column by its widest cell, at least its widest word.
    let start: number[];
    if (job.widths.every((w) => w != null)) start = job.widths.map((w) => w as number);
    else {
      const fixedSum = job.widths.reduce<number>((a, w, i) => a + (lim[i]!.fixed || w != null ? (w as number) : 0), 0);
      const free = job.widths.map((w, i) => (lim[i]!.fixed || w != null ? 0 : Math.max(colMax[i]!, colMin[i]!)));
      const total = free.reduce((a, b) => a + b, 0) || 1;
      start = job.widths.map((w, i) => (w != null ? w : Math.max(wordPct[i]!, ((100 - fixedSum) * free[i]!) / total)));
    }
    // Integer percentages within the limits, summing to 100.
    const sum0 = start.reduce((a, b) => a + b, 0) || 1;
    let w = start.map((x, i) => (lim[i]!.fixed ? Math.round(x) : Math.min(lim[i]!.max, Math.max(lim[i]!.min, Math.round((x * 100) / sum0)))));
    for (let guard = 0; guard < 400 && w.reduce((a, b) => a + b, 0) !== 100; guard++) {
      const diff = 100 - w.reduce((a, b) => a + b, 0);
      const step = diff > 0 ? 1 : -1;
      // The free column with the most room in that direction.
      let pick = -1;
      for (let i = 0; i < n; i++) {
        if (lim[i]!.fixed) continue;
        const room = step > 0 ? lim[i]!.max - w[i]! : w[i]! - lim[i]!.min;
        if (room > 0 && (pick < 0 || (step > 0 ? w[i]! < w[pick]! : w[i]! > w[pick]!))) pick = i;
      }
      if (pick < 0) break;
      w[pick] = w[pick]! + step;
    }

    // Score: the table's height in every target, plus a large penalty per px a column falls short of its widest word.
    const score = (c: number[]) => {
      apply(c);
      let total = 0;
      for (const s of stages) {
        const tw = s.table.clientWidth;
        let short = 0;
        c.forEach((p, i) => (short += Math.max(0, colMin[i]! - (p / 100) * tw - 1)));
        let over = 0;
        for (const cell of s.table.querySelectorAll('td, th')) if (cell.scrollWidth > cell.clientWidth + 1) over++;
        total += s.table.getBoundingClientRect().height + (short + over * 50) * 1000;
      }
      return total;
    };
    let best = score(w);
    for (let improved = true, rounds = 0; improved && rounds < 200; rounds++) {
      improved = false;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j || lim[i]!.fixed || lim[j]!.fixed) continue;
          for (const step of [5, 2, 1]) {
            if (w[i]! - step < lim[i]!.min || w[j]! + step > lim[j]!.max) continue;
            const c = w.slice();
            c[i] = c[i]! - step;
            c[j] = c[j]! + step;
            const sc = score(c);
            if (sc < best - 0.5) {
              w = c;
              best = sc;
              improved = true;
              break;
            }
          }
        }
      }
    }
    const fittedLayouts = layouts(w);
    const valid = fittedLayouts.every((l) => l.overflow.length === 0) && stages.every((s) => w.every((p, i) => colMin[i]! <= (p / 100) * s.table.clientWidth + 1));
    if (valid) {
      result.fitted = w;
      result.fittedLayouts = fittedLayouts;
    } else {
      // The cells whose widest word does not fit their column at its largest allowed width.
      const tooWide: { row: string; field: string; wordPx: number; maxPx: number }[] = [];
      const s = stages.reduce((a, b) => (a.table.clientWidth <= b.table.clientWidth ? a : b));
      s.table.querySelectorAll('tbody tr').forEach((tr) => {
        [...tr.children].forEach((td) => {
          const field = (td as HTMLElement).dataset.field;
          const i = fields.indexOf(field ?? '');
          if (i < 0) return;
          const probe = document.createElement('table');
          probe.style.width = 'min-content';
          const row = probe.insertRow();
          row.append(td.cloneNode(true));
          s.table.parentElement!.append(probe);
          const wordPx = probe.getBoundingClientRect().width;
          probe.remove();
          const maxPx = ((lim[i]!.fixed ? w[i]! : lim[i]!.max) / 100) * s.table.clientWidth;
          if (wordPx > maxPx + 1) tooWide.push({ row: (tr as HTMLElement).dataset.row ?? '', field: field!, wordPx: Math.round(wordPx), maxPx: Math.round(maxPx) });
        });
      });
      result.tooWide = tooWide;
    }
    results.push(result);
  }
  return results;
}

const RESULT_ID = 'archery-measure';

/** The page with the measuring script; the result lands in <pre id="archery-measure">. */
export function measuringHtml(html: string, jobs: TableJob[]): string {
  const script = `<script>
document.fonts.ready.then(() => {
  let out;
  try { out = (${measurePage.toString()})(${JSON.stringify(jobs).replace(/</g, '\\u003c')}); }
  catch (e) { out = { error: String(e && e.stack || e) }; }
  const pre = document.createElement('pre'); pre.id = '${RESULT_ID}'; pre.textContent = JSON.stringify(out); document.body.append(pre);
});
</script>`;
  return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : html + script;
}

const unescapeHtml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function dumpDom(browser: string, file: string, profile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        `--user-data-dir=${profile}`,
        '--window-size=1600,1200',
        // Lets the page's script (after the fonts are ready) finish before the DOM is written out.
        '--virtual-time-budget=60000',
        '--dump-dom',
        pathToFileURL(file).href,
      ],
      { timeout: 180_000, windowsHide: true, maxBuffer: 512 * 1024 * 1024 },
      (error, stdout) => (stdout ? resolve(stdout) : reject(error ?? new Error('the browser returned nothing'))),
    );
  });
}

/** Measures (and fits) tables in `html` (an exported page that shows them) with the first browser that works. */
export async function measureTables(browsers: string[], html: string, jobs: TableJob[]): Promise<JobResult[]> {
  const work = mkdtempSync(join(tmpdir(), 'archery-measure-'));
  try {
    const file = join(work, 'tables.html');
    writeFileSync(file, measuringHtml(html, jobs), 'utf8');
    let lastError: unknown = new Error('no browser');
    for (const browser of browsers) {
      try {
        const dom = await dumpDom(browser, file, join(work, 'profile'));
        const m = new RegExp(`<pre id="${RESULT_ID}">([\\s\\S]*?)</pre>`).exec(dom);
        if (!m) throw new Error('the page did not finish measuring');
        const out = JSON.parse(unescapeHtml(m[1]!)) as JobResult[] | { error: string };
        if (!Array.isArray(out)) throw new Error(`measuring failed: ${out.error}`);
        return out;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// --- summaries --------------------------------------------------------------------------------

export const totalLines = (l: TargetLayout) => l.cells.reduce((a, c) => a + c.lines, 0);
export const tallestCell = (l: TargetLayout) => Math.max(0, ...l.cells.map((c) => c.lines));

/** Cells whose own text takes 3 lines or more, most first (at most 10). */
export const stillWrapping = (l: TargetLayout) =>
  l.cells
    .filter((c) => c.textLines >= 3)
    .sort((a, b) => b.textLines - a.textLines)
    .slice(0, 10)
    .map((c) => ({ row: c.row, field: c.field, lines: c.textLines, target: l.target }));

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Columns whose cells wrap much more than the rest of the table: median lines over twice the table's (and at least 3). */
export function wrappingColumns(l: TargetLayout): { field: string; median: number; table: number }[] {
  const table = median(l.cells.filter((c) => c.textLines > 0).map((c) => c.textLines));
  return l.columns
    .map((col) => ({ field: col.field, median: median(l.cells.filter((c) => c.field === col.field && c.textLines > 0).map((c) => c.textLines)), table }))
    .filter((c) => c.median >= 3 && c.median > 2 * table);
}
