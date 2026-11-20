// The document's title (cover, tab, exports).
/**
 * The document's title: its own title, else the system name. The title earlier versions put into
 * every new archery.yaml ("<system> - Architecture Documentation") counts as none.
 */
export function documentTitle(system: string, title: string | undefined): string {
  const own = title?.trim();
  if (!own || own === `${system} - Architecture Documentation`) return system;
  return own;
}
