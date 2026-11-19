// Sidebar view "Diagram Tools": the palette and inspector of the active diagram editor tab.
// While the view is visible the editors hand their panels to it ("docked") and hide their own;
// when it is collapsed or the sidebar shows something else, the editors draw them again.
// The editor keeps all state; this view only relays its panels and the calls made on them.
import * as vscode from 'vscode';
import { webviewHtml } from '../editors/html';
import type { ToWebview } from '../protocol';

interface EditorLink {
  post(msg: ToWebview): void;
  panels: unknown;
  panel: vscode.WebviewPanel;
}

/** The view type of Archery's diagram panels (see webviewEditor.ts). */
const DIAGRAM_PANEL = 'archery.diagram';

export class DiagramToolsView implements vscode.WebviewViewProvider {
  static readonly id = 'archery.diagramTools';
  static instance: DiagramToolsView | undefined;

  private view: vscode.WebviewView | undefined;
  private readonly editors = new Map<string, EditorLink>();
  private activeKey: string | undefined;
  /** The diagram panel that was active last (a webview tab does not tell which file it shows). */
  private lastPanel: string | undefined;

  private constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const tools = new DiagramToolsView(context.extensionUri);
    DiagramToolsView.instance = tools;
    return vscode.Disposable.from(
      vscode.window.registerWebviewViewProvider(DiagramToolsView.id, tools, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.tabGroups.onDidChangeTabs(() => tools.syncActive()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => tools.syncActive()),
    );
  }

  private get docked(): boolean {
    return !!this.view?.visible;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] };
    view.webview.html = webviewHtml(view.webview, this.extensionUri, 'tools', 'Diagram tools');
    view.webview.onDidReceiveMessage((msg: { type?: string; fn?: string; args?: unknown[] }) => {
      if (msg.type === 'ready') this.pushPanels();
      else if (msg.type === 'panelCall' && typeof msg.fn === 'string' && this.activeKey) {
        this.editors.get(this.activeKey)?.post({ type: 'panelCall', fn: msg.fn, args: msg.args ?? [] });
      }
    });
    view.onDidChangeVisibility(() => this.broadcastDocked());
    view.onDidDispose(() => {
      this.view = undefined;
      this.broadcastDocked();
    });
    this.syncActive();
    this.broadcastDocked();
  }

  /** Called by each diagram editor tab. */
  attach(uri: vscode.Uri, post: (msg: ToWebview) => void, panel: vscode.WebviewPanel): { ready(): void; panels(panels: unknown): void; dispose(): void } {
    const key = uri.toString();
    const link: EditorLink = { post, panels: null, panel };
    this.editors.set(key, link);
    if (panel.active) this.lastPanel = key;
    const viewState = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) this.lastPanel = key;
      this.syncActive();
    });
    this.syncActive();
    return {
      ready: () => post({ type: 'docked', docked: this.docked }),
      panels: (panels) => {
        link.panels = panels;
        if (key === this.activeKey) this.pushPanels();
      },
      dispose: () => {
        viewState.dispose();
        if (this.editors.get(key) === link) this.editors.delete(key);
        if (this.lastPanel === key) this.lastPanel = undefined;
        this.syncActive();
      },
    };
  }

  /** The active tab decides whose panels are shown (none when it is not a diagram editor). */
  syncActive(): void {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const key =
      input instanceof vscode.TabInputCustom
        ? input.uri.toString()
        : input instanceof vscode.TabInputWebview && input.viewType.endsWith(DIAGRAM_PANEL)
          ? ([...this.editors].find(([, l]) => l.panel.active)?.[0] ?? this.lastPanel)
          : undefined;
    const next = key && this.editors.has(key) ? key : undefined;
    if (next === this.activeKey) return;
    this.activeKey = next;
    this.pushPanels();
  }

  private pushPanels(): void {
    const panels = this.activeKey ? (this.editors.get(this.activeKey)?.panels ?? null) : null;
    void this.view?.webview.postMessage({ type: 'panels', panels });
  }

  private broadcastDocked(): void {
    for (const link of this.editors.values()) link.post({ type: 'docked', docked: this.docked });
  }
}
