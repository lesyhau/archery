// The scene of a diagram loaded for the document (canvas, sequence / communication, timing).
import type { DocDiagram } from '../doc/protocol';
import type { Model } from '../model/schema';
import { layoutCanvas } from './canvasLayout';
import { layoutInteraction } from './communicationLayout';
import type { DiagramStyle, Scene } from './scene';
import { layoutSequence } from './sequenceLayout';
import { layoutTiming } from './timingLayout';

/** `src`: the diagram's path (elements detailed on it get no drill-down link to themselves). */
export function docDiagramScene(entry: Exclude<DocDiagram, { kind: 'missing' }>, model: Model, ds: DiagramStyle = 'classic', src?: string): Scene {
  switch (entry.kind) {
    case 'canvas':
      return layoutCanvas(entry.diagram, model, ds, src);
    case 'sequence':
      return layoutInteraction(entry.diagram, model, layoutSequence, ds);
    case 'timing':
      return layoutTiming(entry.diagram, model, ds);
  }
}

/** The custom editor of a diagram file. */
export function editorViewType(file: string): string {
  if (file.endsWith('.seq.json')) return 'archery.sequenceEditor';
  if (file.endsWith('.timing.json')) return 'archery.timingEditor';
  return 'archery.diagramEditor';
}
