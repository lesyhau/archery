// Cross-file consistency checks (references between model, diagrams and data).
// Schema validation of single files lives in load.ts.
import type { Issue } from './load';
import type { CanvasDiagram, Message, Model, QualityGoals, QualityRequirements, Requirements, SequenceDiagram, SequenceStep, TimingDiagram } from './schema';

export interface CheckInput {
  model: Model;
  canvasDiagrams: { file: string; diagram: CanvasDiagram }[];
  sequenceDiagrams: { file: string; diagram: SequenceDiagram }[];
  timingDiagrams?: { file: string; diagram: TimingDiagram }[];
  qualityGoals?: QualityGoals;
  qualityRequirements?: QualityRequirements;
  requirements?: Requirements;
}

const LIFELINE_KINDS = new Set(['actor', 'component', 'externalSystem']);

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) (seen.has(id) ? dups : seen).add(id);
  return [...dups];
}

export function forEachMessage(steps: SequenceStep[], fn: (msg: Message) => void): void {
  for (const step of steps) {
    if ('msg' in step) fn(step.msg);
    else if ('branches' in step) step.branches.forEach((b) => forEachMessage(b.steps, fn));
  }
}

export function checkReferences(input: CheckInput): Issue[] {
  const issues: Issue[] = [];
  const error = (file: string, message: string) => issues.push({ file, message, severity: 'error' });
  const warn = (file: string, message: string) => issues.push({ file, message, severity: 'warning' });

  const { model } = input;
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const relationships = new Map(model.relationships.map((r) => [r.id, r]));

  for (const id of duplicates(model.elements.map((e) => e.id))) error('model.yaml', `Duplicate element id "${id}"`);
  for (const id of duplicates(model.relationships.map((r) => r.id))) error('model.yaml', `Duplicate relationship id "${id}"`);
  for (const e of model.elements) {
    if (e.parent && !elements.has(e.parent)) error('model.yaml', `Element "${e.id}" has unknown parent "${e.parent}"`);
    if (e.classifier && !elements.has(e.classifier)) error('model.yaml', `Element "${e.id}" has unknown classifier (type) "${e.classifier}"`);
  }
  for (const r of model.relationships) {
    for (const end of [r.from, r.to]) {
      if (!elements.has(end)) error('model.yaml', `Relationship "${r.id}" refers to unknown element "${end}"`);
    }
    if (r.associationClass && !elements.has(r.associationClass)) {
      error('model.yaml', `Relationship "${r.id}" has unknown association class "${r.associationClass}"`);
    }
  }
  const diagramFiles = new Set([...input.canvasDiagrams, ...input.sequenceDiagrams, ...(input.timingDiagrams ?? [])].map((d) => d.file));
  for (const e of model.elements) {
    if (e.kind === 'port' && !e.parent) warn('model.yaml', `Port "${e.id}" has no parent component`);
    if (e.detail && !diagramFiles.has(e.detail)) warn('model.yaml', `Element "${e.id}" is detailed in "${e.detail}", which is not a diagram of the documentation`);
  }

  for (const { file, diagram } of input.canvasDiagrams) {
    const onDiagram = new Set(diagram.nodes.map((n) => n.ref));
    for (const id of duplicates(diagram.nodes.map((n) => n.ref))) error(file, `Element "${id}" appears twice`);
    for (const n of diagram.nodes) {
      if (!elements.has(n.ref)) error(file, `Node refers to deleted or unknown element "${n.ref}"`);
    }
    for (const e of diagram.edges) {
      const rel = relationships.get(e.ref);
      if (!rel) error(file, `Edge refers to deleted or unknown relationship "${e.ref}"`);
      else if (!onDiagram.has(rel.from) || !onDiagram.has(rel.to)) {
        warn(file, `Edge "${e.ref}" is hidden because "${!onDiagram.has(rel.from) ? rel.from : rel.to}" is not on the diagram`);
      }
    }
    const localIds = new Set(diagram.local.nodes.map((n) => n.id));
    for (const n of diagram.local.nodes) {
      // A local node can sit in another local node or in an element shown on the diagram (a note in a component).
      if (n.parent && !localIds.has(n.parent) && !onDiagram.has(n.parent)) error(file, `Local node "${n.id}" has unknown parent "${n.parent}"`);
    }
    for (const e of diagram.local.edges) {
      for (const end of [e.from, e.to]) {
        if (!localIds.has(end) && !onDiagram.has(end)) error(file, `Edge "${e.id}" refers to "${end}", which is not on the diagram`);
      }
    }
  }

  for (const { file, diagram } of input.sequenceDiagrams) {
    const lifelines = new Set(diagram.lifelines.map((l) => l.ref));
    for (const l of diagram.lifelines) {
      const element = elements.get(l.ref);
      if (!element) error(file, `Lifeline refers to deleted or unknown element "${l.ref}"`);
      else if (!LIFELINE_KINDS.has(element.kind)) {
        warn(file, `Lifeline "${l.ref}" is a ${element.kind}; expected an actor, component or externalSystem`);
      }
    }
    forEachMessage(diagram.steps, (msg) => {
      for (const end of [msg.from, msg.to]) {
        if (end && !lifelines.has(end)) error(file, `Message "${msg.label}" uses "${end}", which is not a lifeline`);
      }
    });
  }

  for (const { file, diagram } of input.timingDiagrams ?? []) {
    const lifelines = new Set(diagram.lifelines.map((l) => l.ref));
    for (const l of diagram.lifelines) {
      if (!elements.has(l.ref)) error(file, `Lifeline refers to deleted or unknown element "${l.ref}"`);
    }
    for (const m of diagram.messages) {
      for (const end of [m.from, m.to]) if (end && !lifelines.has(end)) error(file, `Message "${m.label}" uses "${end}", which is not a lifeline`);
    }
    for (const c of diagram.constraints) {
      if (!lifelines.has(c.on)) error(file, `Constraint "${c.label}" is on "${c.on}", which is not a lifeline`);
    }
    if (diagram.end !== undefined) {
      const late = [...diagram.lifelines.flatMap((l) => l.changes.map((c) => c.at)), ...diagram.messages.flatMap((m) => [m.at, m.arrive ?? m.at])].some((t) => t > diagram.end!);
      if (late) warn(file, `Some events are after the end of the time axis (${diagram.end})`);
    }
  }

  if (input.qualityRequirements) {
    const goals = new Set(input.qualityGoals?.goals.map((g) => g.id) ?? []);
    for (const s of input.qualityRequirements.scenarios) {
      for (const g of s.goals) {
        if (!goals.has(g)) error('data/quality-requirements.yaml', `Scenario "${s.id}" refers to unknown quality goal "${g}"`);
      }
    }
  }

  if (input.requirements) {
    const file = 'data/requirements.yaml';
    const list = input.requirements.requirements;
    const byId = new Map(list.map((r) => [r.id, r]));
    const goals = new Set(input.qualityGoals?.goals.map((g) => g.id) ?? []);
    for (const id of duplicates(list.map((r) => r.id))) error(file, `Duplicate requirement id "${id}"`);
    for (const r of list) {
      if (r.parent && !byId.has(r.parent)) error(file, `Requirement "${r.id}" is under unknown requirement "${r.parent}"`);
      else if (r.parent) {
        const seen = new Set([r.id]);
        for (let p: string | undefined = r.parent; p; p = byId.get(p)?.parent) {
          if (seen.has(p)) {
            error(file, `Requirement "${r.id}" is (indirectly) under itself`);
            break;
          }
          seen.add(p);
        }
      }
      for (const e of r.satisfiedBy) if (!elements.has(e)) error(file, `Requirement "${r.id}" is satisfied by unknown element "${e}"`);
      for (const g of r.goals) if (!goals.has(g)) error(file, `Requirement "${r.id}" refers to unknown quality goal "${g}"`);
    }
  }

  return issues;
}
