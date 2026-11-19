// "Archery: Initialize documentation" — scaffolds docs/architecture in a workspace folder.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { scaffold } from '../template/scaffold';
import { SECTIONS } from '../template/template';

export const DEFAULT_DOCS_DIR = 'docs/architecture';

export async function initCommand(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage('Archery: open a folder first, then run "Archery: Initialize documentation".');
    return undefined;
  }
  const folder =
    folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Workspace folder for the architecture documentation' });
  if (!folder) return undefined;

  const root = vscode.Uri.joinPath(folder.uri, ...DEFAULT_DOCS_DIR.split('/'));
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'archery.yaml'));
    void vscode.window.showWarningMessage(`Archery: ${DEFAULT_DOCS_DIR}/archery.yaml already exists in ${folder.name}.`);
    return root;
  } catch {
    // not initialized yet: continue
  }

  const system = await vscode.window.showInputBox({
    title: 'Archery: Initialize documentation',
    prompt: 'Name of the system being documented',
    value: path.basename(folder.uri.fsPath),
    validateInput: (v) => (v.trim() ? undefined : 'Please enter a name'),
  });
  if (system === undefined) return undefined;

  const help = await vscode.window.showQuickPick(
    [
      { label: 'With help', description: 'Embed the arc42 help texts as hidden comments (recommended)', includeHelp: true },
      { label: 'Plain', description: 'Headings and placeholders only', includeHelp: false },
    ],
    { title: 'Archery: Initialize documentation', placeHolder: 'Template variant' },
  );
  if (!help) return undefined;

  const files = scaffold({ system, includeHelp: help.includeHelp });
  let skipped = 0;
  for (const [relPath, content] of files) {
    const target = vscode.Uri.joinPath(root, ...relPath.split('/'));
    try {
      await vscode.workspace.fs.stat(target);
      skipped++; // never overwrite existing files
      continue;
    } catch {
      // does not exist
    }
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
  }

  const first = SECTIONS[0];
  if (first) await vscode.window.showTextDocument(vscode.Uri.joinPath(root, 'sections', first.file));
  void vscode.window.showInformationMessage(
    `Archery: created ${DEFAULT_DOCS_DIR} in ${folder.name}${skipped ? ` (${skipped} existing files kept)` : ''}.`,
  );
  return root;
}
