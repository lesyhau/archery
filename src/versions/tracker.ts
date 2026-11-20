// Tracks changes to the documentation folder as versions (see history.ts for the rules) and
// implements release and rollback on top of VS Code's file system API.
import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import * as vscode from 'vscode';
import {
  canRelease,
  HISTORY_FILE,
  isSnapshotText,
  isVersioned,
  parseHistory,
  planRollback,
  recordEdit,
  recordRelease,
  serializeHistory,
  snapshotPath,
  SnapshotSchema,
  sortSnapshots,
  VERSIONS_DIR,
  type History,
  type Snapshot,
} from './history';

const DEBOUNCE_MS = 1500;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface SnapshotInfo {
  version: string;
  kind: Snapshot['kind'];
  date: string;
  note?: string;
}

export class VersionTracker implements vscode.Disposable {
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** While > 0, file events are our own writes (release/rollback) and are not recorded. */
  private busy = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly changed = new vscode.EventEmitter<History>();
  readonly onDidChange = this.changed.event;

  constructor(readonly root: vscode.Uri) {}

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.changed.dispose();
  }

  relative(uri: vscode.Uri): string | undefined {
    const base = this.root.path.endsWith('/') ? this.root.path : `${this.root.path}/`;
    return uri.path.startsWith(base) ? uri.path.slice(base.length) : undefined;
  }

  /** Called for every created/changed/deleted file under the root. */
  notice(uri: vscode.Uri): void {
    const path = this.relative(uri);
    if (!path || !isVersioned(path) || this.busy > 0) return;
    this.pending.add(path);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Records pending changes as one new minor version. */
  flush(): Promise<void> {
    return this.serialize(async () => {
      if (this.pending.size === 0) return;
      const files = [...this.pending];
      this.pending.clear();
      const history = recordEdit(await this.history(), files, new Date().toISOString());
      await this.writeHistory(history);
    });
  }

  async history(): Promise<History> {
    return parseHistory(await this.read(HISTORY_FILE));
  }

  async canRelease(): Promise<boolean> {
    return canRelease(await this.history());
  }

  async release(note: string, author?: string): Promise<string> {
    await this.flush();
    return this.serialize(() =>
      this.quietly(async () => {
        const { history, snapshot } = recordRelease(await this.history(), await this.readAll(), new Date().toISOString(), note, author);
        await this.write(snapshotPath(snapshot.version), JSON.stringify(snapshot, null, 1) + '\n');
        await this.writeHistory(history);
        return snapshot.version;
      }),
    );
  }

  async snapshots(): Promise<SnapshotInfo[]> {
    let entries: [string, vscode.FileType][] = [];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(this.root, VERSIONS_DIR));
    } catch {
      return [];
    }
    const infos: SnapshotInfo[] = [];
    for (const [name] of entries) {
      if (!/^v\d+\.\d+\.json$/.test(name)) continue;
      const parsed = SnapshotSchema.safeParse(JSON.parse((await this.read(`${VERSIONS_DIR}/${name}`)) ?? 'null'));
      if (parsed.success) infos.push({ version: parsed.data.version, kind: parsed.data.kind, date: parsed.data.date, note: parsed.data.note });
    }
    return sortSnapshots(infos);
  }

  /** Restores a snapshot; returns the new current version. */
  async rollback(version: string): Promise<string> {
    await this.flush();
    return this.serialize(() =>
      this.quietly(async () => {
        const snapshot = SnapshotSchema.parse(JSON.parse((await this.read(snapshotPath(version))) ?? 'null'));
        const plan = planRollback(await this.history(), await this.readAll(), snapshot, new Date().toISOString());
        // The backup must not overwrite a release snapshot with the same number.
        const backupPath = snapshotPath(plan.backup.version);
        if ((await this.read(backupPath)) === undefined) {
          await this.write(backupPath, JSON.stringify(plan.backup, null, 1) + '\n');
        }
        for (const [path, text] of plan.write) await this.write(path, text);
        for (const path of plan.remove) {
          await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.root, ...path.split('/')), { useTrash: true });
        }
        await this.writeHistory(plan.history);
        return plan.history.current;
      }),
    );
  }

  // --- helpers ---------------------------------------------------------------

  /** Runs operations one at a time, so concurrent saves cannot lose a version. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Our own writes must not be recorded as edits; file events arrive with a delay. */
  private async quietly<T>(fn: () => Promise<T>): Promise<T> {
    this.busy++;
    try {
      return await fn();
    } finally {
      setTimeout(() => this.busy--, DEBOUNCE_MS + 500);
    }
  }

  private async writeHistory(history: History): Promise<void> {
    await this.write(HISTORY_FILE, serializeHistory(history));
    this.changed.fire(history);
  }

  private async read(path: string): Promise<string | undefined> {
    const uri = vscode.Uri.joinPath(this.root, ...path.split('/'));
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    try {
      return decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return undefined;
    }
  }

  private async write(path: string, text: string): Promise<void> {
    const uri = vscode.Uri.joinPath(this.root, ...path.split('/'));
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open && !open.isClosed && path !== HISTORY_FILE) {
      // Keep open editors in sync (and their undo history) instead of writing behind their back.
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length)), text);
      await vscode.workspace.applyEdit(edit);
      await open.save();
      return;
    }
    await vscode.workspace.fs.writeFile(uri, encoder.encode(text));
  }

  /** All versioned text files under the root. */
  private async readAll(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const walk = async (dir: string) => {
      let entries: [string, vscode.FileType][] = [];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir ? vscode.Uri.joinPath(this.root, ...dir.split('/')) : this.root);
      } catch {
        return;
      }
      for (const [name, type] of entries) {
        const path = dir ? `${dir}/${name}` : name;
        if (!isVersioned(path)) continue;
        if (type === vscode.FileType.Directory) await walk(path);
        else if (type === vscode.FileType.File && isSnapshotText(path)) {
          const text = await this.read(path);
          if (text !== undefined) files.set(path, text);
        }
      }
    };
    await walk('');
    return files;
  }
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export async function releaseCommand(tracker: VersionTracker | undefined): Promise<void> {
  if (!tracker) return void vscode.window.showWarningMessage('Archery: no documentation found.');
  const history = await tracker.history();
  if (!(await tracker.canRelease())) {
    return void vscode.window.showInformationMessage(`Archery: v${history.current} is already a release; nothing changed since.`);
  }
  const next = `${Number(history.current.split('.')[0]) + 1}.0`;
  const note = await vscode.window.showInputBox({
    title: `Archery: Release v${next}`,
    prompt: `Change log for v${next}`,
    placeHolder: 'e.g. Added the deployment view; reviewed by the architecture board',
    validateInput: (v) => (v.trim() ? undefined : 'A change log entry is required for a release'),
  });
  if (!note?.trim()) return;
  const version = await tracker.release(note.trim(), await currentAuthor(tracker.root));
  void vscode.window.showInformationMessage(`Archery: released v${version}.`);
}

