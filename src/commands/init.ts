// "Archery: Initialize documentation" — scaffolds docs/architecture in a workspace folder, or another
// documentation in a folder of its own when the workspace has one.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { scaffold } from '../template/scaffold';

export const DEFAULT_DOCS_DIR = 'docs/architecture';

const exists = async (uri: vscode.Uri) => {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
};

/** @param existing the documentations the workspace has (a new one goes in a folder of its own). */
export async function initCommand(existing: vscode.Uri[] = []): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage('Archery: open a folder first.');
    return undefined;
  }
  const folder =
    folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Workspace folder' });
  if (!folder) return undefined;

  let dir = DEFAULT_DOCS_DIR;
  let root = vscode.Uri.joinPath(folder.uri, ...dir.split('/'));
  if (existing.length || (await exists(vscode.Uri.joinPath(root, 'archery.yaml')))) {
    const chosen = await vscode.window.showInputBox({
      title: 'Archery: New documentation',
      prompt: 'Folder for the new documentation',
      placeHolder: 'services/billing/docs/architecture',
      validateInput: async (v) => {
        const rel = clean(v);
        if (!rel) return 'Enter a folder.';
        if (rel.split('/').includes('..')) return 'Choose a folder inside the workspace.';
        if (await exists(vscode.Uri.joinPath(folder.uri, ...rel.split('/'), 'archery.yaml'))) return 'This folder already has documentation.';
        return undefined;
      },
    });
    if (chosen === undefined) return undefined;
    dir = clean(chosen);
    root = vscode.Uri.joinPath(folder.uri, ...dir.split('/'));
  }

  // The system's name: the folder the documentation is for ("billing" for services/billing/docs/architecture).
  const named = dir.split('/').filter((p) => p !== 'docs' && p !== 'architecture').at(-1);
  const system = await vscode.window.showInputBox({
    title: 'Archery: Initialize documentation',
    prompt: 'Name of the system being documented',
    value: named ?? path.basename(folder.uri.fsPath),
    validateInput: (v) => (v.trim() ? undefined : 'Please enter a name'),
  });
  if (system === undefined) return undefined;

  const help = await vscode.window.showQuickPick(
    [
      { label: 'With help', description: 'arc42 help texts (recommended)', includeHelp: true },
      { label: 'Plain', description: 'headings only', includeHelp: false },
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

  void vscode.window.showInformationMessage(
    `Archery: created ${dir} in ${folder.name}${skipped ? ` (${skipped} existing files kept)` : ''}.`,
  );
  return root;
}

const clean = (v: string) =>
  v
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\/+|\/+$/g, '');
