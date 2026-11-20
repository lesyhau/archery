// Small line icons (16 x 16, currentColor) for the UML editor: element kinds, diagram-local
// nodes, relationships, diagram types, and the editor's view / layout actions.
import type { ReactNode } from 'react';
import type { CanvasDiagramType, ElementKind, LocalNodeKind, RelationshipKind } from '../../src/model/schema';

const icon = (children: ReactNode, label?: string) =>
  function Icon() {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden={label ? undefined : true} aria-label={label} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    );
  };
const fill = { fill: 'currentColor', stroke: 'none' } as const;

// --- model element kinds -------------------------------------------------------------------
export const IconActor = icon(<><circle cx="8" cy="3.3" r="1.8" /><path d="M8 5.1v5 M4.2 7h7.6 M8 10.1l-3 4.4 M8 10.1l3 4.4" /></>);
export const IconExternalSystem = icon(<><rect x="1.8" y="3.5" width="10" height="9" rx="1" strokeDasharray="2 1.4" /><path d="M9.5 6.5h5 M12.5 4.5l2 2-2 2" /></>);
export const IconUseCase = icon(<ellipse cx="8" cy="8" rx="6.4" ry="3.9" />);
export const IconComponent = icon(<><rect x="4" y="2.5" width="10" height="11" rx="0.8" /><rect x="2" y="5" width="4" height="2" rx="0.4" /><rect x="2" y="9" width="4" height="2" rx="0.4" /></>);
export const IconInterface = icon(<><circle cx="11" cy="8" r="3" /><path d="M1.8 8H8" /></>);
/** Interface drawn as a box («interface»). */
export const IconInterfaceBox = icon(<><rect x="2" y="4.5" width="9" height="9" rx="0.8" /><path d="M2 8h9" /><circle cx="12.8" cy="3.2" r="1.7" /></>);
export const IconPort = icon(<><rect x="5.5" y="2.5" width="8.5" height="11" rx="0.8" /><rect x="3" y="6.3" width="3.4" height="3.4" {...fill} /></>);
export const IconPackage = icon(<path d="M2 5.5V13.5h12V5.5H8L7 3.5H2.6a.6.6 0 0 0-.6.6V5.5h6" />);
export const IconNode = icon(<path d="M2 5.5h9.5v8H2z M2 5.5l2.5-2.5h9.5v8l-2.5 2.5 M11.5 5.5L14 3" />);
export const IconExecEnv = icon(<><path d="M2 5.5h9.5v8H2z M2 5.5l2.5-2.5h9.5v8l-2.5 2.5 M11.5 5.5L14 3" /><rect x="4" y="8" width="5.5" height="3.5" rx="0.6" /></>);
export const IconArtifact = icon(<path d="M3.5 1.8h6l3 3v9.4h-9z M9.5 1.8v3h3 M5.5 8.5h5 M5.5 11h5" />);
export const IconClass = icon(<><rect x="2" y="2.5" width="12" height="11" rx="0.8" /><path d="M2 6h12 M2 9.5h12 M4.5 4.3h7" /></>);
export const IconDataType = icon(<><rect x="2" y="2.5" width="12" height="11" rx="0.8" /><path d="M2 6.5h12 M6 9h4 M8 9v3" /></>);
export const IconEnum = icon(<><rect x="2" y="2.5" width="12" height="11" rx="0.8" /><path d="M2 6h12 M5 8.5h6 M5 11h6" /><circle cx="3.9" cy="8.5" r="0.4" {...fill} /></>);
export const IconNary = icon(<path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" />);

/** An instance: "name : Type" underlined, with a slot line. */
export const IconInstance = icon(<><rect x="1.8" y="3" width="12.4" height="10" rx="0.6" /><path d="M4.2 6.3h7.6 M1.8 8.7h12.4 M4.2 11h5" /></>);
/** A part inside a structured classifier. */
export const IconPart = icon(<><rect x="1.5" y="1.8" width="13" height="12.4" rx="0.8" /><rect x="4" y="6" width="8" height="5.5" rx="0.4" /><path d="M1.5 4.3h13" /></>);
export const IconCollaboration = icon(<ellipse cx="8" cy="8" rx="6.5" ry="4.6" strokeDasharray="1.8 1.4" />);
export const IconCollaborationUse = icon(<><ellipse cx="8" cy="8" rx="6.5" ry="4.6" strokeDasharray="1.8 1.4" /><path d="M5 8h6" /></>);

// --- diagram-local nodes ---------------------------------------------------------------------
export const IconState = icon(<><rect x="1.8" y="3.5" width="12.4" height="9" rx="3" /><path d="M1.8 7h12.4" /></>);
export const IconAction = icon(<rect x="1.8" y="4" width="12.4" height="8" rx="3.2" />);
export const IconInitial = icon(<circle cx="8" cy="8" r="4" {...fill} />);
export const IconFinal = icon(<><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="3" {...fill} /></>);
export const IconFlowFinal = icon(<><circle cx="8" cy="8" r="5.5" /><path d="M4.2 4.2l7.6 7.6 M11.8 4.2l-7.6 7.6" /></>);
export const IconChoice = icon(<path d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" />);
export const IconJunction = icon(<circle cx="8" cy="8" r="2.6" {...fill} />);
export const IconBar = icon(<rect x="7" y="2" width="2.2" height="12" rx="0.4" {...fill} />);
export const IconHistory = icon(<><circle cx="8" cy="8" r="5.5" /><path d="M6 5.3v5.4 M10 5.3v5.4 M6 8h4" /></>);
export const IconDeepHistory = icon(<><circle cx="8" cy="8" r="5.5" /><path d="M5.3 5.3v5.4 M8.7 5.3v5.4 M5.3 8h3.4 M11 4.8v2.4 M9.9 5.4l2.2 1.2 M12.1 5.4l-2.2 1.2" /></>);
export const IconTerminate = icon(<path d="M3.5 3.5l9 9 M12.5 3.5l-9 9" />);
export const IconObject = icon(<><rect x="2" y="4" width="12" height="8" rx="0.4" /><path d="M5 8.8h6" /></>);
export const IconPartition = icon(<path d="M2 2.5h12v11H2z M2 5.5h12 M8 2.5v11" />);
export const IconSendSignal = icon(<path d="M2 4h8.5l3.5 4-3.5 4H2z" />);
export const IconAcceptEvent = icon(<path d="M2 4h12v8H2l3.5-4z" />);
export const IconRegion = icon(<><rect x="1.5" y="2" width="13" height="12" rx="3" /><path d="M1.5 5h13" /><path d="M1.5 9.5h13" strokeDasharray="1.6 1.4" /></>);
export const IconEntryPoint = icon(<><rect x="1.5" y="3" width="9" height="10" rx="2.5" /><circle cx="10.5" cy="8" r="2.6" /></>);
export const IconExitPoint = icon(<><rect x="1.5" y="3" width="9" height="10" rx="2.5" /><circle cx="10.5" cy="8" r="2.6" /><path d="M8.9 6.4l3.2 3.2 M12.1 6.4l-3.2 3.2" /></>);
export const IconPin = icon(<><rect x="1.5" y="4" width="10" height="8" rx="2.5" /><rect x="10" y="6.5" width="3.5" height="3" fill="currentColor" stroke="none" /></>);
export const IconTimeEvent = icon(<path d="M4 2h8L4 14h8z" />);
export const IconInterruptible = icon(<rect x="1.5" y="2.5" width="13" height="11" rx="3" strokeDasharray="2 1.5" />);
export const IconInterrupt = icon(<path d="M2 14l4.5-5 2 2.5L14 2 M10.6 2.3L14 2l-.4 3.4" />);
export const IconInteractionUse = icon(<path d="M1.5 4h13v8h-13z M1.5 7h4l1.2-1.2V4 M6.5 9.8h5" />);
export const IconInteractionFrame = icon(<><path d="M1.5 2.5h13v11h-13z M1.5 5.5h4.5l1.2-1.2V2.5" /><path d="M5 9h6" strokeDasharray="1.4 1.2" /></>);
// Line shapes and menu marks.
export const IconLineStraight = icon(<path d="M2.5 13.5l11-11" />);
export const IconLineOrthogonal = icon(<path d="M2 13.5h5v-11h7" />);
export const IconLineCurved = icon(<path d="M2 13.5c7 0 5-11 12-11" />);
export const IconLineHorizontalFirst = icon(<path d="M2 3h11.5v10.5" />);
export const IconLineVerticalFirst = icon(<path d="M2.5 2.5v11H14" />);
export const IconCheck = icon(<path d="M3 8.5l3.2 3.2L13 4.8" />);
export const IconReverse = icon(<path d="M2.5 5.5h10 M10 3l2.5 2.5L10 8 M13.5 10.5h-10 M6 8l-2.5 2.5L6 13" />);
export const IconNote = icon(<path d="M2.5 2.5h7.5l3.5 3.5v7.5h-11z M10 2.5V6h3.5" />);

// --- relationships ---------------------------------------------------------------------------
const line = 'M2 13.5L13.5 2';
export const IconDependency = icon(<path d="M2 14l10.5-10.5 M8.5 3.3h4.2v4.2" strokeDasharray="1.8 1.6" />);
export const IconUsage = icon(<><path d="M2 14L8.2 7.8" strokeDasharray="1.8 1.6" /><path d="M8.6 5.2a3.2 3.2 0 0 1 2.2 4.6" /><circle cx="12" cy="4" r="2" /></>);
export const IconAssociation = icon(<path d={line} />);
export const IconAggregation = icon(<path d="M2 14L9 7 M9 7l.1-3.4L12.5 3l-.1 3.4z" />);
export const IconComposition = icon(<><path d="M2 14L9 7" /><path d="M9 7l.1-3.4L12.5 3l-.1 3.4z" fill="currentColor" /></>);
export const IconGeneralization = icon(<path d="M2 14l7.3-7.3 M7.6 4.9l5.9-2.4-2.4 5.9z" />);
export const IconRealization = icon(<><path d="M2 14l7.3-7.3" strokeDasharray="1.8 1.6" /><path d="M7.6 4.9l5.9-2.4-2.4 5.9z" /></>);
export const IconConnector = icon(<><path d="M3.5 12.5l9-9" /><circle cx="3" cy="13" r="1.4" {...fill} /><circle cx="13" cy="3" r="1.4" {...fill} /></>);
export const IconDeploy = icon(<><path d="M2.2 13.8l6-6" strokeDasharray="1.8 1.6" /><path d="M8.5 3.5h5.5v5.5H8.5z M8.5 3.5l1.3-1.3h5.4v5.4L14 9" /></>);
export const IconLinkRel = icon(<><path d="M2 14L14 2" /><path d="M3.5 9.5l3 3" /></>);
export const IconManifest = icon(<><path d="M2 14l10.5-10.5 M8.5 3.3h4.2v4.2" strokeDasharray="1.8 1.6" /><path d="M2.2 6.5h3.5" /></>);
export const IconTransition = icon(<><path d="M2 12c3-7 8-8 11.5-8.5 M10.5 1.8l3 1.7-2 2.7" /></>);
export const IconAnchor = icon(<path d="M2 14L14 2" strokeDasharray="1 1.6" />);

// --- diagram types ---------------------------------------------------------------------------
export const IconTypeSequence = icon(<><rect x="1.5" y="1.8" width="5" height="3" rx="0.5" /><rect x="9.5" y="1.8" width="5" height="3" rx="0.5" /><path d="M4 4.8v9.4 M12 4.8v9.4" strokeDasharray="1.4 1.2" /><path d="M4 8.5h7 M9.4 7.1L11 8.5 9.4 9.9" /></>);
export const IconTypeContext = icon(<><circle cx="4" cy="4.5" r="1.4" /><path d="M4 6v3.2 M2.4 7.4h3.2 M4 9.2l-1.6 2.3 M4 9.2l1.6 2.3" /><rect x="8" y="5" width="6.5" height="6" rx="0.8" /></>);
export const IconTypeState = icon(<><rect x="1.5" y="2" width="6" height="4.5" rx="1.6" /><rect x="8.5" y="9.5" width="6" height="4.5" rx="1.6" /><path d="M7.5 4.3c3 0 4 1.5 4 5 M10.3 8.2l1.2 1.4 1.2-1.4" /></>);
export const IconTypeObject = icon(<><rect x="1.5" y="2" width="6" height="4.5" rx="0.4" /><rect x="8.5" y="9.5" width="6" height="4.5" rx="0.4" /><path d="M3 4.3h3 M10 11.8h3 M4.5 6.5v5h4" /></>);
export const IconTypeComposite = icon(<><rect x="1.5" y="1.8" width="13" height="12.4" rx="0.8" /><rect x="3.5" y="6" width="4" height="3.5" rx="0.3" /><rect x="9" y="9" width="4" height="3.5" rx="0.3" /><path d="M7.5 7.7h1.5v1.3" /><path d="M1.5 4.3h13" /></>);
export const IconTypeOverview = icon(<><circle cx="8" cy="2.5" r="1.3" fill="currentColor" stroke="none" /><path d="M8 3.8v1.7 M2 5.5h12v3.5H2z M2 7.2h2.5l.7-.7V5.5 M8 9v1.5 M8 10.5l2.2 2.2L8 14.9l-2.2-2.2z" /></>);
export const IconTypeTiming = icon(<path d="M1.5 13.5h13 M1.5 2.5v11 M3 10.5h3V5h4v5.5h4.5" />);
export const IconStateChange = icon(<><path d="M2 11.5h5V4.5h7" /><circle cx="7" cy="8" r="1.5" fill="currentColor" stroke="none" /></>);
export const IconTimingMessage = icon(<path d="M3 3.5l9 9 M7.8 12.5H12V8.3" />);
export const IconDuration = icon(<path d="M2.5 3.5v9 M13.5 3.5v9 M2.5 8h11 M5 5.8L2.7 8 5 10.2 M11 5.8L13.3 8 11 10.2" />);
export const IconTimeMark = icon(<><circle cx="8" cy="8" r="5.8" /><path d="M8 4.6V8l2.3 1.7" /></>);
export const IconValueForm = icon(<path d="M1.5 8l2-3h4l2 3-2 3h-4z M9.5 8l2-3h3 M9.5 8l2 3h3" />);
export const IconTypeActivity = icon(<><rect x="1.5" y="2" width="7" height="3.6" rx="1.5" /><path d="M5 5.6v2 M5 7.6l2.5 2.5L5 12.6 2.5 10.1z M7.5 10.1h3 M10.5 8.5h4v3.2h-4z" /></>);

export const ELEMENT_ICONS: Record<ElementKind, () => JSX.Element> = {
  actor: IconActor,
  externalSystem: IconExternalSystem,
  usecase: IconUseCase,
  component: IconComponent,
  interface: IconInterface,
  port: IconPort,
  package: IconPackage,
  node: IconNode,
  executionEnvironment: IconExecEnv,
  artifact: IconArtifact,
  class: IconClass,
  datatype: IconDataType,
  enum: IconEnum,
  naryAssociation: IconNary,
  instance: IconInstance,
  part: IconPart,
  collaboration: IconCollaboration,
  collaborationUse: IconCollaborationUse,
};

export const LOCAL_ICONS: Record<LocalNodeKind, () => JSX.Element> = {
  state: IconState,
  action: IconAction,
  initial: IconInitial,
  final: IconFinal,
  activityFinal: IconFinal,
  flowFinal: IconFlowFinal,
  choice: IconChoice,
  decision: IconChoice,
  merge: IconChoice,
  junction: IconJunction,
  fork: IconBar,
  join: IconBar,
  history: IconHistory,
  deepHistory: IconDeepHistory,
  terminate: IconTerminate,
  object: IconObject,
  partition: IconPartition,
  sendSignal: IconSendSignal,
  acceptEvent: IconAcceptEvent,
  note: IconNote,
  interactionUse: IconInteractionUse,
  interaction: IconInteractionFrame,
  region: IconRegion,
  entryPoint: IconEntryPoint,
  exitPoint: IconExitPoint,
  pin: IconPin,
  acceptTimeEvent: IconTimeEvent,
  interruptibleRegion: IconInterruptible,
};

export const RELATIONSHIP_ICONS: Record<RelationshipKind, () => JSX.Element> = {
  dependency: IconDependency,
  usage: IconUsage,
  association: IconAssociation,
  aggregation: IconAggregation,
  composition: IconComposition,
  generalization: IconGeneralization,
  realization: IconRealization,
  connector: IconConnector,
  deploy: IconDeploy,
  link: IconLinkRel,
  manifest: IconManifest,
};

export const IconTypeCommunication = icon(<><rect x="1.5" y="2" width="5" height="3.4" rx="0.5" /><rect x="9.5" y="10.6" width="5" height="3.4" rx="0.5" /><path d="M5 5.4L11 10.6 M9 4.5h3.5 M11 3l1.5 1.5L11 6" /></>);

export const TYPE_ICONS: Record<CanvasDiagramType | 'sequence' | 'communication' | 'timing', () => JSX.Element> = {
  component: IconComponent,
  deployment: IconNode,
  package: IconPackage,
  class: IconClass,
  context: IconTypeContext,
  state: IconTypeState,
  activity: IconTypeActivity,
  object: IconTypeObject,
  composite: IconTypeComposite,
  interactionOverview: IconTypeOverview,
  sequence: IconTypeSequence,
  communication: IconTypeCommunication,
  timing: IconTypeTiming,
};

export const TYPE_LABELS: Record<CanvasDiagramType | 'sequence' | 'communication' | 'timing', string> = {
  component: 'Component diagram',
  deployment: 'Deployment diagram',
  package: 'Package diagram',
  class: 'Class diagram',
  context: 'Context / use case diagram',
  state: 'State machine diagram',
  activity: 'Activity diagram',
  object: 'Object diagram',
  composite: 'Composite structure diagram',
  interactionOverview: 'Interaction overview diagram',
  sequence: 'Sequence diagram',
  communication: 'Communication diagram',
  timing: 'Timing diagram',
};

// --- editor actions --------------------------------------------------------------------------
export const IconZoomIn = icon(<path d="M8 3v10 M3 8h10" />);
export const IconZoomOut = icon(<path d="M3 8h10" />);
export const IconFit = icon(<path d="M2.5 6V2.5H6 M10 2.5h3.5V6 M13.5 10v3.5H10 M6 13.5H2.5V10" />);
export const IconFill = icon(<path d="M8 1.5v13 M1.5 8h13 M6 3.5l2-2 2 2 M6 12.5l2 2 2-2 M3.5 6l-2 2 2 2 M12.5 6l2 2-2 2" />);
export const IconActualSize = icon(<path d="M3.5 5l1.5-1.2V12 M10.5 5L12 3.8V12 M8 6.8v.01 M8 9.8v.01" />);
export const IconCenter = icon(<><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2.5 M8 12v2.5 M1.5 8H4 M12 8h2.5" /></>);
export const IconGrid = icon(<path d="M2.5 2.5h11v11h-11z M6.2 2.5v11 M9.8 2.5v11 M2.5 6.2h11 M2.5 9.8h11" />);
export const IconSnap = icon(<><path d="M2.5 2.5v11h11" strokeDasharray="1.2 1.4" /><path d="M5.5 10.5V7.5a2.5 2.5 0 0 1 5 0v3 M5.5 10.5h1.6 M8.9 10.5h1.6" /></>);
export const IconMinimap = icon(<><rect x="1.8" y="2.5" width="12.4" height="11" rx="1" /><rect x="8" y="8" width="4.5" height="3.8" rx="0.5" /></>);
export const IconLayoutDown = icon(<><rect x="5.5" y="1.5" width="5" height="3" rx="0.5" /><rect x="1.5" y="11.5" width="5" height="3" rx="0.5" /><rect x="9.5" y="11.5" width="5" height="3" rx="0.5" /><path d="M8 4.5v3.5 M4 11.5V8h8v3.5" /></>);
export const IconLayoutRight = icon(<><rect x="1.5" y="5.5" width="3" height="5" rx="0.5" /><rect x="11.5" y="1.5" width="3" height="5" rx="0.5" /><rect x="11.5" y="9.5" width="3" height="5" rx="0.5" /><path d="M4.5 8H8 M11.5 4H8v8h3.5" /></>);
export const IconExportSvg = icon(<><path d="M3.5 1.8h6l3 3v9.4h-9z M9.5 1.8v3h3" /><path d="M5.6 11.5l1.4-4 1.4 4 1.4-4" /></>);
export const IconExportPng = icon(<><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.2" /><circle cx="5.5" cy="6.2" r="1.2" /><path d="M2 12l4-3.5 3 2.5 2-1.5 3 2.5" /></>);
export const IconExisting = icon(<><ellipse cx="8" cy="3.8" rx="5.5" ry="1.8" /><path d="M2.5 3.8v8.4c0 1 2.5 1.8 5.5 1.8s5.5-.8 5.5-1.8V3.8 M2.5 8c0 1 2.5 1.8 5.5 1.8s5.5-.8 5.5-1.8" /></>);
export const IconSelectTool = icon(<path d="M3.5 2.5l9 5-4 1.2 2.4 4.3-1.6.9-2.4-4.3L4 12.4z" />);
export const IconTrash = icon(<path d="M2.8 4.2h10.4 M6.2 4.2V2.7h3.6v1.5 M4 4.2l.7 9.3h6.6l.7-9.3 M6.6 6.6v4.6 M9.4 6.6v4.6" />);
export const IconRemove = icon(<path d="M4 4l8 8 M12 4l-8 8" />);
export const IconRename = icon(<path d="M10.5 2.5l3 3L6 13H3v-3z M9 4l3 3" />);
export const IconOpen = icon(<path d="M9 2.5h4.5V7 M13.5 2.5L7.5 8.5 M11.5 9.5v4h-9v-9h4" />);
export const IconPlus = icon(<path d="M8 3.5v9 M3.5 8h9" />);

export const IconAlignLeft = icon(<path d="M2 1.5v13 M4 4h8v3H4z M4 9h5v3H4z" />);
export const IconAlignCenterH = icon(<path d="M8 1.5v13 M3.5 4h9v3h-9z M5 9h6v3H5z" />);
export const IconAlignRight = icon(<path d="M14 1.5v13 M4 4h8v3H4z M7 9h5v3H7z" />);
export const IconAlignTop = icon(<path d="M1.5 2h13 M4 4v8h3V4z M9 4v5h3V4z" />);
export const IconAlignMiddle = icon(<path d="M1.5 8h13 M4 3.5v9h3v-9z M9 5v6h3V5z" />);
export const IconAlignBottom = icon(<path d="M1.5 14h13 M4 4v8h3V4z M9 7v5h3V7z" />);
export const IconDistributeH = icon(<path d="M2 2v12 M14 2v12 M5.5 5h1.8v6H5.5z M8.7 5h1.8v6H8.7z" />);
export const IconDistributeV = icon(<path d="M2 2h12 M2 14h12 M5 5.5v1.8h6V5.5z M5 8.7v1.8h6V8.7z" />);

// --- sequence diagrams -------------------------------------------------------------------------
export const IconMsgSync = icon(<><path d="M1.5 8h10" /><path d="M11.5 5.2L14.5 8l-3 2.8z" fill="currentColor" /></>);
export const IconMsgAsync = icon(<path d="M1.5 8h12.5 M11 5l3 3-3 3" />);
export const IconMsgReply = icon(<><path d="M14.5 8H3" strokeDasharray="1.8 1.5" /><path d="M5.5 5L2.5 8l3 3" /></>);
export const IconMsgCreate = icon(<><path d="M1 8h6.5" strokeDasharray="1.8 1.5" /><path d="M6 5.5L8.5 8 6 10.5 M9.5 4.5h5v7h-5z" /></>);
export const IconMsgDestroy = icon(<><path d="M1.5 8h7.5" /><path d="M8 5.6L10.5 8 8 10.4z" fill="currentColor" /><path d="M11.5 5l3.5 6 M15 5l-3.5 6" /></>);
export const IconMsgSelf = icon(<><path d="M4 1.5v13 M4.5 4.5h7.5v5.5H6.5" /><path d="M7.5 7.7L5 10l2.5 2.3z" fill="currentColor" /></>);
export const IconMsgLost = icon(<><path d="M1.5 8h8.5" /><path d="M9.5 5.5L12 8l-2.5 2.5z" fill="currentColor" /><circle cx="14" cy="8" r="1.5" fill="currentColor" stroke="none" /></>);
export const IconMsgFound = icon(<><circle cx="2" cy="8" r="1.5" fill="currentColor" stroke="none" /><path d="M4 8h8" /><path d="M11.5 5.5L14 8l-2.5 2.5z" fill="currentColor" /></>);
export const IconFragment = icon(<path d="M1.5 3h13v10h-13z M1.5 6.5h5l1.5-1.5V3" />);
export const IconRef = icon(<path d="M1.5 4h13v8h-13z M1.5 7h4l1.2-1.2V4 M6.5 9.8h5" />);
export const IconConstraint = icon(<path d="M6 3c-1.5 0-2 .7-2 2v1.3c0 .8-.6 1.4-1.5 1.7.9.3 1.5.9 1.5 1.7V11c0 1.3.5 2 2 2 M10 3c1.5 0 2 .7 2 2v1.3c0 .8.6 1.4 1.5 1.7-.9.3-1.5.9-1.5 1.7V11c0 1.3-.5 2-2 2" />);
export const IconLifeline = icon(<><rect x="3.5" y="1.5" width="9" height="4" rx="0.6" /><path d="M8 5.5v9" strokeDasharray="1.6 1.4" /></>);
export const IconWrap = icon(<><path d="M1.5 2.5h13v11h-13z M1.5 5.5h4l1.2-1.2V2.5" /><path d="M4.5 9h7 M9.5 7.3L11.5 9l-2 1.7" /></>);
export const IconUnwrap = icon(<><path d="M1.5 2.5h13v11h-13z" strokeDasharray="1.6 1.4" /><path d="M4.5 8h7 M9.5 6.3L11.5 8l-2 1.7" /></>);
export const IconUp = icon(<path d="M8 13V3 M4 7l4-4 4 4" />);
export const IconDown = icon(<path d="M8 3v10 M4 9l4 4 4-4" />);
export const IconLeft = icon(<path d="M13 8H3 M7 4L3 8l4 4" />);
export const IconRight = icon(<path d="M3 8h10 M9 4l4 4-4 4" />);

export const MESSAGE_ICONS: Record<'sync' | 'async' | 'reply' | 'create' | 'destroy' | 'self' | 'lost' | 'found', () => JSX.Element> = {
  sync: IconMsgSync,
  async: IconMsgAsync,
  reply: IconMsgReply,
  create: IconMsgCreate,
  destroy: IconMsgDestroy,
  self: IconMsgSelf,
  lost: IconMsgLost,
  found: IconMsgFound,
};
