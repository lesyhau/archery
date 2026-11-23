// Measuring the documentation's data tables (src/export/tableFit.ts) from what the tools and the
// export have at hand: the tables (src/doc/tables.ts) and the export settings.
import type { DocTable } from '../doc/protocol';
import type { ExportSettings } from '../model/schema';
import { MARGINS, renderDocumentHtml } from './documentHtml';
import { resolveExportSettings } from './exportSettings';
import { measureTables, printContentPx, SCREEN_CONTENT_PX, type ColumnLimits, type JobResult, type Target, type TableJob } from './tableFit';

export interface TableSource {
  system: string;
  title: string;
  version: string;
  tables: Record<string, DocTable>;
  exportSettings?: ExportSettings;
}

/** The table of a list (by its name, e.g. "risks"). */
export function tableOfList(tables: Record<string, DocTable>, list: string): DocTable | undefined {
  return Object.values(tables).find((t) => t.list === list);
}

/** Target widths in px: the exported page's text width on screen, the page's content box in print. */
export function targetWidths(settings: ExportSettings | undefined, targets: Target[] = ['screen', 'print']): { name: Target; width: number }[] {
  const set = resolveExportSettings(settings);
  return targets.map((name) => ({ name, width: name === 'screen' ? SCREEN_CONTENT_PX : printContentPx(set, MARGINS) }));
}

/** An exported page (the export's HTML and CSS) that shows just these tables. */
function pageWith(src: TableSource, tables: DocTable[]): string {
  const directives = tables.map((t) => `<!-- archery:table ${t.file}#${t.key} -->`).join('\n\n');
  return renderDocumentHtml(
    {
      system: src.system,
      title: src.title,
      version: src.version,
      changeHistory: [],
      sections: [{ id: 'tables', title: 'Tables', file: 'sections/tables.md', markdown: `# Tables\n\n${directives}\n`, enabled: true }],
      diagrams: {},
      model: { elements: [], relationships: [] },
      tables: src.tables,
      decisions: [],
    },
    { generator: 'Archery', date: '', settings: { ...src.exportSettings, cover: false, tocDepth: 0 } },
  );
}

export interface MeasureRequest {
  table: DocTable;
  mode: 'fit' | 'layout';
  /** Per field. */
  limits?: Record<string, ColumnLimits>;
  /** Fit: columns with a width keep it (the export's `fit: auto`). */
  keepWidths?: boolean;
}

/**
 * The tables with the widths of those whose view says `fit: auto` fitted to their content (columns with
 * a width keep it), for an export. Without a browser, or if measuring fails, the tables stay as they are.
 */
export async function fitAutoTables(browsers: string[], src: TableSource): Promise<Record<string, DocTable>> {
  const auto = [...new Set(Object.values(src.tables))].filter((t) => t.fit === 'auto' && t.rows.length > 0 && t.columns.length > 0);
  if (!auto.length || !browsers.length) return src.tables;
  let results: JobResult[];
  try {
    results = await measure(browsers, src, auto.map((table) => ({ table, mode: 'fit' as const, keepWidths: true })));
  } catch {
    return src.tables;
  }
  const fitted = new Map<DocTable, DocTable>();
  for (const r of results) {
    const t = auto.find((x) => x.list === r.list);
    if (t && r.fitted) fitted.set(t, { ...t, columns: t.columns.map((c, i) => ({ ...c, width: r.fitted![i] })) });
  }
  return Object.fromEntries(Object.entries(src.tables).map(([k, t]) => [k, fitted.get(t) ?? t]));
}

/** Measures (and fits) tables in one browser run. */
export async function measure(browsers: string[], src: TableSource, requests: MeasureRequest[], targets?: Target[]): Promise<JobResult[]> {
  const widths = targetWidths(src.exportSettings, targets);
  const jobs: TableJob[] = requests.map((r) => ({
    list: r.table.list,
    mode: r.mode,
    targets: widths,
    widths: r.table.columns.map((c) => c.width ?? null),
    limits: r.table.columns.map((c) => ({ ...r.limits?.[c.field], ...(r.keepWidths && c.width ? { fixed: true } : {}) })),
  }));
  return measureTables(browsers, pageWith(src, requests.map((r) => r.table)), jobs);
}
