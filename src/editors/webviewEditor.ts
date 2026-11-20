// The diagram editors (*.uml.json canvas, *.seq.json sequence / communication, *.timing.json timing).
//
// Archery opens diagrams in its own panels, titled with the diagram's name (no file name or
// extension in the tab); `openPanel` reuses the custom editor code on such a panel, and a
// serializer brings the panels back after a reload. The custom editors stay registered for
// "Open With"; opening the file itself shows its source.
//
// The TextDocument is the single source of truth (git diff, save, undo/redo). The webview
// renders it and requests changes as operations (src/ops/tools.ts), which the extension runs
// against the whole documentation workspace and applies as ONE WorkspaceEdit - so creating or
// renaming an element updates model.yaml and the diagram atomically.
import * as vscode from 'vscode';
import { parseModel } from '../model/load';
import { diagramName, diagramUsage, type DiagramUsage } from '../model/usage';
import { ArcherySession, OpError } from '../ops/session';
import { TOOLS } from '../ops/tools';
import type { CanvasSettings, FromWebview, ToWebview } from '../protocol';
import { findRootFor, createReader, readText } from '../workspace';
import { applyRecorded, redo, undo } from './history';
import { deleteFromModel } from './deleteFromModel';
import { webviewHtml } from './html';
import { DiagramToolsView } from '../views/toolsView';
import type { DiagramStyle } from '../render/scene';

export function canvasSettings(): CanvasSettings {
  const c = vscode.workspace.getConfiguration('archery.canvas');
  return {
    snapToGrid: c.get('snapToGrid', true),
    showGrid: c.get('showGrid', true),
    gridSize: Math.min(100, Math.max(2, c.get('gridSize', 10))),
    diagramStyle: diagramStyle(),
  };
}

/** The diagram style setting (archery.diagramStyle). */
export function diagramStyle(): DiagramStyle {
  return vscode.workspace.getConfiguration('archery').get<string>('diagramStyle', 'classic') === 'modern' ? 'modern' : 'classic';
}

interface OpenEditor {
  panel: vscode.WebviewPanel;
  ready: boolean;
  /** Live view: select and outline these ids. */
  highlight(refs: string[]): void;
  renderPng(): Promise<string | null>;
}

/** The view type of Archery's diagram panels. */
export const DIAGRAM_PANEL = 'archery.diagram';

const bundleOf = (path: string) => (path.endsWith('.uml.json') ? 'diagram' : 'sequence');

/** The diagram's title, else its file name without the extension. */
function titleOf(document: vscode.TextDocument): string {
  try {
    const title = (JSON.parse(document.getText()) as { title?: unknown }).title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  } catch {
    // not valid JSON (yet)
  }
  return diagramName(document.uri.path);
}

export class WebviewDiagramEditorProvider implements vscode.CustomTextEditorProvider {
  /** Open editors by document URI (for export). */
  static readonly open = new Map<string, OpenEditor>();
  /** One provider per webview bundle (diagram | sequence). */
  private static readonly providers = new Map<string, WebviewDiagramEditorProvider>();

  /** Opens a diagram in an Archery panel (or brings its open panel to the front). */
  static async openPanel(uri: vscode.Uri, options: { viewColumn?: vscode.ViewColumn; preserveFocus?: boolean } = {}): Promise<void> {
    const existing = WebviewDiagramEditorProvider.open.get(uri.toString());
    if (existing) return existing.panel.reveal(options.viewColumn, options.preserveFocus);
    const provider = WebviewDiagramEditorProvider.providers.get(bundleOf(uri.path));
    if (!provider) return;
    const document = await vscode.workspace.openTextDocument(uri);
    const panel = vscode.window.createWebviewPanel(DIAGRAM_PANEL, titleOf(document), { viewColumn: options.viewColumn ?? vscode.ViewColumn.Active, preserveFocus: options.preserveFocus }, { retainContextWhenHidden: true });
    await provider.resolvePanel(document, panel);
  }

