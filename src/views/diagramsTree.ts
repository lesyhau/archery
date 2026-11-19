// Sidebar: the documentation's diagrams, each with the chapter that shows it (or "not in the
// document"), so diagrams no chapter uses stay reachable. The chapters are in the Contents view
// (contentsTree.ts); clicking the Archery icon opens the document.
import * as vscode from 'vscode';
import type { LoadedWorkspace } from '../model/load';
import { findSection } from '../template/template';
import { readText } from '../workspace';
import { diagramName } from '../model/usage';

interface DiagramNode {
  file: string;
  uri: vscode.Uri;
  title: string;
  type?: string;
  /** Chapters that show the diagram, e.g. "5 Building Block View". */
  usedIn: string[];
}

const ICONS: Record<string, string> = {
  component: 'symbol-module',
  package: 'package',
  deployment: 'server-environment',
  class: 'symbol-class',
  state: 'symbol-enum',
  activity: 'pulse',
  context: 'globe',
  sequence: 'list-ordered',
  communication: 'git-compare',
  object: 'symbol-object',
  composite: 'symbol-structure',
  interactionOverview: 'workflow',
  timing: 'graph-line',
};

export class DiagramsTreeProvider implements vscode.TreeDataProvider<DiagramNode> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private nodes: DiagramNode[] = [];

  /** Rebuilds the list; resolves with the number of diagrams. */
  async update(root: vscode.Uri | undefined, ws: LoadedWorkspace | undefined): Promise<number> {
    if (!root || !ws) {
      this.nodes = [];
      this.changed.fire(undefined);
      return 0;
    }
    // Which chapters place which diagram (<!-- archery:diagram diagrams/x.uml.json ... -->).
    const usedIn = new Map<string, string[]>();
    for (const s of ws.project?.sections ?? []) {
      if (!s.enabled) continue;
      const text = (await readText(vscode.Uri.joinPath(root, ...s.file.split('/')))) ?? '';
      const def = findSection(s.id);
      const chapter = `${def ? `${def.number} ` : ''}${s.title ?? def?.title ?? s.id}`;
      for (const m of text.matchAll(/<!--\s*archery:diagram\s+(\S+)/g)) usedIn.set(m[1]!, [...(usedIn.get(m[1]!) ?? []), chapter]);
    }
    this.nodes = ws.diagrams
      .map((d) => ({
        file: d.file,
        uri: vscode.Uri.joinPath(root, ...d.file.split('/')),
        title: d.title || diagramName(d.file),
        type: d.type,
        usedIn: [...new Set(usedIn.get(d.file) ?? [])],
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    this.changed.fire(undefined);
    return this.nodes.length;
  }

  getTreeItem(node: DiagramNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
    item.description = node.usedIn.length ? node.usedIn.join(', ') : 'not in the document';
    item.iconPath = new vscode.ThemeIcon((node.type && ICONS[node.type]) ?? 'type-hierarchy');
    item.tooltip = `${node.title} (${node.type ?? 'diagram'})\n${node.usedIn.length ? `Shown in ${node.usedIn.join(', ')}` : 'Not shown in any chapter yet'}`;
    item.contextValue = 'diagram';
    // Diagrams open in an Archery panel titled with the diagram; "Open Source" (context menu) shows the file.
    item.command = { command: 'archery.editDiagram', title: 'Edit diagram', arguments: [node.uri] };
    return item;
  }

  getChildren(node?: DiagramNode): DiagramNode[] {
    return node ? [] : this.nodes;
  }
}
