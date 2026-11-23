// Zod schemas for every Archery file format.
// Pure TypeScript: bundled into both the extension host and the webviews.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// archery.yaml — project metadata, section order, enabled sections
// ---------------------------------------------------------------------------

export const SectionRefSchema = z.object({
  /** One of the 12 standard arc42 section ids (see src/template/template.ts) or a custom id. */
  id: z.string().min(1),
  /** Path relative to the documentation root, e.g. `sections/01-introduction-and-goals.md`. */
  file: z.string().min(1),
  /** Optional title override; defaults to the standard arc42 title. */
  title: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type SectionRef = z.infer<typeof SectionRefSchema>;

/**
 * How the document is exported (HTML / PDF). Every field is optional; see resolveExportSettings
 * in src/export/exportSettings.ts for the defaults. Header and footer: up to three parts
 * "left | center | right" with the placeholders {chapter} {title} {system} {version} {date} {page} {pages}.
 * Headings are always numbered, every chapter starts on a new page and the change history is
 * always the last numbered chapter.
 */
export const ExportSettingsSchema = z.object({
  /** Text font family, e.g. "Segoe UI", "Calibri", "Georgia" (must be installed). */
  font: z.string().optional(),
  /** Heading font family (default: the text font). */
  headingFont: z.string().optional(),
  /** Base text size in points. */
  fontSize: z.number().min(7).max(20).optional(),
  pageSize: z.enum(['A4', 'Letter', 'Legal', 'A3', 'A5']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  margins: z.enum(['narrow', 'normal', 'wide']).optional(),
  header: z.string().optional(),
  footer: z.string().optional(),
  pageNumbers: z.enum(['none', 'bottom-center', 'bottom-right', 'top-right']).optional(),
  /** Page number text, e.g. "Page {page} of {pages}". */
  pageNumberFormat: z.string().optional(),
  /** Contents: 0 = none, 1 = chapters, 2 = + sections, 3 = + subsections, 4 = all headings. */
  tocDepth: z.number().int().min(0).max(4).optional(),
  cover: z.boolean().optional(),
  /** "Archery" and its version in the footer (default: the setting archery.export.credit, on). */
  credit: z.boolean().optional(),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export const ProjectSchema = z.object({
  version: z.literal(1),
  /** Name of the system being documented. */
  system: z.string().min(1),
  title: z.string().optional(),
  /** arc42 template version the skeleton was generated from, e.g. `9.1-EN`. */
  template: z.string().optional(),
  authors: z.array(z.string()).default([]),
  sections: z.array(SectionRefSchema),
  /** Export options (font, page, header / footer, contents, ...). */
  export: ExportSettingsSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

// ---------------------------------------------------------------------------
// model.yaml — shared model: elements + relationships
// ---------------------------------------------------------------------------

export const ElementKinds = [
  'actor',
  'externalSystem',
  'usecase',
  'component',
  'interface',
  'port',
  'package',
  'node',
  'executionEnvironment',
  'artifact',
  'class',
  'datatype',
  'enum',
  'naryAssociation',
  // object diagrams (and deployment instances): an instance of a classifier, drawn "name : Type" underlined
  'instance',
  // composite structure diagrams
  'part',
  'collaboration',
  'collaborationUse',
] as const;
export const ElementKindSchema = z.enum(ElementKinds);
export type ElementKind = z.infer<typeof ElementKindSchema>;

/** Kinds that can contain other elements on a diagram (drawn as containers). */
export const ContainerKinds: readonly ElementKind[] = ['package', 'node', 'executionEnvironment', 'component', 'class', 'collaboration', 'instance'];

export const VisibilitySchema = z.enum(['+', '-', '#', '~']);

export const AttributeSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  visibility: VisibilitySchema.optional(),
  static: z.boolean().optional(),
  /** Derived attribute, shown as "/name". */
  derived: z.boolean().optional(),
  multiplicity: z.string().optional(),
  default: z.string().optional(),
});
export type Attribute = z.infer<typeof AttributeSchema>;

export const ParameterSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
});

export const OperationSchema = z.object({
  name: z.string().min(1),
  params: z.array(ParameterSchema).optional(),
  returns: z.string().optional(),
  visibility: VisibilitySchema.optional(),
  static: z.boolean().optional(),
  abstract: z.boolean().optional(),
});
export type Operation = z.infer<typeof OperationSchema>;

/** Ids are stable, never shown, and must not change when the element is renamed. */
export const IdSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/, 'ids must start with a letter or "_" and contain only letters, digits, "_", "-" or "."');

/** How a use case runs: kept short, one step per entry. */
export const ScenarioSchema = z.object({
  /** What starts it, e.g. "Customer clicks Checkout". */
  trigger: z.string().optional(),
  preconditions: z.array(z.string()).optional(),
  /** Main success scenario. */
  steps: z.array(z.string()).optional(),
  /** Alternative and exception flows: when a condition holds, these steps happen instead. */
  alternatives: z.array(z.object({ when: z.string(), steps: z.array(z.string()).default([]) })).optional(),
  postconditions: z.array(z.string()).optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ElementSchema = z.object({
  id: IdSchema,
  kind: ElementKindSchema,
  name: z.string().min(1),
  /** Containment: package/component/node nesting, a port's component, an artifact's node. */
  parent: IdSchema.optional(),
  stereotype: z.string().optional(),
  description: z.string().optional(),
  abstract: z.boolean().optional(),
  /** Generic type parameters of a class/interface, e.g. ["T", "K extends Key"]. */
  typeParams: z.array(z.string()).optional(),
  attributes: z.array(AttributeSchema).optional(),
  operations: z.array(OperationSchema).optional(),
  /** Enum literals (kind: enum). */
  literals: z.array(z.string()).optional(),
  /** Technology, platform or protocol, e.g. "Spring Boot", "PostgreSQL 16", "REST/HTTPS". */
  technology: z.string().optional(),
  /** Version of a component or artifact. */
  version: z.string().optional(),
  /** Number of instances of a node, execution environment or component, e.g. "3" or "1..*". */
  instances: z.string().optional(),
  /** What the element is responsible for, one point per entry. */
  responsibilities: z.array(z.string()).optional(),
  /** What an actor wants to achieve. */
  goals: z.array(z.string()).optional(),
  /** The flow of a use case. */
  scenario: ScenarioSchema.optional(),
  /** Invariants and other constraints, shown as {constraint}. */
  constraints: z.array(z.string()).optional(),
  /** Tagged values, e.g. { owner: "Team Payments", sla: "99.9%" }. */
  tags: z.record(z.string(), z.string()).optional(),
  /** The type of an instance, part or collaboration use (an element id). */
  classifier: IdSchema.optional(),
  /** Slot values of an instance, e.g. [{ name: "status", value: "PAID" }]. */
  slots: z.array(z.object({ name: z.string().min(1), value: z.string() })).optional(),
  /** Multiplicity of a part, e.g. "1..*". */
  multiplicity: z.string().optional(),
  /** A part that is a reference (not owned by composition): drawn dashed. */
  reference: z.boolean().optional(),
  /** Extension points of a use case, e.g. "payment failed". */
  extensionPoints: z.array(z.string()).optional(),
  /**
   * The diagram that shows this element in detail (path relative to the root, e.g.
   * "diagrams/order-service-internals.uml.json"). Other diagrams mark the element and link to it.
   */
  detail: z.string().optional(),
});
export type Element = z.infer<typeof ElementSchema>;

export const RelationshipKinds = [
  'association',
  'aggregation',
  'composition',
  'generalization',
  'realization',
  'dependency',
  'usage',
  'connector',
  'deploy',
  /** An instance of an association between two instances (object diagrams). */
  'link',
  /** «manifest»: an artifact embodies a component or another element (deployment). */
  'manifest',
] as const;
export const RelationshipKindSchema = z.enum(RelationshipKinds);
export type RelationshipKind = z.infer<typeof RelationshipKindSchema>;

const ends = <T extends z.ZodType>(t: T) => z.object({ from: t.optional(), to: t.optional() });

export const RelationshipSchema = z.object({
  id: IdSchema,
  kind: RelationshipKindSchema,
  from: IdSchema,
  to: IdSchema,
  label: z.string().optional(),
  /** E.g. "include", "extend", "use", "HTTPS" - shown as «stereotype». */
  stereotype: z.string().optional(),
  multiplicity: ends(z.string()).optional(),
  /** Association end (role) names. */
  roles: ends(z.string()).optional(),
  /** Qualifier attributes at an association end, e.g. { from: "isbn: String" }. */
  qualifier: ends(z.string()).optional(),
  /** Explicit navigability of association ends (open arrowheads). */
  navigable: ends(z.boolean()).optional(),
  /** Id of the class that is this association's association class. */
  associationClass: IdSchema.optional(),
  /** «extend»: when the extension applies, shown in a note on the relationship. */
  condition: z.string().optional(),
  /** «extend»: the extension point of the extended use case. */
  extensionPoint: z.string().optional(),
  description: z.string().optional(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const ModelSchema = z.object({
  elements: z.array(ElementSchema).default([]),
  relationships: z.array(RelationshipSchema).default([]),
});
export type Model = z.infer<typeof ModelSchema>;

// ---------------------------------------------------------------------------
// *.uml.json — canvas diagrams (views onto the model)
// ---------------------------------------------------------------------------

export const CanvasDiagramTypes = ['component', 'package', 'deployment', 'class', 'state', 'activity', 'context', 'object', 'composite', 'interactionOverview'] as const;
export const CanvasDiagramTypeSchema = z.enum(CanvasDiagramTypes);
export type CanvasDiagramType = z.infer<typeof CanvasDiagramTypeSchema>;

export const PointSchema = z.object({ x: z.number(), y: z.number() });

/** Positions are absolute diagram coordinates, also for nested elements. */
export const DiagramNodeSchema = z.object({
  /** Element id in model.yaml. */
  ref: IdSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  /** Presentation options, e.g. { notation: "lollipop" } for an interface. */
  style: z.record(z.string(), z.string()).optional(),
});
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;

/**
 * How an edge's line is drawn (its `style.line`): straight, with right angles, curved, or with one
 * corner (horizontal first / vertical first). Without it the diagram style decides: straight in
 * Classic, right angles in Modern.
 */
export const LineShapes = ['straight', 'orthogonal', 'curved', 'horizontalFirst', 'verticalFirst'] as const;
export const LineShapeSchema = z.enum(LineShapes);
export type LineShape = z.infer<typeof LineShapeSchema>;

export const DiagramEdgeSchema = z.object({
  /** Relationship id in model.yaml. */
  ref: IdSchema,
  waypoints: z.array(PointSchema).default([]),
  /** A moved label: its offset from the default place (a dotted line then ties it to its line or shape). */
  labelOffset: PointSchema.optional(),
  style: z.record(z.string(), z.string()).optional(),
});
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;

/** Diagram-local node kinds: notes, and the nodes of state machines and activity diagrams. */
export const LocalNodeKinds = [
  'note',
  // state machines
  'state',
  'initial',
  'final',
  'choice',
  'junction',
  'fork',
  'join',
  'history',
  'deepHistory',
  'terminate',
  /** An orthogonal region of a composite state (inside the state, separated by dashed lines). */
  'region',
  /** Entry / exit point pseudostates on the border of a state (machine). */
  'entryPoint',
  'exitPoint',
  // activity diagrams
  'action',
  'activityFinal',
  'flowFinal',
  'decision',
  'merge',
  'object',
  'partition',
  'sendSignal',
  'acceptEvent',
  /** Accept time event (hourglass), e.g. "every 5 min". */
  'acceptTimeEvent',
  /** Input / output pin on the border of an action. */
  'pin',
  /** Interruptible activity region (dashed); leave it with an interrupting edge. */
  'interruptibleRegion',
  // interaction overview diagrams
  'interactionUse',
  'interaction',
] as const;
export const LocalNodeKindSchema = z.enum(LocalNodeKinds);
export type LocalNodeKind = z.infer<typeof LocalNodeKindSchema>;

/** Diagram-only node (kept out of the shared model in v1). */
export const LocalNodeSchema = z.object({
  id: IdSchema,
  kind: LocalNodeKindSchema,
  name: z.string().optional(),
  /** Note text; for states the internal activities ("entry / ...", "do / ...", "exit / ..."), one per line. */
  text: z.string().optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  /** Composite state or activity partition containing this node. */
  parent: IdSchema.optional(),
  /** Interaction overview: the sequence / communication / timing diagram a ref or sd frame stands for. */
  diagram: z.string().optional(),
  /** A moved name label (border nodes, decisions, time events): its offset from the default place. */
  labelOffset: PointSchema.optional(),
});
export type LocalNode = z.infer<typeof LocalNodeSchema>;

/** interrupt: an interrupting edge leaving an interruptible region (drawn as a lightning bolt). */
export const LocalEdgeKinds = ['transition', 'flow', 'anchor', 'interrupt'] as const;
export const LocalEdgeKindSchema = z.enum(LocalEdgeKinds);

export const LocalEdgeSchema = z.object({
  id: IdSchema,
  /** transition (state machines: "trigger [guard] / effect"), flow (activities: "[guard]"), anchor (note link). */
  kind: LocalEdgeKindSchema,
  /** A local node id or a model element ref on this diagram. */
  from: IdSchema,
  to: IdSchema,
  label: z.string().optional(),
  waypoints: z.array(PointSchema).default([]),
  /** A moved label: its offset from the default place (a dotted line then ties it to its line or shape). */
  labelOffset: PointSchema.optional(),
  /** Presentation options, e.g. { line: "curved" } (see LineShapes). */
  style: z.record(z.string(), z.string()).optional(),
});
export type LocalEdge = z.infer<typeof LocalEdgeSchema>;

/** What the shapes and lines of a canvas diagram show. */
export const DiagramShowSchema = z.object({
  /** Tagged values ({owner=…, location=…}) in the boxes; default false. */
  tags: z.boolean().optional(),
  /**
   * Relationship keywords («use», «deploy», «manifest») on the lines: true on every line, false on none,
   * 'auto' (the default) on every line except «use» on a line that has a label.
   */
  keywords: z.union([z.boolean(), z.literal('auto')]).optional(),
});
export type DiagramShow = z.infer<typeof DiagramShowSchema>;

export const CanvasDiagramSchema = z.object({
  version: z.literal(1),
  type: CanvasDiagramTypeSchema,
  title: z.string().default(''),
  show: DiagramShowSchema.optional(),
  nodes: z.array(DiagramNodeSchema).default([]),
  edges: z.array(DiagramEdgeSchema).default([]),
  local: z
    .object({
      nodes: z.array(LocalNodeSchema).default([]),
      edges: z.array(LocalEdgeSchema).default([]),
    })
    .default({ nodes: [], edges: [] }),
});
export type CanvasDiagram = z.infer<typeof CanvasDiagramSchema>;

// ---------------------------------------------------------------------------
// *.seq.json — sequence diagrams
// ---------------------------------------------------------------------------

export const MessageKinds = ['sync', 'async', 'reply', 'create', 'destroy', 'self', 'lost', 'found'] as const;
export const MessageKindSchema = z.enum(MessageKinds);
export type MessageKind = z.infer<typeof MessageKindSchema>;

/** A lost message has no receiver (`to`), a found message no sender (`from`). */
export const MessageSchema = z
  .object({
    from: IdSchema.optional(),
    to: IdSchema.optional(),
    label: z.string().default(''),
    kind: MessageKindSchema.default('sync'),
    /** Self, lost and found messages: drawn as an asynchronous message (open arrowhead) instead of a call. */
    async: z.boolean().optional(),
    /** Lost / found messages: the missing end is a gate on the diagram frame (outside the interaction) instead of unknown. */
    gate: z.boolean().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.kind !== 'found' && !m.from) ctx.addIssue({ code: 'custom', message: `a ${m.kind} message needs "from"`, path: ['from'] });
    if (m.kind !== 'lost' && !m.to) ctx.addIssue({ code: 'custom', message: `a ${m.kind} message needs "to"`, path: ['to'] });
  });
export type Message = z.infer<typeof MessageSchema>;

/** Combined fragment operators (UML 2.0). */
export const FragmentOperators = ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'neg', 'strict', 'seq', 'ignore', 'consider', 'assert'] as const;
export type FragmentOperator = (typeof FragmentOperators)[number];

export type SequenceStep =
  | { msg: Message }
  /** min / max: iterations of a loop, drawn "loop(min,max)"; max "*" means unlimited. */
  | { fragment: FragmentOperator; branches: { guard?: string; steps: SequenceStep[] }[]; min?: number; max?: number | '*' }
  | { fragment: 'ref'; label: string; over: string[] }
  | { note: string; over: string[] }
  /** A state invariant or timing/duration constraint, drawn as "{text}" across lifelines. */
  | { constraint: string; over: string[] };

export const SequenceStepSchema: z.ZodType<SequenceStep> = z.lazy(() =>
  z.union([
    z.object({ msg: MessageSchema }),
    z.object({
      fragment: z.enum(FragmentOperators),
      branches: z.array(z.object({ guard: z.string().optional(), steps: z.array(SequenceStepSchema) })).min(1),
      min: z.number().int().min(0).optional(),
      max: z.union([z.number().int().min(0), z.literal('*')]).optional(),
    }),
    z.object({ fragment: z.literal('ref'), label: z.string(), over: z.array(IdSchema).min(1) }),
    z.object({ note: z.string(), over: z.array(IdSchema).min(1) }),
    z.object({ constraint: z.string(), over: z.array(IdSchema).min(1) }),
  ]),
) as z.ZodType<SequenceStep>;

export const SequenceDiagramSchema = z.object({
  version: z.literal(1),
  type: z.literal('sequence'),
  title: z.string().default(''),
  /** role: the lifeline's name, shown as "role : Type" (an anonymous instance is ":Type"). */
  lifelines: z.array(z.object({ ref: IdSchema, role: z.string().optional() })).default([]),
  steps: z.array(SequenceStepSchema).default([]),
  /** How the interaction is drawn: as a sequence diagram (default) or a communication diagram. */
  notation: z.enum(['sequence', 'communication']).optional(),
  /** Communication diagrams: top-left positions of the participant boxes (automatic when missing). */
  positions: z.record(IdSchema, PointSchema).optional(),
});
export type SequenceDiagram = z.infer<typeof SequenceDiagramSchema>;

// ---------------------------------------------------------------------------
// *.timing.json — timing diagrams (UML 2.0, 14.4): each lifeline is a band whose state (or
// value) changes along a time axis; messages go between lifelines at points in time; duration
// and time constraints mark intervals and instants.
// ---------------------------------------------------------------------------

export const TimingLifelineSchema = z.object({
  ref: IdSchema,
  /** The lifeline's name, shown as "role : Type". */
  role: z.string().optional(),
  /** state: a state / condition timeline, one row per state (default); value: the compact value lifeline. */
  form: z.enum(['state', 'value']).optional(),
  /** States (or values) from top to bottom; states only used in `changes` are listed after them. */
  states: z.array(z.string()).default([]),
  /** From `at` on, the lifeline is in `state` (drawn in time order). */
  changes: z.array(z.object({ at: z.number().min(0), state: z.string() })).default([]),
});
export type TimingLifeline = z.infer<typeof TimingLifelineSchema>;

export const TimingMessageKinds = ['sync', 'async', 'reply'] as const;
/** A message without `from` (or `to`) comes from (or goes to) a gate on the frame: outside the interaction. */
export const TimingMessageSchema = z.object({
  from: IdSchema.optional(),
  to: IdSchema.optional(),
  /** When it is sent. */
  at: z.number().min(0),
  /** When it arrives (default: when it is sent). */
  arrive: z.number().min(0).optional(),
  label: z.string().default(''),
  kind: z.enum(TimingMessageKinds).default('async'),
}).refine((m) => m.from || m.to, { message: 'a message needs "from" or "to"' });
export type TimingMessage = z.infer<typeof TimingMessageSchema>;

/** A duration constraint from `from` to `to` (e.g. "d..3*d"), or a time constraint / observation at `from` when `to` is missing. */
export const TimingConstraintSchema = z.object({
  on: IdSchema,
  from: z.number().min(0),
  to: z.number().min(0).optional(),
  label: z.string().default(''),
});
export type TimingConstraint = z.infer<typeof TimingConstraintSchema>;

export const TimingDiagramSchema = z.object({
  version: z.literal(1),
  type: z.literal('timing'),
  title: z.string().default(''),
  /** Time unit shown on the axis, e.g. "ms". */
  unit: z.string().default(''),
  /** End of the time axis (default: just after the last event). */
  end: z.number().positive().optional(),
  /** Distance between axis ticks (default: automatic). */
  tick: z.number().positive().optional(),
  lifelines: z.array(TimingLifelineSchema).default([]),
  messages: z.array(TimingMessageSchema).default([]),
  constraints: z.array(TimingConstraintSchema).default([]),
});
export type TimingDiagram = z.infer<typeof TimingDiagramSchema>;

// ---------------------------------------------------------------------------
// data/*.yaml — structured sections (columns follow the arc42 template)
// ---------------------------------------------------------------------------

/** Section 1.2 — top 3 (max 5) quality goals, ordered by priority. */
export const QualityGoalsSchema = z.object({
  goals: z
    .array(
      z.object({
        id: IdSchema,
        priority: z.number().int().positive(),
        /** Quality characteristic, e.g. an ISO 25010 / Q42 category. */
        quality: z.string().min(1),
        goal: z.string().min(1),
        motivation: z.string().optional(),
      }),
    )
    .default([]),
});
export type QualityGoals = z.infer<typeof QualityGoalsSchema>;

/** Section 1.3 — role/name, contact, expectations towards the architecture documentation. */
export const StakeholdersSchema = z.object({
  stakeholders: z
    .array(
      z.object({
        role: z.string().min(1),
        contact: z.string().optional(),
        expectations: z.string().optional(),
      }),
    )
    .default([]),
});
export type Stakeholders = z.infer<typeof StakeholdersSchema>;

/** Section 2 — constraints, optionally grouped into technical / organizational / conventions. */
export const ConstraintsSchema = z.object({
  constraints: z
    .array(
      z.object({
        id: IdSchema,
        category: z.enum(['technical', 'organizational', 'convention']).default('technical'),
        constraint: z.string().min(1),
        explanation: z.string().optional(),
      }),
    )
    .default([]),
});
export type Constraints = z.infer<typeof ConstraintsSchema>;

/**
 * Section 10.1 — quality requirements overview: one row per category/topic.
 * Section 10.2 — quality scenarios. Supports the short (Q42) form
 * (context, stimulus, metric) and the long (SEI) form (source, stimulus,
 * environment, artifact, response, responseMeasure).
 */
export const QualityRequirementsSchema = z.object({
  overview: z
    .array(
      z.object({
        category: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .default([]),
  scenarios: z
    .array(
      z.object({
        id: IdSchema,
        name: z.string().min(1),
        kind: z.enum(['usage', 'change']).default('usage'),
        quality: z.string().optional(),
        /** Ids of the quality goals (section 1.2) this scenario makes concrete. */
        goals: z.array(IdSchema).default([]),
        priority: z.string().optional(),
        // short form
        context: z.string().optional(),
        stimulus: z.string().optional(),
        metric: z.string().optional(),
        // long form (adds to `stimulus`)
        source: z.string().optional(),
        environment: z.string().optional(),
        artifact: z.string().optional(),
        response: z.string().optional(),
        responseMeasure: z.string().optional(),
      }),
    )
    .default([]),
});
export type QualityRequirements = z.infer<typeof QualityRequirementsSchema>;

/** Section 11 — risks and technical debt, ordered by priority. */
export const RisksSchema = z.object({
  risks: z
    .array(
      z.object({
        id: IdSchema,
        kind: z.enum(['risk', 'debt']).default('risk'),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.enum(['high', 'medium', 'low']).optional(),
        probability: z.string().optional(),
        impact: z.string().optional(),
        mitigation: z.string().optional(),
      }),
    )
    .default([]),
});
export type Risks = z.infer<typeof RisksSchema>;

/** Section 12 — term/definition, with optional translations for multi-language teams. */
export const GlossarySchema = z.object({
  terms: z
    .array(
      z.object({
        term: z.string().min(1),
        definition: z.string().min(1),
        translations: z.record(z.string(), z.string()).optional(),
        synonyms: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});
export type Glossary = z.infer<typeof GlossarySchema>;

/** Section 9 — YAML front matter of an ADR in decisions/NNNN-title.md. */
export const AdrFrontMatterSchema = z.object({
  status: z.enum(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']).default('proposed'),
  date: z.string().optional(),
  deciders: z.array(z.string()).optional(),
  supersedes: z.string().optional(),
  /** Ids of quality goals / constraints this decision addresses. */
  qualityGoals: z.array(IdSchema).default([]),
  constraints: z.array(IdSchema).default([]),
});
export type AdrFrontMatter = z.infer<typeof AdrFrontMatterSchema>;

/** Maps well-known data file names to their schema. */
export const DataFileSchemas = {
  'quality-goals.yaml': QualityGoalsSchema,
  'stakeholders.yaml': StakeholdersSchema,
  'constraints.yaml': ConstraintsSchema,
  'quality-requirements.yaml': QualityRequirementsSchema,
  'risks.yaml': RisksSchema,
  'glossary.yaml': GlossarySchema,
} as const;
export type DataFileName = keyof typeof DataFileSchemas;
