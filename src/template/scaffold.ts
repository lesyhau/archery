// Generates the files of a fresh docs/architecture folder. Pure: returns path -> content,
// the caller writes them (see src/commands/init.ts).
import { stringify } from 'yaml';
import type { CanvasDiagram, Project } from '../model/schema';
import { ARC42_ATTRIBUTION, ARC42_TEMPLATE_VERSION, SECTIONS, type SectionDef } from './template';

export interface ScaffoldOptions {
  system: string;
  /** Embed the arc42 help texts as `<!-- archery:help ... -->` comments (invisible in preview/export). */
  includeHelp: boolean;
}

/** Paths are relative to the documentation root (e.g. `docs/architecture`) and use forward slashes. */
export type ScaffoldFiles = Map<string, string>;

export function helpComment(text: string): string {
  // `-->` would terminate the comment early.
  return `<!-- archery:help\n${text.replaceAll('-->', '- ->').trim()}\n-->`;
}

export function renderSection(section: SectionDef, includeHelp: boolean): string {
  const parts: string[] = [`# ${section.title}`];
  if (includeHelp) parts.push(helpComment(`${section.help}\n\nSee ${section.docsUrl}`));
  if (section.body) parts.push(section.body);
  for (const sub of section.subsections) {
    parts.push(`## ${sub.title}`);
    if (includeHelp && sub.help) parts.push(helpComment(sub.help));
    if (sub.body) parts.push(sub.body);
  }
  return parts.join('\n\n') + '\n';
}

function yamlFile(header: string[], data: unknown): string {
  return header.map((l) => `# ${l}`.trimEnd()).join('\n') + '\n' + stringify(data);
}

function emptyDiagram(type: CanvasDiagram['type'], title: string): string {
  const diagram: CanvasDiagram = { version: 1, type, title, nodes: [], edges: [], local: { nodes: [], edges: [] } };
  return JSON.stringify(diagram, null, 2) + '\n';
}

export function scaffold(options: ScaffoldOptions): ScaffoldFiles {
  const files: ScaffoldFiles = new Map();
  const system = options.system.trim();

  const project: Project = {
    version: 1,
    system,
    template: `arc42 ${ARC42_TEMPLATE_VERSION}`,
    authors: [],
    sections: SECTIONS.map((s) => ({ id: s.id, file: `sections/${s.file}`, enabled: true })),
  };
  files.set(
    'archery.yaml',
    yamlFile(
      [
        'Archery project file.',
        'Section order follows the list below; set `enabled: false` to hide a section from the tree and the export.',
        ARC42_ATTRIBUTION,
      ],
      project,
    ),
  );

  files.set(
    'model.yaml',
    yamlFile(
      [
        'Shared architecture model. Diagrams reference elements and relationships by id.',
        'Element kinds: actor | externalSystem | component | interface | package | node | executionEnvironment | artifact | class | enum',
        'Relationship kinds: association | aggregation | composition | generalization | realization | dependency | usage | connector | deploy',
      ],
      { elements: [], relationships: [] },
    ),
  );

  for (const section of SECTIONS) {
    files.set(`sections/${section.file}`, renderSection(section, options.includeHelp));
  }

  files.set(
    'data/quality-goals.yaml',
    yamlFile(
      [
        'Section 1.2 - top 3 (max 5) quality goals for the architecture, ordered by priority.',
        'Fields: id, priority (1 = highest), quality (e.g. ISO 25010 / Q42 characteristic), goal, motivation',
      ],
      { goals: [] },
    ),
  );
  files.set(
    'data/stakeholders.yaml',
    yamlFile(
      [
        'Section 1.3 - stakeholders and their expectations towards the architecture documentation.',
        'Fields: role, contact, expectations',
      ],
      { stakeholders: [] },
    ),
  );
  files.set(
    'data/constraints.yaml',
    yamlFile(
      [
        'Section 2 - architecture constraints.',
        'Fields: id, category (technical | organizational | convention), constraint, explanation',
      ],
      { constraints: [] },
    ),
  );
  files.set(
    'data/quality-requirements.yaml',
    yamlFile(
      [
        'Section 10 - quality requirements.',
        'overview (10.1) fields: category, description',
        'scenarios (10.2) fields: id, name, kind (usage | change), quality, goals (quality goal ids), priority,',
        '  short form: context, stimulus, metric',
        '  long form:  source, stimulus, environment, artifact, response, responseMeasure',
      ],
      { overview: [], scenarios: [] },
    ),
  );
  files.set(
    'data/risks.yaml',
    yamlFile(
      [
        'Section 11 - risks and technical debt, ordered by priority.',
        'Fields: id, kind (risk | debt), title, description, priority (high | medium | low), probability, impact, mitigation',
      ],
      { risks: [] },
    ),
  );
  files.set(
    'data/glossary.yaml',
    yamlFile(['Section 12 - glossary.', 'Fields: term, definition, translations (map), synonyms (list)'], { terms: [] }),
  );

  files.set('diagrams/building-blocks-l1.uml.json', emptyDiagram('component', 'Building blocks - level 1'));
  files.set('diagrams/deployment-l1.uml.json', emptyDiagram('deployment', 'Deployment - infrastructure level 1'));

  files.set(
    'decisions/README.md',
    `# Architecture Decision Records

One file per decision, named \`NNNN-short-title.md\` (e.g. \`0001-use-postgresql.md\`).

Each ADR starts with YAML front matter:

\`\`\`yaml
---
status: proposed        # proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
qualityGoals: []        # ids from data/quality-goals.yaml
constraints: []         # ids from data/constraints.yaml
---
\`\`\`

followed by the sections **Context**, **Decision**, **Consequences**
(see https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
`,
  );

  return files;
}
