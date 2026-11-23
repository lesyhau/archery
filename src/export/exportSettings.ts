// Export options (archery.yaml `export`) with their defaults, and where the header, footer and
// page numbers go on a page. Shared by the HTML / PDF renderer and the export dialog's preview.
import type { ExportSettings } from '../model/schema';

export type ResolvedExportSettings = Required<Omit<ExportSettings, 'headingFont'>> & { headingFont: string };

export const EXPORT_DEFAULTS: Omit<ResolvedExportSettings, 'headingFont'> = {
  font: 'Segoe UI',
  fontSize: 11,
  pageSize: 'A4',
  orientation: 'portrait',
  margins: 'normal',
  // The chapter on every page's top, the document and its version at the bottom.
  header: '{chapter}',
  footer: '{title} · v{version}',
  pageNumbers: 'bottom-right',
  pageNumberFormat: 'Page {page} of {pages}',
  tocDepth: 2,
  cover: true,
};

/** The export settings with every default filled in. */
export function resolveExportSettings(settings: ExportSettings = {}): ResolvedExportSettings {
  const defined = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined && v !== null && v !== '')) as ExportSettings;
  // An empty header / footer is a choice, not a missing value.
  const out = { ...EXPORT_DEFAULTS, ...defined, header: settings.header ?? EXPORT_DEFAULTS.header, footer: settings.footer ?? EXPORT_DEFAULTS.footer };
  return { ...out, headingFont: settings.headingFont?.trim() || out.font };
}

export type MarginSlot = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/**
 * Text templates per page margin slot. Header and footer: "left", "left | right" or
 * "left | center | right"; the page number joins the text already in its slot.
 */
export function marginSlots(set: Pick<ResolvedExportSettings, 'header' | 'footer' | 'pageNumbers' | 'pageNumberFormat'>): Partial<Record<MarginSlot, string>> {
  const slots: Partial<Record<MarginSlot, string[]>> = {};
  const place = (template: string, row: 'top' | 'bottom') => {
    const parts = template.split('|').map((x) => x.trim());
    const names = parts.length === 1 ? ['left'] : parts.length === 2 ? ['left', 'right'] : ['left', 'center', 'right'];
    parts.slice(0, 3).forEach((part, i) => part && (slots[`${row}-${names[i]}` as MarginSlot] ??= []).push(part));
  };
  place(set.header, 'top');
  place(set.footer, 'bottom');
  if (set.pageNumbers !== 'none') (slots[set.pageNumbers] ??= []).push(set.pageNumberFormat);
  return Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v!.join(' · ')]));
}

/**
 * Fills {chapter} {title} {system} {version} {date}; {page} and {pages} stay for the renderer.
 * {chapter} is the chapter a page belongs to, e.g. "7 Deployment view" (empty where there is none).
 */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{(chapter|title|system|version|date)\}/g, (_, k: string) => values[k] ?? '');
}
