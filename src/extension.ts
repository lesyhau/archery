import * as vscode from 'vscode';
import { ensureClaudeCodeRegistration, installMcpServer, setupClaudeCodeCommand } from './ai/claudeCode';
import { registerLanguageModelTools } from './ai/lmTools';
import { Bridge } from './live/bridge';
import { extensionHost } from './live/host';
import { followExternal, primeChapters } from './live/liveView';
import { noteUserActivity, resetUserActivity } from './live/userActivity';
import { registerChatParticipant } from './ai/participant';
import { exportDiagramCommand } from './commands/export';
import { exportDocument, type ExportFormat } from './commands/exportDocument';
import type { ExportSettings } from './model/schema';
import { initCommand } from './commands/init';
import { newDiagramCommand } from './commands/newDiagram';
import { DocumentPanel, type RevealTarget } from './document/documentPanel';
import { WebviewDiagramEditorProvider } from './editors/webviewEditor';
import { parseProject, type Issue } from './model/load';
import { validateWorkspace } from './model/validate';
import { HISTORY_FILE } from './versions/history';
import { releaseCommand, rollbackCommand, VersionTracker } from './versions/tracker';
import { ContentsTreeProvider, headingRef, isHeading, siblingsOf, type ContentsNode } from './views/contentsTree';
import type { OutlineEdit } from './doc/protocol';
import { ArcherySession } from './ops/session';
import { TOOLS } from './ops/tools';
import { applyChanges } from './workspaceEdit';
import { DiagramToolsView } from './views/toolsView';
import { DiagramsTreeProvider } from './views/diagramsTree';
import { ProjectViewProvider, type ProjectDetails } from './views/projectView';

/** workspaceState key: the documentation the window shows, when the workspace has several. */
const ACTIVE_DOC_KEY = 'archery.activeDoc';

/** A documentation in the workspace: its version history, its file watcher and its agent bridge. */
interface Doc {
  root: vscode.Uri;
  tracker: VersionTracker;
  disposables: vscode.Disposable[];
  bridge: Bridge;
}
import { createReader, findArcheryRoots, setActiveDocRoot, systemOf } from './workspace';
import type { LoadedWorkspace } from './model/load';

