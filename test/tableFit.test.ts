// Balanced table column widths (src/export/tableFit.ts): the fit_table_columns / get_table_layout
// tools, write_data_table without rows, and validate's table directive checks. The measuring tests
// need Edge, Chrome or Chromium and are skipped without one.
import { describe, expect, it } from 'vitest';
import { findBrowsers } from '../src/export/browsers';
import { printContentPx } from '../src/export/tableFit';
import { fitAutoTables } from '../src/export/tableMeasure';
import { buildTables } from '../src/doc/tables';
import { parse as parseYaml } from 'yaml';
import { MARGINS } from '../src/export/documentHtml';
import { scaffold } from '../src/template/scaffold';
import { ArcherySession, DELETED } from '../src/ops/session';
import { TOOLS } from '../src/ops/tools';
import type { WorkspaceReader } from '../src/model/load';

function memoryReader(files: Map<string, string>): WorkspaceReader {
  return {
    readText: async (path) => files.get(path),
    list: async (dir) =>
      [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)),
  };
}

async function workspace() {
  const files = scaffold({ system: 'Webshop', includeHelp: false });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const def = TOOLS.find((t) => t.name === name)!;
    const session = await ArcherySession.load(memoryReader(files), 'docs/architecture');
    const result = await def.run(session, def.input.parse(args));
    for (const [path, text] of session.changes) text === DELETED ? files.delete(path) : files.set(path, text);
    return result;
  };
  return { files, call };
}

const FILE = 'data/quality-requirements.yaml';

/** 12 quality scenarios with text of very different lengths per column, like a real document's. */
const scenarios = Array.from({ length: 12 }, (_, i) => ({
  id: `QS-${i + 1}`,
  name: ['Checkout under load', 'Price change', 'Search', 'Payment provider down'][i % 4]!,
  stimulus: `${['A thousand customers', 'An operator', 'A customer on a phone', 'The payment provider'][i % 4]} ${'starts checkout at the same moment during the seasonal sale '.repeat(1 + (i % 2))}`.trim(),
  metric: `The order is confirmed within ${2 + (i % 3)} seconds for 99% of the requests, measured at the load balancer over one hour, and no order is lost or charged twice when a node fails or restarts during the run.`,
}));
const COLUMNS = [
  { field: 'id', label: 'ID', width: 7 },
  { field: 'name', label: 'Scenario', width: 18 },
  { field: 'stimulus', label: 'Stimulus', width: 32 },
  { field: 'metric', label: 'Metric / acceptance', width: 43 },
];

describe('write_data_table without rows', () => {
  it('changes the layout only and keeps every row byte for byte', async () => {
    const { files, call } = await workspace();
    await call('write_data_table', { list: 'quality-scenarios', rows: scenarios });
    const before = files.get(FILE)!;
    const result = await call('write_data_table', { list: 'quality-scenarios', columns: COLUMNS, fit: 'auto' });
    const after = files.get(FILE)!;
    expect(result.rows).toBe(12);
    expect(before).not.toContain('views:');
    expect(after.startsWith(before)).toBe(true);
    expect(after).toMatch(/views:\n {2}scenarios:\n {4}fit: auto\n {4}columns:/);
    // fit: null drops the option, the widths stay.
    await call('write_data_table', { list: 'quality-scenarios', fit: null });
    expect(files.get(FILE)).not.toContain('fit:');
    expect(files.get(FILE)).toContain('width: 43');
    await expect(call('write_data_table', { list: 'quality-scenarios' })).rejects.toThrow(/Nothing to change/);
  });
});

describe('validate: table directives', () => {
  it('reports a file with several lists named without #list, and an empty list next to a filled one', async () => {
    const { files, call } = await workspace();
    await call('write_data_table', { list: 'quality-scenarios', rows: scenarios });
    const chapter = [...files.keys()].find((p) => /^sections\/10-/.test(p))!;
    files.set(chapter, `${files.get(chapter)}\n<!-- archery:table data/quality-requirements.yaml -->\n`);
    const { problems } = await call('validate');
    const messages = problems.map((p: { message: string }) => p.message).join('\n');
    expect(messages).toContain('a file with 2 lists; it shows the first (overview). Name the list: data/quality-requirements.yaml#overview or data/quality-requirements.yaml#scenarios');
    expect(messages).toContain('which has no rows (shown as "No entries yet"), while data/quality-requirements.yaml#scenarios has 12');
  });

  it('keeps a new document free of table warnings', async () => {
    const { call } = await workspace();
    const { problems } = await call('validate');
    expect(problems.filter((p: { message: string }) => /table/i.test(p.message))).toEqual([]);
  });
});

