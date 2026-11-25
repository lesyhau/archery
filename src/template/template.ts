// The arc42 template structure (version 9.1-EN), with condensed help texts.
//
// Source: arc42 template with help, © Dr. Peter Hruschka, Dr. Gernot Starke and contributors,
// https://arc42.org. Help texts below are condensed from that template.

export const ARC42_TEMPLATE_VERSION = '9.1-EN';
export const ARC42_ATTRIBUTION =
  'Structure and help texts based on the arc42 template (https://arc42.org), © Dr. Peter Hruschka, Dr. Gernot Starke and contributors, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).';

export interface SubsectionDef {
  title: string;
  help?: string;
  /** Markdown skeleton placed below the help text. */
  body?: string;
}

export interface SectionDef {
  /** Stable id used in archery.yaml. */
  id: string;
  number: number;
  title: string;
  /** File name inside `sections/`. */
  file: string;
  docsUrl: string;
  help: string;
  body?: string;
  subsections: SubsectionDef[];
}

// Placeholders: the document editor shows "click to write" hints in empty places, so the
// skeleton only keeps structure (labels, table headers), not "<insert text here>" paragraphs.
const WHITEBOX_TEMPLATE = `**Motivation**

**Contained Building Blocks**

| Name | Responsibility |
|---|---|
| *<black box 1>* | *<responsibility>* |

**Important Interfaces**`;

const BLACKBOX_HELP = `Black box template (one level-3 heading per important building block):
- Purpose/Responsibility
- Interface(s), unless described separately; may include quality and performance characteristics
- (Optional) quality/performance characteristics, e.g. availability, run time behavior
- (Optional) directory/file location
- (Optional) fulfilled requirements, if you need traceability
- (Optional) open issues/problems/risks`;

