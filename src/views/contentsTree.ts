// Sidebar: the document's chapters and their headings (## and ###), numbered like the document.
// Clicking one opens the document there; the chapter being read is selected while scrolling. The
// chapter that lists the architecture decisions has one entry per decision, which opens it.
import * as vscode from 'vscode';
import type { LoadedWorkspace } from '../model/load';
import { findSection } from '../template/template';
import { readText } from '../workspace';
import { outlineOf } from '../doc/outline';
import { adrTitle, splitAdrText } from '../doc/adr';

export interface ContentsNode {
  sectionId: string;
  /** Index among the chapter's ## / ### headings; undefined for the chapter itself. */
  index?: number;
  number: string;
  title: string;
  uri?: vscode.Uri;
  /** 0-based line of the heading in the Markdown file. */
  line?: number;
  /** A decision record (decisions/NNNN-x.md, relative to the root). */
  decision?: string;
  children: ContentsNode[];
  parent?: ContentsNode;
}

export class ContentsTreeProvider implements vscode.TreeDataProvider<ContentsNode> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private nodes: ContentsNode[] = [];

  async update(root: vscode.Uri | undefined, ws: LoadedWorkspace | undefined): Promise<void> {
    this.nodes = [];
    if (root && ws) {
      let last = 0;
      for (const s of ws.project?.sections ?? []) {
        if (!s.enabled) continue;
        const def = findSection(s.id);
        const uri = vscode.Uri.joinPath(root, ...s.file.split('/'));
        const chapterNo = def?.number;
        if (chapterNo !== undefined) last = Math.max(last, chapterNo);
        const chapter: ContentsNode = { sectionId: s.id, number: chapterNo === undefined ? '' : String(chapterNo), title: s.title ?? def?.title ?? s.id, uri, line: 0, children: [] };
        let major = 0;
        let minor = 0;
        let parent: ContentsNode | undefined;
        const markdown = (await readText(uri)) ?? '';
        outlineOf(markdown).forEach((h, index) => {
          if (h.level === 2) {
            major++;
            minor = 0;
          } else minor++;
          const number = chapterNo === undefined ? '' : h.level === 2 ? `${chapterNo}.${major}` : `${chapterNo}.${major}.${minor}`;
          const owner = h.level === 3 && parent ? parent : chapter;
          const node: ContentsNode = { sectionId: s.id, index, number, title: h.title, uri, line: h.line, children: [], parent: owner };
          owner.children.push(node);
          if (h.level === 2) parent = node;
        });
        if (/<!--\s*archery:decisions\b/.test(markdown)) {
          for (const file of ws.decisions) {
            const text = (await readText(vscode.Uri.joinPath(root, ...file.split('/')))) ?? '';
            const name = file.slice(file.lastIndexOf('/') + 1);
            const title = adrTitle(splitAdrText(text).body) ?? name.slice(5, -3).replace(/-/g, ' ');
            chapter.children.push({ sectionId: s.id, number: `ADR-${name.slice(0, 4)}`, title, decision: file, children: [], parent: chapter });
          }
        }
        this.nodes.push(chapter);
      }
      // The generated change history is the last chapter of the document.
      this.nodes.push({ sectionId: 'change-history', number: String(last + 1), title: 'Change history', children: [] });
    }
    this.changed.fire(undefined);
  }

  /** The node for a place in the document (the heading, else its chapter). */
  find(sectionId: string, index?: number | null): ContentsNode | undefined {
    const chapter = this.nodes.find((n) => n.sectionId === sectionId);
    if (!chapter || index === undefined || index === null) return chapter;
    const all = chapter.children.flatMap((c) => [c, ...c.children]);
    return all.find((n) => n.index === index) ?? chapter;
  }

  getTreeItem(node: ContentsNode): vscode.TreeItem {
    const label = node.number ? `${node.number}  ${node.title}` : node.title;
    const item = new vscode.TreeItem(label, node.children.length ? (node.index === undefined ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded) : vscode.TreeItemCollapsibleState.None);
    item.id = node.decision ? `${node.sectionId}#${node.decision}` : `${node.sectionId}#${node.index ?? ''}`;
    item.tooltip = node.title;
    item.contextValue = node.uri ? 'heading' : node.decision ? 'decision' : 'generated';
    item.command = { command: 'archery.openDocument', title: 'Open in the document', arguments: [{ sectionId: node.sectionId, index: node.index, decision: node.decision }] };
    return item;
  }

  getChildren(node?: ContentsNode): ContentsNode[] {
    return node ? node.children : this.nodes;
  }

  getParent(node: ContentsNode): ContentsNode | undefined {
    return node.parent;
  }
}