describe('print width', () => {
  it('is the page width less the side margins at 96 dpi', () => {
    expect(printContentPx({ pageSize: 'A4', orientation: 'portrait', margins: 'narrow' }, MARGINS)).toBe(703);
    expect(printContentPx({ pageSize: 'A4', orientation: 'landscape', margins: 'narrow' }, MARGINS)).toBe(1032);
  });
});

const browser = findBrowsers().length > 0;

describe.skipIf(!browser)('fit_table_columns (measured in a browser)', () => {
  it('lowers the lines, changes no row, is a fixed point, never overflows; apply: false writes nothing', { timeout: 120_000 }, async () => {
    const { files, call } = await workspace();
    await call('write_data_table', { list: 'quality-scenarios', rows: scenarios, columns: COLUMNS });
    const stored = files.get(FILE)!;

    const fit = await call('fit_table_columns', { list: 'quality-scenarios' });
    expect(fit.fields).toEqual(['id', 'name', 'stimulus', 'metric']);
    expect(fit.before).toEqual([7, 18, 32, 43]);
    expect(fit.after.reduce((a: number, b: number) => a + b, 0)).toBe(100);
    expect(fit.after.every((w: number) => Number.isInteger(w) && w >= 3)).toBe(true);
    // Balanced for both: here print gets shorter, screen no longer.
    expect(fit.lines.screen[1]).toBeLessThanOrEqual(fit.lines.screen[0]);
    expect(fit.lines.print[1]).toBeLessThan(fit.lines.print[0]);
    expect(fit.applied).toBe(false);
    expect(files.get(FILE)).toBe(stored);

    // apply: only the widths change.
    const applied = await call('fit_table_columns', { list: 'quality-scenarios', apply: true });
    expect(applied.after).toEqual(fit.after);
    expect(applied.applied).toBe(true);
    const strip = (t: string) => t.replace(/width: \d+/g, 'width: N');
    expect(strip(files.get(FILE)!)).toBe(strip(stored));

    // Fitting the result again keeps it.
    const again = await call('fit_table_columns', { list: 'quality-scenarios' });
    expect(again.before).toEqual(fit.after);
    expect(again.after).toEqual(fit.after);

    // The layout: no cell overflows, no column widened for a word.
    const layout = await call('get_table_layout', { list: 'quality-scenarios' });
    expect(layout.widths).toEqual(fit.after);
    for (const t of layout.targets) {
      expect(t.overflow).toEqual([]);
      expect(t.widenedForAWord).toEqual([]);
      expect(t.lines).toHaveLength(12);
    }
    expect(layout.targets.map((t: { target: string }) => t.target)).toEqual(['screen', 'print']);
  });

  it('fit: auto fits the widths at export; a column with a width keeps it', { timeout: 120_000 }, async () => {
    const { files, call } = await workspace();
    const columns = COLUMNS.map((c) => (c.field === 'metric' ? c : { field: c.field, label: c.label }));
    await call('write_data_table', { list: 'quality-scenarios', rows: scenarios, columns, fit: 'auto' });
    const data = new Map([[FILE, parseYaml(files.get(FILE)!)]]);
    const tables = buildTables(data);
    const fitted = await fitAutoTables(findBrowsers(), { system: 'Webshop', title: 'Webshop', version: '1', tables });
    const table = fitted[`${FILE}#scenarios`]!;
    expect(table.fit).toBe('auto');
    expect(table.columns.map((c) => c.width)).toHaveLength(4);
    expect(table.columns[3]!.width).toBe(43);
    expect(table.columns.reduce((a, c) => a + (c.width ?? 0), 0)).toBe(100);
    // The other lists are not touched.
    expect(fitted[`${FILE}#overview`]).toBe(tables[`${FILE}#overview`]);
  });

  it('keeps fixed columns and limits; reports the cells when no width fits a word', { timeout: 120_000 }, async () => {
    const { call } = await workspace();
    await call('write_data_table', { list: 'quality-scenarios', rows: scenarios, columns: COLUMNS });
    const fit = await call('fit_table_columns', { list: 'quality-scenarios', columns: { metric: { fixed: true }, id: { min: 10 } } });
    expect(fit.after[3]).toBe(43);
    expect(fit.after[0]).toBeGreaterThanOrEqual(10);

    const long = scenarios.map((s, i) => (i === 2 ? { ...s, name: 'Supercalifragilisticexpialidocious-checkout-under-load' } : s));
    await call('write_data_table', { list: 'quality-scenarios', rows: long });
    await expect(call('fit_table_columns', { list: 'quality-scenarios', columns: { name: { max: 8 } } })).rejects.toThrow(/^No widths fit every word within the limits: .*row QS-3, name: a word needs \d+px, the column gets at most \d+px/);
  });
});
