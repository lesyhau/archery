// Which model elements and relationships each diagram shows: lets the editor answer "where is this
// element used?" (other diagrams, and the sequence diagrams / scenarios it takes part in).
import type { CanvasDiagramType } from './schema';
import { parseCanvasDiagram, parseSequenceDiagram, parseTimingDiagram } from './load';

export interface DiagramUsage {
  /** Path relative to the documentation root, e.g. `diagrams/checkout.seq.json`. */
  file: string;
  title: string;
  type: CanvasDiagramType | 'sequence' | 'communication' | 'timing';
  /** Element and relationship ids on the diagram (sequence: the lifelines). */
  refs: string[];
}

/** A readable name for a diagram without a title: its file name without folder or extension. */
export function diagramName(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.(uml|seq|timing)\.json$/, '').replace(/[-_]+/g, ' ').trim() || 'Diagram';
}

export function diagramUsage(file: string, text: string): DiagramUsage | undefined {
  if (file.endsWith('.seq.json')) {
    const d = parseSequenceDiagram(text, file).value;
    return d && { file, title: d.title || diagramName(file), type: d.notation === 'communication' ? 'communication' : 'sequence', refs: d.lifelines.map((l) => l.ref) };
  }
  if (file.endsWith('.timing.json')) {
    const d = parseTimingDiagram(text, file).value;
    return d && { file, title: d.title || diagramName(file), type: 'timing', refs: d.lifelines.map((l) => l.ref) };
  }
  if (file.endsWith('.uml.json')) {
    const d = parseCanvasDiagram(text, file).value;
    return d && { file, title: d.title || diagramName(file), type: d.type, refs: [...d.nodes.map((n) => n.ref), ...d.edges.map((e) => e.ref)] };
  }
  return undefined;
}
