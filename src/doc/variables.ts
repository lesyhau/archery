// Variables in the text, header and footer: `{title}`, `{version}`, ... and the documentation's own
// (archery.yaml `export.variables`). The export fills them in; code spans and code blocks keep them.

/** What Archery fills in itself. They win over a custom variable with the same name. */
export const BUILTIN_VARIABLES = ['title', 'system', 'version', 'date', 'generator', 'chapter'] as const;

/** A variable name: a letter, then letters, digits, "_" or "-". */
export const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** `{name}` in text. */
export const VARIABLE = /\{([A-Za-z][A-Za-z0-9_-]*)\}/g;

export const isBuiltinVariable = (name: string) => (BUILTIN_VARIABLES as readonly string[]).includes(name);

/** The values of every variable: the custom ones, then the built-in ones over them. */
export function variableValues(builtin: Partial<Record<(typeof BUILTIN_VARIABLES)[number], string>>, custom: Record<string, string> | undefined): Record<string, string> {
  const own = Object.fromEntries(Object.entries(custom ?? {}).filter(([k]) => VARIABLE_NAME.test(k) && !isBuiltinVariable(k)));
  return { ...own, ...Object.fromEntries(Object.entries(builtin).filter(([, v]) => v !== undefined)) } as Record<string, string>;
}

/**
 * Fills the variables `values` has. A built-in one without a value becomes empty; any other `{name}`
 * stays as written (an API path "/orders/{id}", the page numbers {page} and {pages}).
 */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE, (m, name: string) => (Object.hasOwn(values, name) ? values[name]! : isBuiltinVariable(name) ? '' : m));
}
