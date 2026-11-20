// Id generation. Ids are readable slugs derived from the name at creation time
// and never change afterwards (renaming an element keeps its id).

/** Combining diacritical marks, removed after NFKD normalization ("é" -> "e"). */
const DIACRITICS = /[̀-ͯ]/g;

/** "Order Service" -> "orderService", "API Gateway" -> "apiGateway", "Zahlungs-Gateway (extern)" -> "zahlungsGatewayExtern". */
export function camelSlug(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const slug = words
    // Treat acronyms as words: "API Gateway" -> "apiGateway", "Order HTTP API" -> "orderHttpApi".
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w.toLowerCase() : w))
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  return /^[A-Za-z_]/.test(slug) ? slug : `_${slug}`;
}

/** "Building blocks – level 1" -> "building-blocks-level-1". */
export function kebabSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A file name from a title: kebab-case, "+" as "p" ("C++20" -> "cpp20"), at most `max` characters,
 * cut after a whole word: "Use the bus engine in C++20" -> "use-the-bus-engine-in-cpp20".
 */
export function fileSlug(title: string, max = 60): string {
  const slug = kebabSlug(title.replace(/\+/g, 'p'));
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1);
  const end = cut.lastIndexOf('-');
  return (end > max / 2 ? cut.slice(0, end) : slug.slice(0, max)).replace(/-+$/, '');
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}
