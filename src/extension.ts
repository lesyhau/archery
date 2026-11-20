import * as vscode from 'vscode';
import { ensureClaudeCodeRegistration, installMcpServer, setupClaudeCodeCommand } from './ai/claudeCode';
import { registerLanguageModelTools } from './ai/lmTools';
import { Bridge } from './live/bridge';
import { extensionHost } from './live/host';
import { followExternal, primeChapters } from './live/liveView';
import { registerChatParticipant } from './ai/participant';
import { exportDiagramCommand } from './commands/export';
import { exportDocument, type ExportFormat } from './commands/exportDocument';
import type { ExportSettings } from './model/schema';
import { initCommand } from './commands/init';
import { newDiagramCommand } from './commands/newDiagram';
import { DocumentPanel, type RevealTarget } from './document/documentPanel';
import { WebviewDiagramEditorProvider } from './editors/webviewEditor';
import type { Issue } from './model/load';
import { validateWorkspace } from './model/validate';
import { HISTORY_FILE } from './versions/history';
import { releaseCommand, rollbackCommand, VersionTracker } from './versions/tracker';
import { ContentsTreeProvider } from './views/contentsTree';
import { DiagramToolsView } from './views/toolsView';
import { DiagramsTreeProvider } from './views/diagramsTree';
import { createReader, findArcheryRoots } from './workspace';