export function activate(context: vscode.ExtensionContext): void {
  const tree = new DiagramsTreeProvider();
  const treeView = vscode.window.createTreeView('archery.diagrams', { treeDataProvider: tree });
  // Outline edits run in the document (opened if needed); moving and changing levels keeps the
  // keyboard in the sidebar, a new heading takes it to the document to type its title.
  const outlineEdit = (edit: OutlineEdit) => {
    if (currentRoot) void DocumentPanel.send(context, currentRoot, tracker, { type: 'outline', edit }, edit.kind !== 'add');
  };
  const contents = new ContentsTreeProvider(outlineEdit);
  const contentsView = vscode.window.createTreeView('archery.contents', { treeDataProvider: contents, dragAndDropController: contents });
  // A heading moved or promoted / demoted from the Contents stays selected there once the contents
  // reload (its number and place change), so the arrow keys can move it again.
  let selectAfterEdit: { sectionId: string; title: string; level?: number; until: number } | undefined;
  const keepSelected = (node: ContentsNode, level?: number) => {
    selectAfterEdit = { sectionId: node.sectionId, title: node.title, level, until: Date.now() + 2500 };
  };
  const reselect = () => {
    const want = selectAfterEdit;
    if (!want || Date.now() > want.until) return (selectAfterEdit = undefined);
    const node = contents.findHeading(want.sectionId, want.title, want.level);
    if (node && contentsView.visible) void contentsView.reveal(node, { select: true, focus: true }).then(undefined, () => undefined);
  };
  const project = new ProjectViewProvider();
  const projectView = vscode.window.createTreeView('archery.project', { treeDataProvider: project });
  const diagnostics = vscode.languages.createDiagnosticCollection('archery');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'archery.versionMenu';
  status.tooltip = 'Archery';

  // Every documentation in the workspace keeps its version history and takes agents' changes; the
  // one the window shows (currentRoot) fills the Contents, the Diagrams and the document.
  const docs = new Map<string, Doc>();
  let currentRoot: vscode.Uri | undefined;
  let tracker: VersionTracker | undefined;
  const isCurrent = (root: vscode.Uri) => currentRoot?.toString() === root.toString();

  const openDoc = (root: vscode.Uri): Doc => {
    const doc: Doc = { root, tracker: new VersionTracker(root), disposables: [], bridge: undefined! };
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
    const onEvent = (uri: vscode.Uri) => {
      doc.tracker.notice(uri);
      if (!uri.path.endsWith(HISTORY_FILE)) scheduleRefresh();
      if (isCurrent(root)) DocumentPanel.scheduleUpdate();
    };
    // Changes made outside Archery (an agent editing a chapter file directly) are followed in the document.
    const onChange = (uri: vscode.Uri) => {
      onEvent(uri);
      if (isCurrent(root)) void followExternal(root, uri);
    };
    doc.disposables.push(
      watcher,
      watcher.onDidCreate(onChange),
      watcher.onDidDelete(onEvent),
      watcher.onDidChange(onChange),
      doc.tracker.onDidChange(() => (isCurrent(root) ? void showVersion() : scheduleRefresh())),
      doc.tracker,
    );
    // Claude Code's MCP server hands its changes to this window (shown live, undoable).
    doc.bridge = new Bridge(root, extensionHost(context, root, () => doc.tracker));
    doc.bridge.start();
    doc.disposables.push(doc.bridge);
    return doc;
  };
  const closeDoc = (doc: Doc) => doc.disposables.forEach((d) => d.dispose());

  // The status bar shows the product name only; the documentation version is in the tooltip, the
  // menu and the Project view.
  let versionLabel = '';
  let unreleased = false;
  /** Each documentation's details for the Project view (the current one's version comes from showVersion). */
  let details: Omit<ProjectDetails, 'active'>[] = [];
  const describeProject = () =>
    project.update(
      details.map((d) => (isCurrent(d.root) ? { ...d, active: true, version: versionLabel || d.version, unreleased } : { ...d, active: false })),
    );
  const showVersion = async () => {
    describeProject();
    if (!tracker) return status.hide();
    versionLabel = `v${(await tracker.history()).current}`;
    unreleased = await tracker.canRelease();
    describeProject();
    const system = details.length > 1 ? details.find((d) => isCurrent(d.root))?.workspace.project?.system : undefined;
    status.text = '$(archery-logo) Archery';
    status.tooltip = system ? `Archery ${versionLabel} - ${system}` : `Archery ${versionLabel}`;
    status.show();
  };

  /** Shows a documentation in the window: the Contents, the Diagrams, the document and agents' default. */
  const selectDoc = async (root: vscode.Uri) => {
    await context.workspaceState.update(ACTIVE_DOC_KEY, root.toString());
    await refresh();
  };

  const refresh = async () => {
    const roots = await findArcheryRoots();
    await vscode.commands.executeCommand('setContext', 'archery.hasRoot', roots.length > 0);
    await vscode.commands.executeCommand('setContext', 'archery.multipleDocs', roots.length > 1);
    for (const [key, doc] of docs) {
      if (roots.some((r) => r.toString() === key)) continue;
      closeDoc(doc);
      docs.delete(key);
    }
    for (const r of roots) if (!docs.has(r.toString())) docs.set(r.toString(), openDoc(r));
    const preferred = context.workspaceState.get<string>(ACTIVE_DOC_KEY);
    const root = roots.find((r) => r.toString() === preferred) ?? roots.find((r) => isCurrent(r)) ?? roots[0];
    if (!root) {
      await tree.update(undefined, undefined);
      await contents.update(undefined, undefined);
      diagnostics.clear();
      currentRoot = tracker = undefined;
      setActiveDocRoot(undefined);
      details = [];
      versionLabel = '';
      await showVersion();
      return;
    }
    if (!isCurrent(root)) {
      currentRoot = root;
      tracker = docs.get(root.toString())!.tracker;
      setActiveDocRoot(root);
      for (const doc of docs.values()) doc.bridge.setActive(doc.root.toString() === root.toString());
      versionLabel = '';
      void primeChapters(root);
      // The open document follows the switch.
      const shown = DocumentPanel.shownRoot();
      if (shown && shown.toString() !== root.toString()) await DocumentPanel.show(context, root, tracker, undefined, true);
    }
    // Every documentation is checked (the Problems view, the Project view); the current one fills the sidebar.
    const checked = await Promise.all(roots.map(async (r) => ({ root: r, ...(await validateWorkspace(createReader(r))) })));
    const current = checked.find((c) => isCurrent(c.root))!;
    const count = await tree.update(root, current.workspace);
    await contents.update(root, current.workspace);
    reselect();
    await vscode.commands.executeCommand('setContext', 'archery.hasDiagrams', count > 0);
    diagnostics.clear();
    for (const c of checked) publishDiagnostics(diagnostics, c.root, c.issues);
    details = await Promise.all(
      checked
        .filter((c): c is typeof c & { workspace: LoadedWorkspace } => !!c.workspace)
        .map(async (c) => ({
          root: c.root,
          workspace: c.workspace,
          issues: c.issues,
          diagrams: c.workspace.diagrams.length,
          version: `v${(await docs.get(c.root.toString())!.tracker.history()).current}`,
        })),
    );
    await showVersion();
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
    // A click in the Contents view (the live view's own calls keep the focus where it is).
    if (target && !target.preserveFocus) noteUserActivity();
    if (!currentRoot) await refresh();
    // An agent working on another documentation: the window switches to it.
    const other = target?.root ? docs.get(target.root) : undefined;
    if (other && !isCurrent(other.root)) await selectDoc(other.root);
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
    projectView,
    openOnShow,
    followReader,
    diagnostics,
    status,
    projectWatcher,
    { dispose: () => docs.forEach(closeDoc) },
    { dispose: resetUserActivity },
    DiagramToolsView.register(context),
    WebviewDiagramEditorProvider.register(context, 'archery.diagramEditor', 'diagram'),
    WebviewDiagramEditorProvider.registerSerializer(),
    WebviewDiagramEditorProvider.register(context, 'archery.sequenceEditor', 'sequence'),
    WebviewDiagramEditorProvider.register(context, 'archery.timingEditor', 'sequence'),
    vscode.commands.registerCommand('archery.init', async () => {
      const root = await initCommand(await findArcheryRoots());
      if (root) await selectDoc(root);
      else await refresh();
      if (root) await openDocument();
    }),
    // The Project view's documentation rows, its title button and the command palette.
    vscode.commands.registerCommand('archery.selectDoc', async (target?: vscode.Uri | string | { root?: vscode.Uri }) => {
      const given = typeof target === 'string' ? vscode.Uri.parse(target) : target instanceof vscode.Uri ? target : target?.root;
      let root = given && docs.get(given.toString())?.root;
      if (!root) {
        const roots = await findArcheryRoots();
        const items = await Promise.all(
          roots.map(async (r) => ({ label: (await systemOf(r)) ?? vscode.workspace.asRelativePath(r, false), description: vscode.workspace.asRelativePath(r, false), picked: isCurrent(r), root: r })),
        );
        root = (await vscode.window.showQuickPick(items, { title: 'Switch Documentation', placeHolder: 'Documentation to show' }))?.root;
      }
      if (!root) return;
      await selectDoc(root);
      await openDocument();
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
    vscode.commands.registerCommand('archery.exportDocument', async (format?: ExportFormat, settings?: ExportSettings) => {
      // Without a format (the sidebar's button, the command palette): the export dialog in the document.
      if (format !== 'html' && format !== 'pdf') {
        if (!currentRoot) await refresh();
        if (currentRoot) return DocumentPanel.send(context, currentRoot, tracker, { type: 'exportDialog' }, false);
      }
      return exportDocument(context, currentRoot, tracker, format === 'html' || format === 'pdf' ? format : undefined, settings && typeof settings === 'object' ? settings : undefined);
    }),
    // Ctrl+F in the document, or the Contents view's search button.
    vscode.commands.registerCommand('archery.find', async () => {
      if (!currentRoot) await refresh();
      if (currentRoot) await DocumentPanel.find(context, currentRoot, tracker);
    }),
    // The contents' row buttons, context menu and keys (Alt+Shift+arrows act on the selected heading).
    vscode.commands.registerCommand('archery.contents.addHeading', (node?: ContentsNode) => {
      node ??= contentsView.selection[0];
      if (isHeading(node)) outlineEdit({ kind: 'add', sectionId: node.sectionId, at: headingRef(node) });
    }),
    vscode.commands.registerCommand('archery.contents.addSubheading', (node?: ContentsNode) => {
      node ??= contentsView.selection[0];
      if (isHeading(node)) outlineEdit({ kind: 'add', sectionId: node.sectionId, at: headingRef(node), child: true });
    }),
    vscode.commands.registerCommand('archery.contents.addSubsection', (node?: ContentsNode) => {
      node ??= contentsView.selection[0];
      if (node && !isHeading(node) && !node.decision) outlineEdit({ kind: 'add', sectionId: node.sectionId });
    }),
    vscode.commands.registerCommand('archery.contents.promote', (node?: ContentsNode) => {
      node ??= contentsView.selection[0];
      if (!isHeading(node) || node.level !== 3) return;
      keepSelected(node, 2);
      outlineEdit({ kind: 'level', heading: headingRef(node), delta: -1 });
    }),
    vscode.commands.registerCommand('archery.contents.demote', (node?: ContentsNode) => {
      node ??= contentsView.selection[0];
      if (!isHeading(node) || node.level !== 2 || !siblingsOf(node).before) return;
      keepSelected(node, 3);
      outlineEdit({ kind: 'level', heading: headingRef(node), delta: 1 });
    }),
    vscode.commands.registerCommand('archery.contents.moveUp', (node?: ContentsNode) => {
      node ??= contentsView.selection[0];
      const before = isHeading(node) ? siblingsOf(node).before : undefined;
      if (!isHeading(node) || !isHeading(before)) return;
      keepSelected(node, node.level);
      outlineEdit({ kind: 'move', heading: headingRef(node), before: headingRef(before) });
    }),
    vscode.commands.registerCommand('archery.contents.moveDown', (node?: ContentsNode) => {
      node ??= contentsView.selection[0];
      const after = isHeading(node) ? siblingsOf(node).after : undefined;
      if (!isHeading(node) || !isHeading(after)) return;
      keepSelected(node, node.level);
      // The next heading goes in front of this one.
      outlineEdit({ kind: 'move', heading: headingRef(after), before: headingRef(node) });
    }),
    vscode.commands.registerCommand('archery.renameSystem', async () => {
      if (!currentRoot) return;
      const root = currentRoot;
      const session = await ArcherySession.load(createReader(root), '');
      const current = parseProject(session.read('archery.yaml') ?? '').value?.system ?? '';
      const name = (await vscode.window.showInputBox({ title: 'Rename System', value: current, valueSelection: [0, current.length], validateInput: (v) => (v.trim() ? undefined : 'Enter a name.') }))?.trim();
      if (!name || name === current) return;
      try {
        const def = TOOLS.find((t) => t.name === 'set_project')!;
        await def.run(session, def.input.parse({ system: name }));
        await applyChanges(root, session.changes);
      } catch (e) {
        void vscode.window.showErrorMessage(`Archery: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
    vscode.commands.registerCommand('archery.editDiagram', async (target?: vscode.Uri | { uri?: vscode.Uri }) => {
      const uri = target instanceof vscode.Uri ? target : target?.uri;
      noteUserActivity();
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
    ...registerLanguageModelTools((root) => extensionHost(context, root, () => docs.get(root.toString())?.tracker)),
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
