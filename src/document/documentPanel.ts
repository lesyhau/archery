// The architecture document view: all sections rendered as one page (like a published
// architecture document), edited in place. The Markdown files stay the source of truth.
import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import type { DiagramKind, DocumentData, FromDocument, ToDocument } from '../doc/protocol';
import type { ExportSettings } from '../model/schema';
import { deleteFromModel } from '../editors/deleteFromModel';
import { webviewHtml } from '../editors/html';
import { canvasSettings } from '../editors/webviewEditor';
import { ArcherySession, OpError } from '../ops/session';
import { TOOLS } from '../ops/tools';
import type { VersionTracker } from '../versions/tracker';
import { createReader, readText } from '../workspace';
import { loadDocumentContent } from './content';
import { applyChanges } from '../workspaceEdit';
import { newDiagramInput } from '../commands/newDiagram';
import { exportDocumentSettings } from '../commands/exportDocument';
import { WebviewDiagramEditorProvider } from '../editors/webviewEditor';
import { noteUserActivity } from '../live/userActivity';

/** `decision`: a decision record (decisions/NNNN-x.md) to open over the document. */
export type RevealTarget = { sectionId: string; heading?: string; index?: number; decision?: string; preserveFocus?: boolean };

export class DocumentPanel implements vscode.Disposable {
  private static current: DocumentPanel | undefined;
  private static readonly activeSection = new vscode.EventEmitter<{ sectionId: string; index: number | null }>();
  /** The chapter (and heading) the reader is at in the document view. */
  static readonly onDidChangeActiveSection = DocumentPanel.activeSection.event;

