// Field catalog of the structured arc42 lists (data/*.yaml), used to show and edit them as
// tables. Column labels follow the arc42 template. A list may also carry custom columns:
// any extra field on its items, listed in the file's `views` section.
export type FieldType = 'text' | 'int' | 'list' | 'map' | 'id';

export interface FieldDef {
  field: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  /** Not shown as a column unless the view lists it. */
  hidden?: boolean;
  /** Allowed values (shown as a hint). */
  values?: string[];
}

export interface ListDef {
  name: string;
  title: string;
  file: string;
  /** Key of the list inside the YAML file. */
  key: string;
  /** Field that identifies an item. */
  keyField: string;
  /** Prefix for generated ids of new rows (lists keyed by `id`). */
  idPrefix?: string;
  fields: FieldDef[];
}

export const LISTS: ListDef[] = [
  {
    name: 'quality-goals',
    title: 'Quality goals',
    file: 'data/quality-goals.yaml',
    key: 'goals',
    keyField: 'id',
    idPrefix: 'qg',
    fields: [
      { field: 'id', label: 'ID', type: 'id', hidden: true },
      { field: 'priority', label: '#', type: 'int', required: true },
      { field: 'quality', label: 'Quality', required: true },
      { field: 'goal', label: 'Goal', required: true },
      { field: 'motivation', label: 'Motivation', hidden: true },
    ],
  },
  {
    name: 'stakeholders',
    title: 'Stakeholders',
    file: 'data/stakeholders.yaml',
    key: 'stakeholders',
    keyField: 'role',
    fields: [
      { field: 'role', label: 'Role/Name', required: true },
      { field: 'contact', label: 'Contact' },
      { field: 'expectations', label: 'Expectations' },
    ],
  },
  {
    name: 'constraints',
    title: 'Constraints',
    file: 'data/constraints.yaml',
    key: 'constraints',
    keyField: 'id',
    idPrefix: 'c',
    fields: [
      { field: 'id', label: 'ID', type: 'id', hidden: true },
      { field: 'category', label: 'Category', values: ['technical', 'organizational', 'convention'] },
      { field: 'constraint', label: 'Constraint', required: true },
      { field: 'explanation', label: 'Explanation' },
    ],
  },
  {
    name: 'quality-overview',
    title: 'Quality requirements overview',
    file: 'data/quality-requirements.yaml',
    key: 'overview',
    keyField: 'category',
    fields: [
      { field: 'category', label: 'Category', required: true },
      { field: 'description', label: 'Description' },
    ],
  },
  {
    name: 'quality-scenarios',
    title: 'Quality scenarios',
    file: 'data/quality-requirements.yaml',
    key: 'scenarios',
    keyField: 'id',
    idPrefix: 'qs',
    fields: [
      { field: 'id', label: 'ID', type: 'id' },
      { field: 'name', label: 'Scenario', required: true },
      { field: 'kind', label: 'Kind', hidden: true, values: ['usage', 'change'] },
      { field: 'quality', label: 'Quality' },
      { field: 'goals', label: 'Quality goals', type: 'list', hidden: true },
      { field: 'priority', label: 'Priority', hidden: true },
      { field: 'context', label: 'Context' },
      { field: 'stimulus', label: 'Stimulus' },
      { field: 'metric', label: 'Metric / acceptance' },
      { field: 'source', label: 'Source', hidden: true },
      { field: 'environment', label: 'Environment', hidden: true },
      { field: 'artifact', label: 'Artifact', hidden: true },
      { field: 'response', label: 'Response', hidden: true },
      { field: 'responseMeasure', label: 'Response measure', hidden: true },
    ],
  },
  {
    name: 'risks',
    title: 'Risks and technical debt',
    file: 'data/risks.yaml',
    key: 'risks',
    keyField: 'id',
    idPrefix: 'r',
    fields: [
      { field: 'id', label: 'ID', type: 'id', hidden: true },
      { field: 'priority', label: 'Priority', values: ['high', 'medium', 'low'] },
      { field: 'kind', label: 'Kind', values: ['risk', 'debt'] },
      { field: 'title', label: 'Risk / debt', required: true },
      { field: 'description', label: 'Description' },
      { field: 'probability', label: 'Probability', hidden: true },
      { field: 'impact', label: 'Impact', hidden: true },
      { field: 'mitigation', label: 'Mitigation' },
    ],
  },
  {
    name: 'glossary',
    title: 'Glossary',
    file: 'data/glossary.yaml',
    key: 'terms',
    keyField: 'term',
    fields: [
      { field: 'term', label: 'Term', required: true },
      { field: 'definition', label: 'Definition', required: true },
      { field: 'synonyms', label: 'Synonyms', type: 'list', hidden: true },
      { field: 'translations', label: 'Translations', type: 'map', hidden: true },
    ],
  },
];

export function listByName(name: string): ListDef | undefined {
  return LISTS.find((l) => l.name === name);
}

/** The list a directive src points to: `data/x.yaml#key`, or the file's first list. */
export function listForSrc(src: string): ListDef | undefined {
  const [file, key] = src.split('#');
  return LISTS.find((l) => l.file === file && (!key || l.key === key));
}

export interface ColumnView {
  field: string;
  label: string;
  /** Width in percent of the table; unset = automatic. */
  width?: number;
}

export const defaultColumns = (list: ListDef): ColumnView[] => list.fields.filter((f) => !f.hidden).map(({ field, label }) => ({ field, label }));

/** Value of a field as editable text. */
export function cellText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(cellText).join(', ');
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${cellText(v)}`).join(', ');
  return String(value);
}

/** Editable text back to the field's stored value (undefined = remove the field). */
export function parseCell(text: string, type: FieldType | undefined): unknown {
  const t = text.trim();
  if (!t) return undefined;
  switch (type) {
    case 'int': {
      const n = Number(t);
      if (!Number.isInteger(n)) throw new Error(`"${t}" is not a whole number`);
      return n;
    }
    case 'list':
      return t.split(',').map((s) => s.trim()).filter(Boolean);
    case 'map':
      return Object.fromEntries(
        t.split(',').map((pair) => {
          const i = pair.indexOf(':');
          return i < 0 ? [pair.trim(), ''] : [pair.slice(0, i).trim(), pair.slice(i + 1).trim()];
        }),
      );
    default:
      return t;
  }
}