export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'introduction-and-goals',
    number: 1,
    title: 'Introduction and Goals',
    file: '01-introduction-and-goals.md',
    docsUrl: 'https://docs.arc42.org/section-1/',
    help: `Describes the relevant requirements and the driving forces that software architects and the development team must consider: underlying business goals, essential features and functional requirements, quality goals for the architecture, and relevant stakeholders and their expectations.`,
    subsections: [
      {
        title: 'Requirements Overview',
        help: `Contents: Short description of the functional requirements and driving forces; an extract (or abstract) of the requirements. Link to existing requirements documents (with version and location).

Motivation: From the point of view of the end users, a system is created or modified to improve support of a business activity and/or improve the quality.

Form: Short textual description, probably in tabular use-case format. Keep it short; balance readability against redundancy with the requirements documents. Edit data/requirements.yaml, or import the requirements from a requirements tool as ReqIF; link them to the building blocks that satisfy them.`,
        body: `<!-- archery:table data/requirements.yaml -->`,
      },
      {
        title: 'Quality Goals',
        help: `Contents: The top three (max five) quality goals for the architecture whose fulfillment is of highest importance to the major stakeholders. These are quality goals for the architecture, not project goals. Topics: see ISO 25010:2023 or the Q42 quality model (https://quality.arc42.org).

Motivation: Quality goals influence fundamental architectural decisions. Be concrete; avoid buzzwords.

Form: A table with quality goals and concrete scenarios, ordered by priority. Edit data/quality-goals.yaml; link scenarios to goals in data/quality-requirements.yaml.`,
        body: `<!-- archery:table data/quality-goals.yaml -->`,
      },
      {
        title: 'Stakeholders',
        help: `Contents: Everyone (persons, roles, organizations) who should know the architecture, has to be convinced of it, works with the architecture or the code, needs the documentation for their work, or decides about the system or its development.

Motivation: Unknown stakeholders cause nasty surprises later. Stakeholders determine the extent and level of detail of the documentation.

Form: Table with role/name, contact, and their expectations with respect to the architecture documentation (!) - not their functional or quality requirements. Edit data/stakeholders.yaml.`,
        body: `<!-- archery:table data/stakeholders.yaml -->`,
      },
    ],
  },
  {
    id: 'architecture-constraints',
    number: 2,
    title: 'Architecture Constraints',
    file: '02-architecture-constraints.md',
    docsUrl: 'https://docs.arc42.org/section-2/',
    help: `Contents: Any requirement that constrains architects in their freedom of design and implementation decisions, or decisions about the development process. Constraints may apply to whole organizations.

Motivation: Architects must know where they are free to decide and where they must adhere to constraints. Constraints must always be dealt with; they may be negotiable, though.

Form: Simple tables of constraints with explanations, optionally divided into technical constraints, organizational/political constraints, and conventions (programming, versioning, documentation, naming). Edit data/constraints.yaml.`,
    body: `<!-- archery:table data/constraints.yaml -->`,
    subsections: [],
  },
  {
    id: 'context-and-scope',
    number: 3,
    title: 'Context and Scope',
    file: '03-context-and-scope.md',
    docsUrl: 'https://docs.arc42.org/section-3/',
    help: `Contents: Delimits your system (its scope) from all its communication partners (neighboring systems and users, i.e. its context), thereby specifying the external interfaces. If necessary, differentiate the business context (domain-specific inputs and outputs) from the technical context (channels, protocols, hardware).

Motivation: The domain and technical interfaces to communication partners are among the most critical aspects of the system.

Form: Context diagrams and/or lists of communication partners and their interfaces.`,
    subsections: [
      {
        title: 'Business Context',
        help: `Contents: All communication partners (users, IT systems, ...) with explanations of domain-specific inputs and outputs or interfaces; optionally domain-specific formats or protocols.

Form: Diagrams that show the system as a black box with its domain interfaces, and/or a table: communication partner | inputs | outputs.`,
      },
      {
        title: 'Technical Context',
        help: `Contents: Technical interfaces (channels and transmission media) linking the system to its environment, plus a mapping of domain-specific input/output to the channels.

Form: E.g. a UML deployment diagram describing channels to neighboring systems, with a mapping table between channels and input/output.`,
      },
    ],
  },
  {
    id: 'solution-strategy',
    number: 4,
    title: 'Solution Strategy',
    file: '04-solution-strategy.md',
    docsUrl: 'https://docs.arc42.org/section-4/',
    help: `Contents: A short summary and explanation of the fundamental decisions and solution strategies that shape the architecture: technology decisions; top-level decomposition (e.g. architectural or design patterns); how key quality goals are achieved; relevant organizational decisions (e.g. development process, delegating tasks to third parties).

Motivation: These decisions are the cornerstones of the architecture and the foundation for many detailed decisions.

Form: Keep explanations short. Motivate what was decided and why, based on the problem statement, quality goals and key constraints. Refer to details in the following sections.`,
    subsections: [],
  },
  {
    id: 'building-block-view',
    number: 5,
    title: 'Building Block View',
    file: '05-building-block-view.md',
    docsUrl: 'https://docs.arc42.org/section-5/',
    help: `Contents: The static decomposition of the system into building blocks (modules, components, subsystems, classes, interfaces, packages, libraries, layers, ...) and their dependencies. Mandatory for every architecture documentation - the "floor plan".

Motivation: Keep an overview of the source code by making its structure understandable through abstraction, without disclosing implementation details.

Form: A hierarchy of white boxes and black boxes. Level 1 is the white box of the overall system with black box descriptions of its building blocks. Level 2 zooms into some level-1 building blocks, and so on.`,
    subsections: [
      {
        title: 'Whitebox Overall System',
        help: `Describe the decomposition of the overall system: an overview diagram, a motivation for the decomposition, black box descriptions of the contained building blocks (either one table of name + responsibility, or one black box template per building block as level-3 headings), and optionally important interfaces.

${BLACKBOX_HELP}`,
        body: `<!-- archery:diagram diagrams/building-blocks-l1.uml.json -->

${WHITEBOX_TEMPLATE}`,
      },
      {
        title: 'Level 2',
        help: `Specify the inner structure of (some) level-1 building blocks as white boxes, one level-3 heading "White Box <building block>" each. Prefer relevance over completeness: describe important, surprising, risky, complex or volatile building blocks; leave out normal, simple or standardized parts.`,
        body: `### White Box *<building block 1>*`,
      },
      {
        title: 'Level 3',
        help: `Specify the inner structure of (some) level-2 building blocks as white boxes. Copy this part for further levels if needed.`,
        body: `### White Box *<building block x.1>*`,
      },
    ],
  },
  {
    id: 'runtime-view',
    number: 6,
    title: 'Runtime View',
    file: '06-runtime-view.md',
    docsUrl: 'https://docs.arc42.org/section-6/',
    help: `Contents: Concrete behavior and interactions of the building blocks as scenarios: important use cases or features; interactions at critical external interfaces; operation and administration (launch, start-up, stop); error and exception scenarios. Choose scenarios by architectural relevance - a representative selection, not many.

Motivation: Shows how building block instances do their job and communicate at runtime; helps stakeholders who are less able to read the static views.

Form: Numbered steps, activity diagrams or flow charts, sequence diagrams, BPMN, state machines, ...`,
    subsections: [
      {
        title: '<Runtime Scenario 1>',
      },
    ],
  },
  {
    id: 'deployment-view',
    number: 7,
    title: 'Deployment View',
    file: '07-deployment-view.md',
    docsUrl: 'https://docs.arc42.org/section-7/',
    help: `Contents: (1) The technical infrastructure that executes the system - locations, environments, computers, processors, channels, net topologies - and (2) the mapping of software building blocks to that infrastructure. Document all relevant environments (development, test, production). Capture only the infrastructure needed to show the deployment of your building blocks.

Motivation: Software does not run without hardware; the infrastructure influences the system and some cross-cutting concepts.

Form: UML deployment diagrams, possibly nested. A highest-level view may already be in section 3.2 (technical context); zoom into it here.`,
    subsections: [
      {
        title: 'Infrastructure Level 1',
        help: `Describe (diagrams, tables, text): distribution of the system to locations, environments, computers, ... and the physical connections between them; justifications for this deployment structure; quality and/or performance features of the infrastructure; mapping of software artifacts to infrastructure elements. Copy this section for multiple environments.`,
        body: `<!-- archery:diagram diagrams/deployment-l1.uml.json -->

**Motivation**

**Quality and/or Performance Features**

**Mapping of Building Blocks to Infrastructure**`,
      },
      {
        title: 'Infrastructure Level 2',
        help: `Include the internal structure of (some) infrastructure elements from level 1, one level-3 heading per element. Copy the structure of level 1.`,
        body: `### *<Infrastructure Element 1>*`,
      },
    ],
  },
  {
    id: 'crosscutting-concepts',
    number: 8,
    title: 'Cross-cutting Concepts',
    file: '08-crosscutting-concepts.md',
    docsUrl: 'https://docs.arc42.org/section-8/',
    help: `Contents: Overall, principal regulations and solution ideas (practices, patterns, rules) relevant to multiple building blocks, e.g. domain model, persistence, security, logging, error handling, UI, testability, operations.

Motivation: Concepts are the basis for conceptual integrity (consistency, homogeneity) of the architecture.

Form: Concept papers, example implementations, model excerpts or scenarios using the notations of the architecture views (e.g. a class diagram for the domain model, a state machine).

Structure: Pick ONLY the most-needed topics for your system, one level-2 heading each (8.1, 8.2, ...). Do NOT attempt to cover all possible topics.`,
    subsections: [
      { title: '<Concept 1>' },
      { title: '<Concept 2>' },
    ],
  },
  {
    id: 'architecture-decisions',
    number: 9,
    title: 'Architecture Decisions',
    file: '09-architecture-decisions.md',
    docsUrl: 'https://docs.arc42.org/section-9/',
    help: `Contents: Important, expensive, large-scale or risky architecture decisions including rationales - i.e. selecting one alternative based on given criteria. Decide whether a decision belongs here or locally (e.g. in a building block's white box). Avoid redundancy with section 4.

Motivation: Stakeholders should be able to comprehend and retrace your decisions.

Form: One ADR per important decision (decisions/NNNN-title.md), a list or table ordered by importance, or separate sections per decision.`,
    body: `<!-- archery:decisions decisions -->`,
    subsections: [],
  },
  {
    id: 'quality-requirements',
    number: 10,
    title: 'Quality Requirements',
    file: '10-quality-requirements.md',
    docsUrl: 'https://docs.arc42.org/section-10/',
    help: `Contents: All relevant quality requirements. The most important ones are the quality goals of section 1.2 - only reference them here. Also capture requirements of lesser importance (nice-to-have).

Motivation: Quality requirements strongly influence architectural decisions; know what is really important to stakeholders, in a specific and measurable way. See the Q42 quality model: https://quality.arc42.org.`,
    subsections: [
      {
        title: 'Quality Requirements Overview',
        help: `Contents: An overview or summary of quality requirements, e.g. by category or topic (ISO 25010:2023, Q42). If these summaries are already specific and measurable, you may skip 10.2.

Form: A simple table (category/topic | short description), a mind map, or a quality attribute (utility) tree. Edit the "overview" list in data/quality-requirements.yaml.`,
        body: `<!-- archery:table data/quality-requirements.yaml#overview -->`,
      },
      {
        title: 'Quality Scenarios',
        help: `Contents: Scenarios make quality requirements concrete and decidable (acceptance criteria); keep them specific and measurable. Usage scenarios describe the runtime reaction to a stimulus (incl. performance); change scenarios describe the effect/effort of a modification.

Form - short (Q42): context/background, source/stimulus, metric/acceptance criteria.
Form - long (SEI, Bass et al.): id, name, source, stimulus, environment, artifact, response, response measure.

Edit the "scenarios" list in data/quality-requirements.yaml; link each scenario to the quality goals (1.2) it refines.`,
        body: `<!-- archery:table data/quality-requirements.yaml#scenarios -->`,
      },
    ],
  },
  {
    id: 'risks-and-technical-debt',
    number: 11,
    title: 'Risks and Technical Debts',
    file: '11-risks-and-technical-debt.md',
    docsUrl: 'https://docs.arc42.org/section-11/',
    help: `Contents: Identified technical risks and technical debts, ordered by priority.

Motivation: "Risk management is project management for grown-ups" (Tim Lister). Management stakeholders need this for the overall risk analysis.

Form: List of risks and/or technical debts, with suggested measures to minimize, mitigate or avoid risks or reduce debt. Edit data/risks.yaml.`,
    body: `<!-- archery:table data/risks.yaml -->`,
    subsections: [],
  },
  {
    id: 'glossary',
    number: 12,
    title: 'Glossary',
    file: '12-glossary.md',
    docsUrl: 'https://docs.arc42.org/section-12/',
    help: `Contents: The most important domain and technical terms that stakeholders use when discussing the system. Can also serve as a translation reference in multi-language teams.

Motivation: All stakeholders should have an identical understanding of the terms, without synonyms and homonyms.

Form: A table with term and definition, possibly more columns for translations. Edit data/glossary.yaml.`,
    body: `<!-- archery:table data/glossary.yaml -->`,
    subsections: [],
  },
];

export function findSection(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}