  private ready = false;
  private pendingReveal: RevealTarget | undefined;
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  /** Opens (or reveals) the document view, optionally scrolled to a section/heading. */
  static async show(
    context: vscode.ExtensionContext,
    root: vscode.Uri,
    tracker: VersionTracker | undefined,
    target?: RevealTarget,
  ): Promise<void> {
    const existing = DocumentPanel.current;
    if (existing && existing.root.toString() === root.toString()) {
      existing.panel.reveal(undefined, !!target?.preserveFocus);
      if (target) existing.reveal(target);
      return;
    }
    existing?.dispose();
    const panel = vscode.window.createWebviewPanel('archery.document', 'Archery', { viewColumn: vscode.ViewColumn.One, preserveFocus: !!target?.preserveFocus }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), root],
    });
    DocumentPanel.current = new DocumentPanel(context, panel, root, tracker);
    if (target) DocumentPanel.current.reveal(target);
  }

  /** Opens a diagram in its UML editor, as a tab of the active editor group. */
  static async editDiagram(uri: vscode.Uri): Promise<void> {
    await WebviewDiagramEditorProvider.openPanel(uri, { viewColumn: vscode.ViewColumn.Active });
  }

  static isOpen(): boolean {
    return !!DocumentPanel.current;
  }

  /** The tab group the document is in, if it is open. */
  static viewColumn(): vscode.ViewColumn | undefined {
    return DocumentPanel.current?.panel.viewColumn;
  }

  /**
   * Live view (src/live/liveView.ts): brings a chapter (the heading `index`), a diagram or a table (`src`)
   * into view without taking the keyboard focus, opening the document if needed. `edit`: the chapter's text
   * is about to change (the changed block is highlighted when it arrives).
   */
  static async follow(root: vscode.Uri, target: { sectionId: string; index?: number; src?: string; edit?: boolean }): Promise<void> {
    const current = DocumentPanel.current;
    if (!current || current.root.toString() !== root.toString()) {
      await vscode.commands.executeCommand('archery.openDocument', { sectionId: target.sectionId, index: target.index, preserveFocus: true });
      return;
    }
    if (!current.panel.visible || !current.panel.active) current.panel.reveal(undefined, true);
    if (current.ready) current.post({ type: 'follow', ...target });
    else current.pendingReveal = { sectionId: target.sectionId, index: target.index };
  }

  /** Called by the extension when files under the root change. */
  static scheduleUpdate(): void {
    DocumentPanel.current?.scheduleUpdate();
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly root: vscode.Uri,
    private readonly tracker: VersionTracker | undefined,
  ) {
    panel.webview.html = webviewHtml(panel.webview, context.extensionUri, 'document', 'architecture document');
    // The Archery logo, black on light themes and white on dark ones.
    panel.iconPath = { light: vscode.Uri.joinPath(context.extensionUri, 'media', 'logo-light.svg'), dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'logo-dark.svg') };
    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg: FromDocument) => void this.onMessage(msg)),
      panel.onDidDispose(() => this.dispose()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('archery.canvas') || e.affectsConfiguration('archery.diagramStyle')) this.scheduleUpdate();
      }),
    );
    if (tracker) this.disposables.push(tracker.onDidChange(() => this.scheduleUpdate()));
  }

  dispose(): void {
    if (DocumentPanel.current === this) DocumentPanel.current = undefined;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
  }

  private post(msg: ToDocument): void {
    void this.panel.webview.postMessage(msg);
  }

  private reveal(target: RevealTarget): void {
    if (this.ready) this.post({ type: 'reveal', ...target });
    else this.pendingReveal = target;
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => void this.update(), 250);
  }

  private async update(): Promise<void> {
    if (!this.ready) return;
    const data = await this.buildData();
    this.panel.title = data.title;
    this.post({ type: 'load', data });
  }

  private async onMessage(msg: FromDocument): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        await this.update();
        if (this.pendingReveal) this.post({ type: 'reveal', ...this.pendingReveal });
        this.pendingReveal = undefined;
        return;
      case 'activity':
        noteUserActivity();
        return;
      case 'activeSection':
        DocumentPanel.activeSection.fire({ sectionId: msg.sectionId, index: msg.index });
        return;
      case 'save':
        try {
          await applyChanges(this.root, new Map([[msg.file, msg.markdown]]));
        } catch (e) {
          void vscode.window.showErrorMessage(`Archery: could not save ${msg.file}: ${e instanceof Error ? e.message : e}`);
        }
        return;
      case 'openDiagram':
        return this.openDiagram(msg.src);
      case 'openLink':
        await this.openLink(msg.href, msg.base);
        return;
      case 'createDiagram': {
        const src = await this.createDiagram(msg.kind);
        this.post({ type: 'diagramCreated', requestId: msg.requestId, src });
        return;
      }
      case 'release':
        await vscode.commands.executeCommand('archery.release');
        return;
      case 'export':
        if (msg.settings) await this.saveExportSettings(msg.settings);
        await vscode.commands.executeCommand('archery.exportDocument', msg.format, msg.settings);
        return;
      case 'history':
        await vscode.commands.executeCommand('archery.rollback');
        return;
      case 'op':
        try {
          const result = await this.runOp(msg.name, msg.input, msg.diagram);
          this.post({ type: 'opResult', requestId: msg.requestId, ok: true, result });
        } catch (e) {
          const message = e instanceof Error ? (e.name === 'ZodError' ? `Invalid input: ${e.message}` : e.message) : String(e);
          this.post({ type: 'opResult', requestId: msg.requestId, ok: false, error: message });
        }
        return;
      case 'setting':
        await vscode.workspace.getConfiguration('archery.canvas').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
        return;
      case 'deleteFromModel':
        await deleteFromModel(msg.refs, (name, input) => this.runOp(name, input));
        return;
      case 'exportDiagram':
        await this.exportDiagram(msg.src, msg.format, msg.dataUrl);
        return;
      case 'saveImage':
        this.post({ type: 'imageSaved', requestId: msg.requestId, path: await this.saveImage(msg.name, msg.dataUrl) });
        return;
    }
  }

  /** Runs a shared operation; `diagram` is filled in for operations on one diagram. */
  private async runOp(name: string, input: Record<string, unknown>, diagram?: string): Promise<unknown> {
    const def = TOOLS.find((t) => t.name === name);
    if (!def) throw new OpError(`Unknown operation "${name}".`);
    const args: Record<string, unknown> = { ...input };
    if (diagram) {
      if ('diagram' in (def.input.shape as object) && args.diagram === undefined) args.diagram = diagram;
      if (name === 'write_sequence_diagram') {
        args.name ??= diagram.replace(/^diagrams\//, '').replace(/\.seq\.json$/, '');
        args.overwrite ??= true;
      }
    }
    const session = await ArcherySession.load(createReader(this.root), '');
    const result = await def.run(session, def.input.parse(args));
    await applyChanges(this.root, session.changes);
    return result;
  }

  /** SVG is rendered here; a PNG comes rendered from the page. */
  private async exportDiagram(src: string, format: 'svg' | 'png', dataUrl?: string): Promise<void> {
    if (format === 'svg') {
      await vscode.commands.executeCommand('archery.exportDiagram', this.uri(src), 'svg');
      return;
    }
    if (!dataUrl) {
      void vscode.window.showErrorMessage('Archery: the diagram could not be rendered as PNG.');
      return;
    }
    const target = await vscode.window.showSaveDialog({ defaultUri: this.uri(src.replace(/\.(uml|seq)\.json$/, '.png')), filters: { 'PNG image': ['png'] } });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    void vscode.window.showInformationMessage(`Archery: exported ${vscode.workspace.asRelativePath(target)}.`);
  }

  /**
   * A link the page does not handle itself: web pages open in the browser, files of the workspace
   * (relative to `base`, a folder of the documentation, or to the workspace folder when they start
   * with "/") open beside the document; "#L12" or "#L12-L20" selects those lines.
   */
  private async openLink(href: string, base: string): Promise<void> {
    if (/^(https?|mailto):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href, true));
      return;
    }
    const [rawPath = '', fragment = ''] = href.split('#', 2);
    let path = rawPath;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      /* keep it as written */
    }
    let uri: vscode.Uri;
    if (/^file:/i.test(path)) uri = vscode.Uri.parse(path, true);
    else if (/^[a-z]:[\\/]/i.test(path)) uri = vscode.Uri.file(path);
    else if (path.startsWith('/')) uri = vscode.Uri.joinPath(vscode.workspace.getWorkspaceFolder(this.root)?.uri ?? this.root, ...path.split('/').filter(Boolean));
    else uri = vscode.Uri.joinPath(this.root, ...base.split('/').filter(Boolean), ...path.split('/'));
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      void vscode.window.showErrorMessage(`Archery: ${vscode.workspace.asRelativePath(uri)} was not found.`);
      return;
    }
    if (stat.type & vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealInExplorer', uri);
      return;
    }
    if (/\.(md|markdown)$/i.test(uri.path)) {
      await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
      return;
    }
    const lines = /^L(\d+)(?:-L?(\d+))?$/i.exec(fragment);
    const selection = lines ? new vscode.Range(Number(lines[1]) - 1, 0, Number(lines[2] ?? lines[1]) - 1, lines[2] ? Number.MAX_SAFE_INTEGER : 0) : undefined;
    await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside, preview: false, selection });
  }

  /** Writes a pasted/dropped image to images/ (unique, readable name); returns its root-relative path. */
  private async saveImage(name: string, dataUrl: string): Promise<string | null> {
    const m = /^data:image\/(png|jpe?g|gif|svg\+xml|webp);base64,(.+)$/.exec(dataUrl);
    if (!m) {
      void vscode.window.showErrorMessage('Archery: only PNG, JPEG, GIF, SVG and WebP images can be inserted.');
      return null;
    }
    const ext = m[1] === 'svg+xml' ? 'svg' : m[1] === 'jpeg' ? 'jpg' : m[1]!;
    const base = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
    const existing = new Set(await this.list('images'));
    let file = `${base}.${ext}`;
    for (let i = 2; existing.has(file); i++) file = `${base}-${i}.${ext}`;
    await vscode.workspace.fs.writeFile(this.uri(`images/${file}`), Buffer.from(m[2]!, 'base64'));
    return `images/${file}`;
  }

  /** Keeps the export options in archery.yaml (`export`), so the next export and the team reuse them. */
  private async saveExportSettings(settings: ExportSettings): Promise<void> {
    await exportDocumentSettings(this.root, settings);
  }

  private uri(path: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ...path.split('/'));
  }

  private async openDiagram(src: string): Promise<void> {
    await DocumentPanel.editDiagram(this.uri(src));
  }

  private async createDiagram(kind: DiagramKind): Promise<string | null> {
    const title = await vscode.window.showInputBox({
      title: `Archery: New ${kind} diagram`,
      prompt: 'Diagram title',
      validateInput: (v) => (v.trim() ? undefined : 'Please enter a title'),
    });
    if (!title) return null;
    try {
      const session = await ArcherySession.load(createReader(this.root), '');
      const { tool: toolName, input } = newDiagramInput(kind, title);
      const tool = TOOLS.find((t) => t.name === toolName)!;
      const result = (await tool.run(session, tool.input.parse(input))) as { file: string };
      await applyChanges(this.root, session.changes);
      return result.file;
    } catch (e) {
      void vscode.window.showErrorMessage(`Archery: ${e instanceof OpError || e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  // --- data ------------------------------------------------------------------

  private async read(path: string): Promise<string | undefined> {
    return readText(this.uri(path));
  }

  private async list(dir: string): Promise<string[]> {
    return createReader(this.root).list(dir);
  }

  private async buildData(): Promise<DocumentData> {
    return {
      ...(await loadDocumentContent(this.root, this.tracker)),
      canvasSettings: canvasSettings(),
      sectionsBaseUri: this.panel.webview.asWebviewUri(this.uri('sections')).toString(),
    };
  }
}
