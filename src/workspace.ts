// VS Code-side helpers for locating and reading documentation workspaces.
import * as vscode from 'vscode';
import { parseProject, type WorkspaceReader } from './model/load';
import { pickDoc, type DocRef } from './ops/docs';

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

// --- several documentations ---------------------------------------------------------------

let activeRoot: vscode.Uri | undefined;

/** The documentation the window shows (set by the extension); agents work on it when they name none. */
export const activeDocRoot = (): vscode.Uri | undefined => activeRoot;
export function setActiveDocRoot(root: vscode.Uri | undefined): void {
  activeRoot = root;
}

/** The system name in a documentation's archery.yaml. */
export async function systemOf(root: vscode.Uri): Promise<string | undefined> {
  const text = await readText(vscode.Uri.joinPath(root, PROJECT_FILE));
  return text === undefined ? undefined : parseProject(text).value?.system;
}

export async function docRefs(roots: vscode.Uri[]): Promise<(DocRef & { root: vscode.Uri })[]> {
  return Promise.all(roots.map(async (root) => ({ root, path: vscode.workspace.asRelativePath(root, false), system: await systemOf(root) })));
}

/**
 * The documentation an agent's call works on: the one `doc` names (folder or system name), else the
 * one the window shows, else the first. A string is an error for the agent.
 */
export async function resolveDoc(doc: string | undefined): Promise<{ root?: vscode.Uri; error?: string; docs: (DocRef & { root: vscode.Uri })[] }> {
  const docs = await docRefs(await findArcheryRoots());
  if (doc?.trim()) {
    const picked = pickDoc(docs, doc);
    return typeof picked === 'string' ? { error: picked, docs } : { root: picked.root, docs };
  }
  const active = activeRoot && docs.find((d) => d.root.toString() === activeRoot!.toString());
  return { root: (active ?? docs[0])?.root, docs };
}
