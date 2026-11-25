// What agents can ask of VS Code (see ToolHost in src/ops/session.ts): versions and export. Used by
// Copilot's tools directly and by the MCP server through the bridge.
import * as vscode from 'vscode';
import { exportDocumentSettings, pdfBrowsers, writeDocumentFile } from '../commands/exportDocument';
import { writeDiagramImage } from '../commands/export';
import { loadDocumentContent } from '../document/content';
import type { ExportSettings } from '../model/schema';
import { OpError, type ToolHost } from '../ops/session';
import { currentAuthor, type VersionTracker } from '../versions/tracker';

/** A path given by an agent: relative to the workspace folder (or absolute). */
function resolveTarget(root: vscode.Uri, file: string | undefined, fallback: vscode.Uri): vscode.Uri {
  if (!file) return fallback;
  if (/^([a-zA-Z]:[\\/]|\/)/.test(file)) return vscode.Uri.file(file);
  const folder = vscode.workspace.getWorkspaceFolder(root)?.uri ?? vscode.Uri.joinPath(root, '..');
  return vscode.Uri.joinPath(folder, ...file.split(/[\\/]/));
}

export function extensionHost(context: vscode.ExtensionContext, root: vscode.Uri, tracker: () => VersionTracker | undefined): ToolHost {
  const needTracker = () => {
    const t = tracker();
    if (!t) throw new OpError('Versions are not available: no documentation is open.');
    return t;
  };
  return {
    async versions() {
      const t = needTracker();
      const [history, snapshots] = await Promise.all([t.history(), t.snapshots()]);
      return { current: history.current, releases: snapshots.map((s) => ({ version: s.version, kind: s.kind, date: s.date, note: s.note })) };
    },
    async release(note) {
      const t = needTracker();
      if (!(await t.canRelease())) throw new OpError(`v${(await t.history()).current} is already a release; nothing changed since.`);
      return t.release(note, await currentAuthor(t.root));
    },
    async restore(version) {
      const t = needTracker();
      if (!(await t.snapshots()).some((s) => s.version === version)) throw new OpError(`There is no release v${version}. Call list_versions.`);
      return t.rollback(version);
    },
    async exportDocument(format, file, settings) {
      const content = await loadDocumentContent(root, tracker());
      const name = `${content.system} - Architecture Design Document.${format}`.replace(/[\\/:*?"<>|]/g, '-');
      const target = resolveTarget(root, file, vscode.Uri.joinPath(root, '..', name));
      // An agent names the options it changes; the others (header, variables, ...) stay as saved.
      const chosen = settings ? { ...content.exportSettings, ...(settings as ExportSettings) } : undefined;
      if (chosen) await exportDocumentSettings(root, chosen);
      try {
        await writeDocumentFile(context, root, content, format, chosen, target);
      } catch (e) {
        throw new OpError(e instanceof Error ? e.message : String(e));
      }
      return vscode.workspace.asRelativePath(target);
    },
    async browsers() {
      return pdfBrowsers();
    },
    async exportDiagram(diagram, format, theme, file) {
      const uri = vscode.Uri.joinPath(root, ...diagram.split('/'));
      const target = resolveTarget(root, file, uri.with({ path: `${uri.path.replace(/\.(uml|seq|timing)\.json$/, '')}.${format}` }));
      try {
        await writeDiagramImage(uri, format, theme, target);
      } catch (e) {
        throw new OpError(e instanceof Error ? e.message : String(e));
      }
      return vscode.workspace.asRelativePath(target);
    },
  };
}
