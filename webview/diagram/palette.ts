// What can be added to a canvas diagram, per diagram type.
import type { CanvasDiagramType, ElementKind, LocalNodeKind, RelationshipKind } from '../../src/model/schema';

export type PaletteItem =
  | { source: 'model'; kind: ElementKind; label: string; lollipop?: boolean }
  | { source: 'local'; kind: LocalNodeKind; label: string };

const m = (kind: ElementKind, label: string, extra: { lollipop?: boolean } = {}): PaletteItem => ({ source: 'model', kind, label, ...extra });
const l = (kind: LocalNodeKind, label: string): PaletteItem => ({ source: 'local', kind, label });
const NOTE = l('note', 'Note');

export const PALETTE: Record<CanvasDiagramType, PaletteItem[]> = {
  component: [
    m('component', 'Component'),
    m('interface', 'Interface'),
    m('interface', 'Interface (lollipop)', { lollipop: true }),
    m('port', 'Port'),
    m('package', 'Package'),
    m('actor', 'Actor'),
    m('externalSystem', 'External system'),
    m('artifact', 'Artifact'),
    NOTE,
  ],
  deployment: [
    m('node', 'Node'),
    m('executionEnvironment', 'Execution environment'),
    m('instance', 'Instance (e.g. :AppServer)'),
    m('artifact', 'Artifact'),
    m('component', 'Component'),
    m('externalSystem', 'External system'),
    m('actor', 'Actor'),
    NOTE,
  ],
  package: [m('package', 'Package'), m('component', 'Component'), m('class', 'Class'), m('interface', 'Interface'), NOTE],
  class: [
    m('class', 'Class'),
    m('interface', 'Interface'),
    m('enum', 'Enumeration'),
    m('datatype', 'Data type'),
    m('naryAssociation', 'N-ary association'),
    m('package', 'Package'),
    NOTE,
  ],
  context: [m('actor', 'Actor'), m('externalSystem', 'External system'), m('component', 'System / component'), m('usecase', 'Use case'), NOTE],
  state: [
    l('state', 'State'),
    l('initial', 'Initial'),
    l('final', 'Final'),
    l('choice', 'Choice'),
    l('junction', 'Junction'),
    l('fork', 'Fork'),
    l('join', 'Join'),
    l('history', 'History'),
    l('deepHistory', 'Deep history'),
    l('terminate', 'Terminate'),
    l('region', 'Region'),
    l('entryPoint', 'Entry point'),
    l('exitPoint', 'Exit point'),
    NOTE,
  ],
  object: [m('instance', 'Instance (object)'), m('class', 'Class'), NOTE],
  composite: [
    m('class', 'Structured class'),
    m('part', 'Part'),
    m('port', 'Port'),
    m('interface', 'Interface (lollipop)', { lollipop: true }),
    m('collaboration', 'Collaboration'),
    m('collaborationUse', 'Collaboration use'),
    NOTE,
  ],
  interactionOverview: [
    l('initial', 'Initial'),
    l('interactionUse', 'Interaction use (ref)'),
    l('interaction', 'Interaction (sd)'),
    l('decision', 'Decision'),
    l('merge', 'Merge'),
    l('fork', 'Fork'),
    l('join', 'Join'),
    l('activityFinal', 'Activity final'),
    l('flowFinal', 'Flow final'),
    NOTE,
  ],
  activity: [
    l('action', 'Action'),
    l('initial', 'Initial'),
    l('activityFinal', 'Activity final'),
    l('flowFinal', 'Flow final'),
    l('decision', 'Decision'),
    l('merge', 'Merge'),
    l('fork', 'Fork'),
    l('join', 'Join'),
    l('object', 'Object'),
    l('partition', 'Partition (swimlane)'),
    l('sendSignal', 'Send signal'),
    l('acceptEvent', 'Accept event'),
    l('acceptTimeEvent', 'Accept time event'),
    l('pin', 'Pin'),
    l('interruptibleRegion', 'Interruptible region'),
    NOTE,
  ],
};

/** Relationship kinds offered when connecting two model elements. */
export const RELATIONSHIPS: { kind: RelationshipKind; label: string; hint: string }[] = [
  { kind: 'dependency', label: 'Dependency', hint: 'dashed arrow' },
  { kind: 'usage', label: 'Usage / requires', hint: '«use»; socket on a lollipop' },
  { kind: 'association', label: 'Association', hint: 'solid line' },
  { kind: 'aggregation', label: 'Aggregation', hint: 'hollow diamond at the source' },
  { kind: 'composition', label: 'Composition', hint: 'filled diamond at the source' },
  { kind: 'generalization', label: 'Generalization', hint: 'inherits from the target' },
  { kind: 'realization', label: 'Realization / provides', hint: 'implements the target interface' },
  { kind: 'connector', label: 'Connector', hint: 'communication path, link' },
  { kind: 'deploy', label: 'Deployment', hint: 'artifact «deploy» node' },
  { kind: 'manifest', label: 'Manifestation', hint: 'artifact «manifest» component' },
  { kind: 'link', label: 'Link', hint: 'between instances (object diagrams)' },
];

/** Element kinds a model element may be changed into (same family). */
export const KIND_FAMILIES: ElementKind[][] = [
  ['component', 'externalSystem', 'actor', 'usecase', 'artifact', 'interface', 'package'],
  ['node', 'executionEnvironment'],
  ['class', 'interface', 'datatype', 'enum'],
  ['port'],
  ['naryAssociation'],
  ['instance'],
  ['part'],
  ['collaboration', 'collaborationUse'],
];

export const LOCAL_FAMILIES: LocalNodeKind[][] = [
  ['state', 'action', 'object', 'sendSignal', 'acceptEvent'],
  ['initial', 'final', 'activityFinal', 'flowFinal', 'terminate'],
  ['choice', 'decision', 'merge', 'junction'],
  ['fork', 'join'],
  ['history', 'deepHistory'],
  ['entryPoint', 'exitPoint'],
  ['region'],
  ['pin'],
  ['acceptTimeEvent'],
  ['partition', 'interruptibleRegion'],
  ['note'],
  ['interactionUse', 'interaction'],
];