  /** Brings diagram panels back after a window reload (the webview keeps its file in its state). */
  static registerSerializer(): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(DIAGRAM_PANEL, {
      async deserializeWebviewPanel(panel, state: { fileName?: string } | undefined) {
        if (!state?.fileName) return panel.dispose();
        const uri = vscode.Uri.file(state.fileName);
        const provider = WebviewDiagramEditorProvider.providers.get(bundleOf(uri.path));
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          if (provider) await provider.resolvePanel(document, panel);
          else panel.dispose();
        } catch {
          panel.dispose(); // the file is gone
        }
      },
    });
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    /** Name of the webview bundle in dist/webview (diagram | sequence). */
    private readonly bundle: string,
  ) {}

  static register(context: vscode.ExtensionContext, viewType: string, bundle: string): vscode.Disposable {
    const provider = new WebviewDiagramEditorProvider(context, bundle);
    if (!WebviewDiagramEditorProvider.providers.has(bundle)) WebviewDiagramEditorProvider.providers.set(bundle, provider);
    return vscode.window.registerCustomEditorProvider(viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  /** "Open With": VS Code's custom editor (tab named after the file; VS Code's undo). */
  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    return this.resolve(document, panel, false);
  }

  /** An Archery panel: titled with the diagram, with its own undo / redo. */
  resolvePanel(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'diagram-light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'diagram-dark.svg'),
    };
    return this.resolve(document, panel, true);
  }

  private async resolve(document: vscode.TextDocument, panel: vscode.WebviewPanel, own: boolean): Promise<void> {
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    webview.html = webviewHtml(webview, this.context.extensionUri, this.bundle, 'architecture diagram');

    const post = (msg: ToWebview) => void webview.postMessage(msg);
    const disposables: vscode.Disposable[] = [];
    const root = await findRootFor(document.uri);
    const diagramPath = root ? relativePath(root, document.uri) : undefined;
    const editable = !!root && !!diagramPath;

    // --- model.yaml ---------------------------------------------------------
    const modelUri = root && vscode.Uri.joinPath(root, 'model.yaml');
    /** What every diagram of the documentation shows (for "used in" and scenarios in the inspector). */
    const usages = async (): Promise<DiagramUsage[]> => {
      if (!root) return [];
      const out: DiagramUsage[] = [];
      for (const name of (await createReader(root).list('diagrams')).sort()) {
        const file = `diagrams/${name}`;
        const text = file === diagramPath ? document.getText() : await readText(vscode.Uri.joinPath(root, 'diagrams', name));
        const usage = text === undefined ? undefined : diagramUsage(file, text);
        if (usage) out.push(usage);
      }
      return out;
    };
    const sendModel = async () => {
      if (!modelUri) return post({ type: 'model', model: null, issues: [] });
      const text = await readText(modelUri);
      if (text === undefined) return post({ type: 'model', model: null, issues: ['model.yaml not found'] });
      const parsed = parseModel(text);
      post({ type: 'model', model: parsed.value ?? null, issues: parsed.issues.map((i) => `model.yaml${i.line ? `:${i.line}` : ''}: ${i.message}`), diagrams: await usages() });
    };
    if (root && modelUri) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, 'model.yaml'));
      disposables.push(watcher, watcher.onDidChange(sendModel), watcher.onDidCreate(sendModel), watcher.onDidDelete(sendModel));
      const diagramWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, 'diagrams/*.json'));
      disposables.push(diagramWatcher, diagramWatcher.onDidChange(sendModel), diagramWatcher.onDidCreate(sendModel), diagramWatcher.onDidDelete(sendModel));
      disposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document.uri.toString() === modelUri.toString() && e.contentChanges.length > 0) void sendModel();
        }),
      );
    }

    // --- document -> webview --------------------------------------------------
    const sendDocument = (type: 'init' | 'documentChanged') => {
      if (own) panel.title = titleOf(document);
      post({ type, text: document.getText(), fileName: document.fileName, editable });
    };
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) sendDocument('documentChanged');
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('archery.canvas') || e.affectsConfiguration('archery.diagramStyle')) post({ type: 'settings', settings: canvasSettings() });
      }),
    );

    // --- operations -------------------------------------------------------------
    const runOp = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
      if (!root || !diagramPath) throw new OpError('This diagram is not part of the architecture documentation.');
      const def = TOOLS.find((t) => t.name === name);
      if (!def) throw new OpError(`Unknown operation "${name}".`);
      const shape = def.input.shape as Record<string, unknown>;
      const args: Record<string, unknown> = { ...input };
      if ('diagram' in shape && args.diagram === undefined) args.diagram = diagramPath;
      if (name === 'write_sequence_diagram' || name === 'write_timing_diagram') {
        args.name ??= diagramPath.replace(/^diagrams\//, '').replace(/\.(seq|timing)\.json$/, '');
        args.overwrite ??= true;
      }
      const session = await ArcherySession.load(createReader(root), '');
      const result = await def.run(session, def.input.parse(args));
      await applyRecorded(root, session.changes);
      return result;
    };

    let pngRequest = 0;
    const pngWaiters = new Map<number, (url: string | null) => void>();
    const entry: OpenEditor = {
      panel,
      ready: false,
      highlight: (refs) => post({ type: 'highlight', refs }),
      renderPng: () =>
        new Promise((resolve) => {
          const requestId = ++pngRequest;
          pngWaiters.set(requestId, resolve);
          post({ type: 'renderPng', requestId });
          setTimeout(() => pngWaiters.delete(requestId) && resolve(null), 10000);
        }),
    };
    WebviewDiagramEditorProvider.open.set(document.uri.toString(), entry);
    // The palette and inspector can be docked in the sidebar's Diagram Tools view.
    const tools = DiagramToolsView.instance?.attach(document.uri, post, panel);

    disposables.push(
      webview.onDidReceiveMessage(async (msg: FromWebview) => {
        switch (msg.type) {
          case 'ready':
            entry.ready = true;
            post({ type: 'settings', settings: canvasSettings() });
            tools?.ready();
            await sendModel();
            sendDocument('init');
            return;
          case 'op':
            try {
              const result = await runOp(msg.name, msg.input);
              post({ type: 'opResult', requestId: msg.requestId, ok: true, result });
            } catch (e) {
              const message = e instanceof Error ? (e.name === 'ZodError' ? `Invalid input: ${e.message}` : e.message) : String(e);
              post({ type: 'opResult', requestId: msg.requestId, ok: false, error: message });
              if (!(e instanceof OpError)) console.error('Archery operation failed', e);
            }
            return;
          case 'deleteFromModel':
            await deleteFromModel(msg.refs, runOp);
            return;
          case 'setting':
            await vscode.workspace.getConfiguration('archery.canvas').update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
            return;
          case 'export':
            await vscode.commands.executeCommand('archery.exportDiagram', document.uri, msg.format);
            return;
          case 'panels':
            tools?.panels(msg.panels);
            return;
          case 'png':
            pngWaiters.get(msg.requestId)?.(msg.dataUrl);
            pngWaiters.delete(msg.requestId);
            return;
          case 'error':
            void vscode.window.showErrorMessage(`Archery: ${msg.message}`);
            return;
          case 'undo':
          case 'redo':
            // The custom editor gets VS Code's undo; Archery panels use the operation history.
            if (own && root) await (msg.type === 'undo' ? undo(root) : redo(root));
            return;
          case 'openDiagram':
            if (root) {
              await WebviewDiagramEditorProvider.openPanel(vscode.Uri.joinPath(root, ...msg.file.split('/')));
            }
            return;
        }
      }),
    );

    panel.onDidDispose(() => {
      WebviewDiagramEditorProvider.open.delete(document.uri.toString());
      tools?.dispose();
      disposables.forEach((d) => d.dispose());
    });
  }
}

export function relativePath(root: vscode.Uri, uri: vscode.Uri): string | undefined {
  const base = root.path.endsWith('/') ? root.path : `${root.path}/`;
  return uri.path.startsWith(base) ? uri.path.slice(base.length) : undefined;
}
