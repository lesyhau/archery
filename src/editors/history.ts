// Undo / redo for the diagram tabs. They are Archery panels (titled with the diagram's name), not
// text editors, so VS Code's own undo does not reach them. Every operation is one step that may
// change several files (a diagram and model.yaml); undo writes the files back as they were.
import * as vscode from 'vscode';
import { readText } from '../workspace';
import { applyChanges } from '../workspaceEdit';
import { DELETED } from '../ops/session';

interface Step {
  /** File contents before and after (undefined: the file did not exist). */
  before: Map<string, string | undefined>;
  after: Map<string, string | undefined>;
}

const LIMIT = 200;
const stacks = new Map<string, { undo: Step[]; redo: Step[] }>();
const stackOf = (root: vscode.Uri) => {
  const key = root.toString();
  let s = stacks.get(key);
  if (!s) stacks.set(key, (s = { undo: [], redo: [] }));
  return s;
};

/** Applies an operation's changes and records them as one undoable step. */
export async function applyRecorded(root: vscode.Uri, changes: Map<string, string>): Promise<void> {
  if (changes.size === 0) return;
  const before = new Map<string, string | undefined>();
  for (const path of changes.keys()) before.set(path, await readText(vscode.Uri.joinPath(root, ...path.split('/'))));
  const after = new Map([...changes].map(([path, text]) => [path, text === DELETED ? undefined : text]));
  if ([...after].every(([path, text]) => before.get(path) === text)) return;
  await applyChanges(root, changes);
  const s = stackOf(root);
  s.undo.push({ before, after });
  if (s.undo.length > LIMIT) s.undo.shift();
  s.redo = [];
}

async function restore(root: vscode.Uri, files: Map<string, string | undefined>): Promise<void> {
  const write = new Map<string, string>();
  for (const [path, text] of files) {
    if (text !== undefined) write.set(path, text);
    else await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, ...path.split('/'))).then(undefined, () => undefined);
  }
  await applyChanges(root, write);
}

/** Undoes the last step in this documentation folder; false when there is nothing to undo. */
export async function undo(root: vscode.Uri): Promise<boolean> {
  const s = stackOf(root);
  const step = s.undo.pop();
  if (!step) return false;
  await restore(root, step.before);
  s.redo.push(step);
  return true;
}

export async function redo(root: vscode.Uri): Promise<boolean> {
  const s = stackOf(root);
  const step = s.redo.pop();
  if (!step) return false;
  await restore(root, step.after);
  s.undo.push(step);
  return true;
}