export function activate(context: vscode.ExtensionContext): void {
  const tree = new DiagramsTreeProvider();
  const treeView = vscode.window.createTreeView('archery.diagrams', { treeDataProvider: tree });
  const contents = new ContentsTreeProvider();
  const contentsView = vscode.window.createTreeView('archery.contents', { treeDataProvider: contents });
  const diagnostics = vscode.languages.createDiagnosticCollection('archery');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'archery.versionMenu';
  status.tooltip = 'Archery';

  let rootWatcher: vscode.Disposable | undefined;
  let bridge: Bridge | undefined;
  let currentRoot: vscode.Uri | undefined;
  let tracker: VersionTracker | undefined;

  // The status bar shows the product name only; the documentation version is in the tooltip and the menu.
  let versionLabel = '';
  const showVersion = async () => {
    if (!tracker) return status.hide();
    versionLabel = `v${(await tracker.history()).current}`;
    status.text = '$(archery-logo) Archery';
    status.tooltip = `Archery ${versionLabel}`;
    status.show();
  };

  const refresh = async () => {
    const root = (await findArcheryRoots())[0];
    await vscode.commands.executeCommand('setContext', 'archery.hasRoot', !!root);
    contentsView.description = root ? vscode.workspace.asRelativePath(root) : undefined;
    if (!root) {
      await tree.update(undefined, undefined);
      await contents.update(undefined, undefined);
      diagnostics.clear();
      rootWatcher?.dispose();
      tracker?.dispose();
      bridge?.dispose();
      currentRoot = tracker = rootWatcher = bridge = undefined;
      await showVersion();
      return;
    }
    if (root.toString() !== currentRoot?.toString()) {
      currentRoot = root;
      rootWatcher?.dispose();
      tracker?.dispose();
      tracker = new VersionTracker(root);
      tracker.onDidChange(() => void showVersion());
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
      const onEvent = (uri: vscode.Uri) => {
        tracker?.notice(uri);
        if (!uri.path.endsWith(HISTORY_FILE)) scheduleRefresh();
        DocumentPanel.scheduleUpdate();
      };
      // Changes made outside Archery (an agent editing a chapter file directly) are followed in the document.
      const onChange = (uri: vscode.Uri) => {
        onEvent(uri);
        void followExternal(root, uri);
      };
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onEvent);
      watcher.onDidChange(onChange);
      rootWatcher = watcher;
      void primeChapters(root);
      // Claude Code's MCP server hands its changes to this window (shown live, undoable).
      bridge?.dispose();
      bridge = new Bridge(root, extensionHost(context, root, () => tracker));
      bridge.start();
      await showVersion();
    }
    const { workspace, issues } = await validateWorkspace(createReader(root));
    const count = await tree.update(root, workspace);
    await contents.update(root, workspace);
    await vscode.commands.executeCommand('setContext', 'archery.hasDiagrams', count > 0);
    publishDiagnostics(diagnostics, root, issues);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 300);
  };

  // Notice docs/architecture appearing (e.g. after init or a git checkout).
  const projectWatcher = vscode.workspace.createFileSystemWatcher('**/archery.yaml');
  projectWatcher.onDidCreate(scheduleRefresh);
  projectWatcher.onDidDelete(scheduleRefresh);

  const openDocument = async (target?: RevealTarget) => {
    if (!currentRoot) await refresh();
    if (!currentRoot) {
      const choice = await vscode.window.showInformationMessage('Archery: no documentation in this workspace yet.', 'Initialize');
      if (choice) await vscode.commands.executeCommand('archery.init');
      return;
    }
    await DocumentPanel.show(context, currentRoot, tracker, target && typeof target.sectionId === 'string' ? target : undefined);
  };

  // Clicking the Archery icon in the activity bar opens the document.
  const openOnShow = contentsView.onDidChangeVisibility((e) => {
    if (e.visible && currentRoot) void openDocument();
  });
  // The chapter being read is selected in the contents.
  const followReader = DocumentPanel.onDidChangeActiveSection(({ sectionId, index }) => {
    const node = contents.find(sectionId, index);
    if (node && contentsView.visible) void contentsView.reveal(node, { select: true, focus: false, expand: false }).then(undefined, () => undefined);
  });

  context.subscriptions.push(
    treeView,
    contentsView,
    openOnShow,
    followReader,
    diagnostics,
    status,
    projectWatcher,
    { dispose: () => rootWatcher?.dispose() },
    { dispose: () => tracker?.dispose() },
    { dispose: () => bridge?.dispose() },
    DiagramToolsView.register(context),
    WebviewDiagramEditorProvider.register(context, 'archery.diagramEditor', 'diagram'),
    WebviewDiagramEditorProvider.registerSerializer(),
    WebviewDiagramEditorProvider.register(context, 'archery.sequenceEditor', 'sequence'),
    WebviewDiagramEditorProvider.register(context, 'archery.timingEditor', 'sequence'),
    vscode.commands.registerCommand('archery.init', async () => {
      const root = await initCommand();
      await refresh();
      if (root) await openDocument();
    }),
    vscode.commands.registerCommand('archery.refresh', refresh),
    vscode.commands.registerCommand('archery.openDocument', openDocument),
    vscode.commands.registerCommand('archery.openSectionSource', async (node?: { uri?: vscode.Uri; line?: number }) => {
      if (!node?.uri) return;
      const selection = node.line !== undefined ? new vscode.Range(node.line, 0, node.line, 0) : undefined;
      await vscode.window.showTextDocument(node.uri, { selection, preview: false });
    }),
    // The diagram file itself (JSON), from the Diagrams view's context menu.
    vscode.commands.registerCommand('archery.openDiagramSource', async (node?: { uri?: vscode.Uri }) => {
      if (node?.uri) await vscode.window.showTextDocument(node.uri, { preview: false });
    }),
    vscode.commands.registerCommand('archery.exportDiagram', exportDiagramCommand),
    vscode.commands.registerCommand('archery.exportDocument', (format?: ExportFormat, settings?: ExportSettings) =>
      exportDocument(context, currentRoot, tracker, format === 'html' || format === 'pdf' ? format : undefined, settings && typeof settings === 'object' ? settings : undefined),
    ),
    vscode.commands.registerCommand('archery.editDiagram', async (target?: vscode.Uri | { uri?: vscode.Uri }) => {
      const uri = target instanceof vscode.Uri ? target : target?.uri;
      if (!currentRoot) await refresh();
      if (!uri) return;
      await DocumentPanel.editDiagram(uri);
    }),
    vscode.commands.registerCommand('archery.newDiagram', () => newDiagramCommand(currentRoot)),
    vscode.commands.registerCommand('archery.release', () => releaseCommand(tracker)),
    vscode.commands.registerCommand('archery.rollback', () => rollbackCommand(tracker)),
    vscode.commands.registerCommand('archery.versionMenu', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(tag) Release', description: 'raise the major version and keep a snapshot', id: 'archery.release' },
          { label: '$(history) Restore a release', description: 'roll back to a released version', id: 'archery.rollback' },
          { label: '$(book) Open the document', id: 'archery.openDocument' },
          { label: '$(export) Export as PDF or HTML', id: 'archery.exportDocument' },
          { label: '$(list-unordered) Show the version history file', id: 'history' },
        ],
        { title: `Archery - ${versionLabel}` },
      );
      if (!pick) return;
      if (pick.id === 'history' && currentRoot) await vscode.window.showTextDocument(vscode.Uri.joinPath(currentRoot, ...HISTORY_FILE.split('/')));
      else if (pick.id !== 'history') await vscode.commands.executeCommand(pick.id);
    }),
    vscode.commands.registerCommand('archery.setupClaudeCode', () => setupClaudeCodeCommand(context)),
    // AI integrations: Copilot uses the language model tools + @archery; Claude Code uses the MCP server.
    ...registerLanguageModelTools((root) => extensionHost(context, root, () => (currentRoot?.toString() === root.toString() ? tracker : undefined))),
    ...registerChatParticipant(context),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
  );

  void refresh();
  // Keep the MCP server at its stable path up to date after extension updates, and registered with Claude Code.
  installMcpServer(context)
    .then((server) => ensureClaudeCodeRegistration(context, server))
    .catch((e: unknown) => console.error('Archery: could not install the MCP server', e));
}

function publishDiagnostics(collection: vscode.DiagnosticCollection, root: vscode.Uri, issues: Issue[]): void {
  collection.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const issue of issues) {
    const line = Math.max(0, (issue.line ?? 1) - 1);
    const col = Math.max(0, (issue.col ?? 1) - 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, col, line, Number.MAX_SAFE_INTEGER),
      issue.message,
      issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'Archery';
    const list = byFile.get(issue.file) ?? [];
    list.push(diagnostic);
    byFile.set(issue.file, list);
  }
  for (const [file, list] of byFile) {
    collection.set(vscode.Uri.joinPath(root, ...file.split('/')), list);
  }
}

export function deactivate(): void {}
