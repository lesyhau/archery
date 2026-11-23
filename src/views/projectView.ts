// Sidebar: the documentation's project details (system, version, folder, contents, problems), each
// a row that opens what changes or shows it. With several documentations in the workspace, each is
// a row of its own (the one the window shows is filled in); a click on another switches to it.
import * as vscode from 'vscode';
import type { Issue, LoadedWorkspace } from '../model/load';

export interface ProjectDetails {
  root: vscode.Uri;
  workspace: LoadedWorkspace;
  issues: Issue[];
  diagrams: number;
  /** "v3", or undefined before the version history is read. */
  version?: string;
  /** Changes since the last release (known for the shown documentation only). */
  unreleased?: boolean;
  /** The documentation the window shows. */
  active: boolean;
}

interface Row {
  id: string;
  label: string;
  description?: string;
  icon: string;
  tooltip?: string;
  command?: vscode.Command;
  children?: Row[];
  expanded?: boolean;
  contextValue?: string;
}

export class ProjectViewProvider implements vscode.TreeDataProvider<Row> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private rows: Row[] = [];

  update(docs: ProjectDetails[]): void {
    if (docs.length <= 1) this.rows = docs[0] ? detailRows(docs[0], '') : [];
    else this.rows = [...docs].sort((a, b) => Number(b.active) - Number(a.active)).map(docRow);
    this.changed.fire(undefined);
  }

  getTreeItem(row: Row): vscode.TreeItem {
    const state = row.children ? (row.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(row.label, state);
    item.id = row.id;
    item.description = row.description;
    item.iconPath = new vscode.ThemeIcon(row.icon);
    item.tooltip = row.tooltip;
    item.command = row.command;
    item.contextValue = row.contextValue;
    return item;
  }

  getChildren(row?: Row): Row[] {
    return row ? (row.children ?? []) : this.rows;
  }
}

/** A documentation among several: its system and folder, its details below. */
function docRow(d: ProjectDetails): Row {
  const folder = vscode.workspace.asRelativePath(d.root, false);
  const key = d.root.toString();
  return {
    // The id changes with the state, so the shown documentation opens and the others close.
    id: `doc:${key}:${d.active ? 'shown' : 'other'}`,
    label: d.workspace.project?.system ?? folder,
    description: folder,
    icon: d.active ? 'circle-filled' : 'circle-outline',
    tooltip: d.active ? `${d.workspace.project?.system ?? folder} (shown)` : `Show ${d.workspace.project?.system ?? folder}`,
    command: d.active ? undefined : { command: 'archery.selectDoc', title: 'Show Documentation', arguments: [key] },
    contextValue: d.active ? 'doc shown' : 'doc',
    children: detailRows(d, `${key}:`),
    expanded: d.active,
  };
}

function detailRows(d: ProjectDetails, prefix: string): Row[] {
  const project = d.workspace.project;
  const errors = d.issues.filter((i) => i.severity === 'error').length;
  const warnings = d.issues.length - errors;
  const folder = vscode.workspace.asRelativePath(d.root, false);
  // Renaming and the version menu act on the shown documentation.
  const onShown = (command: vscode.Command): vscode.Command | undefined => (d.active ? command : undefined);
  const rows: Row[] = [
    { id: `${prefix}system`, label: 'System', description: project?.system ?? '', icon: 'symbol-namespace', tooltip: project?.system, command: onShown({ command: 'archery.renameSystem', title: 'Rename System' }) },
  ];
  if (project?.title && project.title !== project.system) {
    rows.push({ id: `${prefix}title`, label: 'Title', description: project.title, icon: 'book', tooltip: project.title, command: onShown({ command: 'archery.openDocument', title: 'Open Document' }) });
  }
  if (d.version) {
    rows.push({
      id: `${prefix}version`,
      label: 'Version',
      description: d.unreleased ? `${d.version} (unreleased changes)` : d.version,
      icon: 'tag',
      command: onShown({ command: 'archery.versionMenu', title: 'Version' }),
    });
  }
  rows.push(
    { id: `${prefix}folder`, label: 'Folder', description: folder, icon: 'folder', tooltip: d.root.fsPath, command: { command: 'revealInExplorer', title: 'Reveal in Explorer View', arguments: [d.root] } },
    { id: `${prefix}diagrams`, label: 'Diagrams', description: String(d.diagrams), icon: 'type-hierarchy', command: onShown({ command: 'archery.diagrams.focus', title: 'Show Diagrams' }) },
    { id: `${prefix}decisions`, label: 'Decisions', description: String(d.workspace.decisions.length), icon: 'law' },
    {
      id: `${prefix}problems`,
      label: 'Problems',
      description: d.issues.length ? [errors && `${errors} ${errors === 1 ? 'error' : 'errors'}`, warnings && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(', ') : 'none',
      icon: errors ? 'error' : warnings ? 'warning' : 'pass',
      command: { command: 'workbench.actions.view.problems', title: 'Show Problems' },
    },
  );
  return rows;
}
