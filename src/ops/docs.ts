// Several architecture documentations in one project: each is a folder with its own archery.yaml.
// Agents name one with `doc` (its folder, relative to the project, or its system name); without it
// they work on the one that is active in VS Code (or the only one).
import { z } from 'zod';

export interface DocRef {
  /** The folder holding archery.yaml, relative to the project ("docs/architecture"). */
  path: string;
  system?: string;
}

export const DOC_PARAM = z
  .string()
  .optional()
  .describe('Which documentation, when the project has several: its folder (e.g. "services/billing/docs/architecture") or its system name. Default: the one open in VS Code. overview lists them.');

/** A tool's input with the `doc` parameter added (for the MCP server and the Copilot tools). */
export const withDoc = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema.extend({ doc: DOC_PARAM });

const normalize = (p: string) =>
  p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

/** The documentation `doc` names, or an error message listing the ones there are. */
export function pickDoc<T extends DocRef>(docs: T[], doc: string): T | string {
  const want = normalize(doc);
  const found =
    docs.find((d) => normalize(d.path) === want) ??
    docs.find((d) => d.system && d.system.trim().toLowerCase() === want) ??
    // The folder that contains it ("services/billing" for "services/billing/docs/architecture").
    (docs.filter((d) => normalize(d.path).startsWith(`${want}/`)).length === 1 ? docs.find((d) => normalize(d.path).startsWith(`${want}/`)) : undefined);
  return found ?? `No architecture documentation "${doc}". There are: ${describeDocs(docs)}.`;
}

export const describeDocs = (docs: DocRef[]) => docs.map((d) => (d.system ? `"${d.path || '.'}" (${d.system})` : `"${d.path || '.'}"`)).join(', ');

/** Added to overview's result when the project has more than one documentation. */
export const docsListing = (docs: DocRef[], current: DocRef) => ({
  documentations: docs.map((d) => ({ doc: d.path || '.', system: d.system, current: d.path === current.path })),
  note: 'This project has several architecture documentations; pass doc to work on another one.',
});
