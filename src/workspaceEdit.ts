import * as vscode from 'vscode';

/** Files Archery wrote recently: the live view does not follow them as outside changes. */
const ownWrites = new Map<string, number>();
export function isOwnWrite(uri: vscode.Uri): boolean {
  return (ownWrites.get(uri.toString()) ?? 0) > Date.now() - 4000;
}

/**
 * Writes files (path relative to `root` -> new content) as one undoable WorkspaceEdit,
 * then saves the documents that were not dirty before, so the result lands on disk.
 */
export async function applyChanges(root: vscode.Uri, changes: Map<string, string>): Promise<void> {
  if (changes.size === 0) return;
  const edit = new vscode.WorkspaceEdit();
  const toSave: vscode.Uri[] = [];
  for (const [path, text] of changes) {
    const uri = vscode.Uri.joinPath(root, ...path.split('/'));
    ownWrites.set(uri.toString(), Date.now());
    let doc: vscode.TextDocument | undefined;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      doc = undefined; // new file
    }
    if (doc) {
      if (doc.getText() === text) continue;
      if (!doc.isDirty) toSave.push(uri);
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    } else {
      edit.createFile(uri, { ignoreIfExists: true });
      edit.insert(uri, new vscode.Position(0, 0), text);
      toSave.push(uri);
    }
  }
  if (edit.size === 0) return;
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error('VS Code rejected the edit.');
  for (const uri of toSave) {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    await doc?.save();
  }
}
