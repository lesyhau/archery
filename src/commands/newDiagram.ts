// "Archery: New Diagram" - creates an empty diagram file and opens it in its editor.
import * as vscode from 'vscode';
import type { DiagramKind } from '../doc/protocol';
import { WebviewDiagramEditorProvider } from '../editors/webviewEditor';
import { ArcherySession, OpError } from '../ops/session';
import { TOOLS } from '../ops/tools';
import { createReader } from '../workspace';
import { applyChanges } from '../workspaceEdit';

const KINDS: { label: string; type: DiagramKind; detail: string }[] = [
  { label: 'Component', type: 'component', detail: 'Building block view (section 5)' },
  { label: 'Deployment', type: 'deployment', detail: 'Deployment view (section 7)' },
  { label: 'Sequence', type: 'sequence', detail: 'Runtime scenario (section 6)' },
  { label: 'Communication', type: 'communication', detail: 'Runtime scenario as participants and numbered messages (section 6)' },
  { label: 'Timing', type: 'timing', detail: 'State changes over time, deadlines and durations (sections 6, 10)' },
  { label: 'Context', type: 'context', detail: 'Context and scope (section 3)' },
  { label: 'Class', type: 'class', detail: 'Domain model (section 8)' },
  { label: 'State machine', type: 'state', detail: 'Cross-cutting concepts (section 8)' },
  { label: 'Activity', type: 'activity', detail: 'Runtime view (section 6)' },
  { label: 'Package', type: 'package', detail: 'Building block view (section 5)' },
  { label: 'Object', type: 'object', detail: 'Instances and links, e.g. an example configuration' },
  { label: 'Composite structure', type: 'composite', detail: 'Parts, ports and connectors inside a classifier; collaborations' },
  { label: 'Interaction overview', type: 'interactionOverview', detail: 'Flow between runtime scenarios (section 6)' },
];

/** The operation that creates an empty diagram of a kind. */
export function newDiagramInput(kind: DiagramKind, title: string): { tool: string; input: Record<string, unknown> } {
  if (kind === 'sequence' || kind === 'communication') return { tool: 'write_sequence_diagram', input: { title, steps: [], ...(kind === 'communication' ? { notation: 'communication' } : {}) } };
  if (kind === 'timing') return { tool: 'write_timing_diagram', input: { title, lifelines: [] } };
  return { tool: 'create_diagram', input: { title, type: kind } };
}

export async function newDiagramCommand(root: vscode.Uri | undefined): Promise<void> {
  if (!root) {
    void vscode.window.showWarningMessage('Archery: initialize the documentation first.');
    return;
  }
  const kind = await vscode.window.showQuickPick(KINDS, { title: 'Archery: New diagram' });
  if (!kind) return;
  const title = await vscode.window.showInputBox({ title: `Archery: New ${kind.label.toLowerCase()} diagram`, prompt: 'Title', validateInput: (v) => (v.trim() ? undefined : 'Please enter a title') });
  if (!title) return;
  try {
    const session = await ArcherySession.load(createReader(root), '');
    const { tool: toolName, input } = newDiagramInput(kind.type, title);
    const tool = TOOLS.find((t) => t.name === toolName)!;
    const result = (await tool.run(session, tool.input.parse(input))) as { file: string };
    await applyChanges(root, session.changes);
    const uri = vscode.Uri.joinPath(root, ...result.file.split('/'));
    await WebviewDiagramEditorProvider.openPanel(uri);
  } catch (e) {
    void vscode.window.showErrorMessage(`Archery: ${e instanceof OpError || e instanceof Error ? e.message : e}`);
  }
}
