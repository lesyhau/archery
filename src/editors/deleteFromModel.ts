import * as vscode from 'vscode';

/** Asks for confirmation, then deletes elements/relationships from the model everywhere. */
export async function deleteFromModel(refs: string[], runOp: (name: string, input: Record<string, unknown>) => Promise<unknown>): Promise<void> {
  if (refs.length === 0) return;
  const ok = await vscode.window.showWarningMessage(
    `Delete ${refs.length === 1 ? `"${refs[0]}"` : `${refs.length} items`} from the model?`,
    {
      modal: true,
      detail: 'The element(s) are removed from the model and from every diagram that shows them, together with their relationships. Use "Remove from diagram" (Delete key) to hide them on this diagram only.',
    },
    'Delete from model',
  );
  if (ok !== 'Delete from model') return;
  for (const ref of refs) {
    try {
      // Relationships first (deleting an element cascades to its relationships anyway).
      await runOp('delete_relationship', { id: ref });
    } catch {
      try {
        await runOp('delete_element', { id: ref, cascade: true });
      } catch (e) {
        void vscode.window.showErrorMessage(`Archery: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}