export async function rollbackCommand(tracker: VersionTracker | undefined): Promise<void> {
  if (!tracker) return void vscode.window.showWarningMessage('Archery: no documentation found.');
  const [snapshots, history] = await Promise.all([tracker.snapshots(), tracker.history()]);
  if (snapshots.length === 0) {
    return void vscode.window.showInformationMessage('Archery: no releases yet.');
  }
  const pick = await vscode.window.showQuickPick(
    snapshots.map((s) => ({
      label: `v${s.version}`,
      description: `${s.kind === 'release' ? 'release' : 'backup'} · ${new Date(s.date).toLocaleString()}`,
      detail: s.note,
      version: s.version,
    })),
    { title: `Archery: Restore a version (current v${history.current})`, placeHolder: 'Version to restore' },
  );
  if (!pick) return;
  const ok = await vscode.window.showWarningMessage(
    `Restore v${pick.version}?`,
    {
      modal: true,
      detail: `The current state is kept as backup v${history.current}.`,
    },
    'Restore',
  );
  if (ok !== 'Restore') return;
  const version = await tracker.rollback(pick.version);
  void vscode.window.showInformationMessage(`Archery: restored v${pick.version} as v${version}.`);
}

/** The release author: git user.name of the repository, else the OS user name. */
export async function currentAuthor(root: vscode.Uri): Promise<string | undefined> {
  const fromGit = await new Promise<string | undefined>((resolve) =>
    execFile('git', ['config', 'user.name'], { cwd: root.fsPath, timeout: 3000 }, (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined)),
  );
  if (fromGit) return fromGit;
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}
