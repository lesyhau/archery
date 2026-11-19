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

export type RevealTarget = { sectionId: string; heading?: string; index?: number; preserveFocus?: boolean };

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
    this.panel.title = `${data.system} - Architecture Design Document - Archery`;
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
      case 'openFile':
        await vscode.window.showTextDocument(this.uri(msg.file), { viewColumn: vscode.ViewColumn.Beside, preview: false });
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
      case 'createDecision':
        await this.createDecision();
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

  /** Creates the next ADR (decisions/NNNN-title.md) from a template and opens it. */
  private async createDecision(): Promise<void> {
    const title = await vscode.window.showInputBox({
      title: 'Archery: New architecture decision',
      prompt: 'What was decided? (short title)',
      placeHolder: 'e.g. Use PostgreSQL for order data',
      validateInput: (v) => (v.trim() ? undefined : 'Please enter a title'),
    });
    if (!title?.trim()) return;
    const existing = (await this.list('decisions')).map((n) => Number(/^(\d{4})-/.exec(n)?.[1] ?? 0));
    const number = String(Math.max(0, ...existing) + 1).padStart(4, '0');
    const slug = title.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'decision';
    const file = `decisions/${number}-${slug}.md`;
    const today = new Date().toISOString().slice(0, 10);
    const text = `---\nstatus: proposed\ndate: ${today}\nqualityGoals: []\nconstraints: []\n---\n\n# ${title.trim()}\n\n## Context\n\n## Decision\n\n## Consequences\n`;
    await applyChanges(this.root, new Map([[file, text]]));
    await vscode.window.showTextDocument(this.uri(file), { viewColumn: vscode.ViewColumn.Beside, preview: false });
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
      prompt: 'Diagram title (also used as its caption and file name)',
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
