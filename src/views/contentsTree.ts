// Sidebar: the document's chapters and their headings (## and ###), numbered like the document.
// Clicking one opens the document there; the chapter being read is selected while scrolling. The
// chapter that lists the architecture decisions has one entry per decision, which opens it.
// Outline edits: drag a heading (with its subheadings) onto another to put it in front of that one,
// at its level, or onto a chapter to put it at the chapter's end; the buttons on a heading's row
// (and Alt+Shift+arrows) move it up / down and promote / demote it; the context menu also adds
// headings. The page runs them (DocumentPanel.send), so Ctrl+Z there undoes them.
import * as vscode from 'vscode';
import type { LoadedWorkspace } from '../model/load';
import { findSection } from '../template/template';
import { readText } from '../workspace';
import { outlineOf } from '../doc/outline';
import { adrTitle, splitAdrText } from '../doc/adr';
import type { HeadingRef, OutlineEdit } from '../doc/protocol';

const DRAG_MIME = 'application/vnd.code.tree.archery.contents';
const HISTORY_ID = 'change-history';

export interface ContentsNode {
  sectionId: string;
  /** Index among the chapter's ## / ### headings; undefined for the chapter itself. */
  index?: number;
  /** 2 for ##, 3 for ###; undefined for chapters and decisions. */
  level?: 2 | 3;
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

/** A heading as the page finds it (index, checked against its text). */
export const headingRef = (node: ContentsNode): HeadingRef => ({ sectionId: node.sectionId, index: node.index!, title: node.title });

export const isHeading = (node: ContentsNode | undefined): node is ContentsNode & { index: number } => node?.index !== undefined;

export class ContentsTreeProvider implements vscode.TreeDataProvider<ContentsNode>, vscode.TreeDragAndDropController<ContentsNode> {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private nodes: ContentsNode[] = [];
  readonly dragMimeTypes = [DRAG_MIME];
  readonly dropMimeTypes = [DRAG_MIME];

  /** @param edit runs an outline edit in the document. */
  constructor(private readonly edit: (edit: OutlineEdit) => void) {}

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
          const node: ContentsNode = { sectionId: s.id, index, level: h.level, number, title: h.title, uri, line: h.line, children: [], parent: owner };
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
      this.nodes.push({ sectionId: HISTORY_ID, number: String(last + 1), title: 'Change history', children: [] });
    }
    this.changed.fire(undefined);
  }

  /** A heading of a chapter by its title and level (after an outline edit renumbered the headings). */
  findHeading(sectionId: string, title: string, level?: number): ContentsNode | undefined {
    const chapter = this.nodes.find((n) => n.sectionId === sectionId);
    const all = chapter?.children.flatMap((c) => [c, ...c.children]) ?? [];
    return all.find((n) => isHeading(n) && n.title === title && (level === undefined || n.level === level));
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
    item.contextValue = contextOf(node);
    item.command = { command: 'archery.openDocument', title: 'Open in the document', arguments: [{ sectionId: node.sectionId, index: node.index, decision: node.decision }] };
    return item;
  }

  getChildren(node?: ContentsNode): ContentsNode[] {
    return node ? node.children : this.nodes;
  }

  getParent(node: ContentsNode): ContentsNode | undefined {
    return node.parent;
  }

  handleDrag(source: readonly ContentsNode[], data: vscode.DataTransfer): void {
    const heading = source.find(isHeading);
    if (heading) data.set(DRAG_MIME, new vscode.DataTransferItem(heading));
  }

  handleDrop(target: ContentsNode | undefined, data: vscode.DataTransfer): void {
    const heading = data.get(DRAG_MIME)?.value as ContentsNode | undefined;
    if (!isHeading(heading) || !target || target.sectionId === HISTORY_ID) return;
    if (isHeading(target)) {
      if (target !== heading) this.edit({ kind: 'move', heading: headingRef(heading), before: headingRef(target) });
    } else this.edit({ kind: 'move', heading: headingRef(heading), into: target.sectionId });
  }
}

/** The headings next to a heading under the same parent: the one before it and the one after it. */
export function siblingsOf(node: ContentsNode): { before?: ContentsNode; after?: ContentsNode } {
  const peers = (node.parent?.children ?? []).filter(isHeading);
  const at = peers.indexOf(node as ContentsNode & { index: number });
  return at < 0 ? {} : { before: peers[at - 1], after: peers[at + 1] };
}

/**
 * For the inline buttons and the context menu (package.json, view/item/context): "chapter",
 * "decision", "generated", or "heading h2" / "heading h3" with what can be done to it: "up" / "down"
 * (a heading before / after it under the same parent), "promotable" (a ###) and "demotable" (a ##
 * with a ## above it to become its parent).
 */
function contextOf(node: ContentsNode): string {
  if (node.decision) return 'decision';
  if (!node.uri) return 'generated';
  if (!isHeading(node)) return 'chapter';
  const { before, after } = siblingsOf(node);
  const flags = [`h${node.level}`, before && 'up', after && 'down', node.level === 3 && 'promotable', node.level === 2 && before && 'demotable'];
  return ['heading', ...flags.filter(Boolean)].join(' ');
}
