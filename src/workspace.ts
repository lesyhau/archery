// VS Code-side helpers for locating and reading documentation workspaces.
import * as vscode from 'vscode';
import type { WorkspaceReader } from './model/load';

export const PROJECT_FILE = 'archery.yaml';

/** All documentation roots (folders containing archery.yaml) in the open workspace, shortest path first. */
export async function findArcheryRoots(): Promise<vscode.Uri[]> {
  const files = await vscode.workspace.findFiles(`**/${PROJECT_FILE}`, '**/node_modules/**', 20);
  return files
    .map((f) => vscode.Uri.joinPath(f, '..'))
    .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Walks up from a file inside an documentation workspace (e.g. diagrams/x.uml.json) to the folder containing archery.yaml. */
export async function findRootFor(file: vscode.Uri): Promise<vscode.Uri | undefined> {
  let dir = vscode.Uri.joinPath(file, '..');
  for (let i = 0; i < 8; i++) {
    if (await exists(vscode.Uri.joinPath(dir, PROJECT_FILE))) return dir;
    const parent = vscode.Uri.joinPath(dir, '..');
    if (parent.path === dir.path) break;
    dir = parent;
  }
  return undefined;
}

/** Reads text, preferring an open (possibly unsaved) editor buffer over the file on disk. */
export async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

export function createReader(root: vscode.Uri): WorkspaceReader {
  return {
    readText: (path) => readText(vscode.Uri.joinPath(root, path)),
    async list(dir) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, dir));
        return entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
      } catch {
        return [];
      }
    },
  };
}
