# Changelog

## 0.2.0

- **Agents' model edits are shown live.** Adding, renaming or changing an element or relationship brings the diagram that shows it into view and selects it, also while you type in the agent's chat. An open diagram is no longer moved into the chat's tab group.
- **Following pauses while you work.** A click, key or scroll in the document, a diagram or the sidebar pauses following the agent; it resumes 30 seconds after your last action.
- **Better automatic layout.** Superclasses and interfaces above their specializations, base use cases before extensions, initial nodes first and final nodes last, orthogonal regions stacked in their state, containers sized to their name and keywords, room for edge labels, unconnected parts packed in rows, and stable results when run again. Use case diagrams default to left to right.
- **Initialize opens only the document**, not the first chapter's Markdown file.
- **One diagram tab.** Every diagram opens in the same tab, which switches to it; agents creating many diagrams no longer leave a tab for each. An open diagram also no longer stops updating after agent edits.
- **Line shapes.** Each line can be straight, right-angled, curved, or have one corner (across first, or up / down first); right-click a line, the shapes' lines, or the canvas for all lines. Without a choice the diagram style decides, as before.
- **More in the right-click menus:** line shape, remove bend points and reverse direction on lines; add related elements, ball or box notation for interfaces and the lines of the selected shapes on shapes; all lines, what the diagram shows and add missing relationships on the canvas. Submenus open on hover or with the arrow keys.
- **Clearer diagrams.** Lines between the same two shapes are drawn apart, lines meeting one side of a shape are spread along it, labels move along their line to stay off shapes and other labels, note text wraps, long property strings wrap to the box width, tagged values are hidden unless a diagram shows them, «use» and the other line keywords can be hidden, and external systems are marked «external» instead of «actor».
- **Exports:** the document title is the system name (or its own title), the PDF uses black and grays only (text, diagrams, page headers and footers), tables have a thin black grid inside a thicker border, the PDF contents have dotted leaders again, and a last page "About this document" describes the arc42 structure and how the document is made. PNG export of a diagram always shows its current content.
- **For agents:** `batch` (many operations in one all-or-nothing call), `set_line_shape`, `set_project` (system name, title, authors), `delete_diagram`, `rename_diagram`, `update_decision` (status, sections, supersedes), `update_relationship` with `reverse`, display options in `update_diagram`, drawn boxes in `get_diagram` / `move_nodes` / `add_element`, notes inside elements, layout warnings with coordinates in `validate`, a container's relationship left out when a shown part refines it, decision file names cut at a whole word, and nested deployment nodes laid out without overlaps.
- **Sequence and timing diagrams:** a lifeline destroyed and created again gets a new head; timing constraint labels that do not fit their window move above it.

## 0.1.1

- **Claude Code finds Archery without setup.** The MCP server is added to your Claude Code configuration automatically (restart Claude Code once); it no longer depends on the `claude` command being on PATH.
- **Cleaner interface.** Shorter messages, tooltips and empty states.

## 0.1.0

First public release.

- **The arc42 document in one view.** All twelve chapters (and the change history) in one scrolling page with the arc42 guidance one click away. Edit the text, Markdown tables, images and captions in place; generated tables (quality goals, stakeholders, constraints, quality scenarios, risks, glossary) are edited like a spreadsheet and stored as YAML.
- **A model-based UML editor for all 13 UML 2 diagram types.** Elements are defined once in `model.yaml` and placed on any number of diagrams; renaming one renames it everywhere. Canvas diagrams (component, package, deployment, class, object, composite structure, use case, state machine, activity, interaction overview), sequence and communication diagrams, and timing diagrams. Align and distribute, automatic layout, movable labels, drill-down links from a box to the diagram that shows it in detail.
- **Classic and Modern diagram styles**, used everywhere: editors, document and export.
- **Export** to PDF (with page numbers in the contents) or one self-contained HTML file, with font, page, header, footer and contents settings; diagrams as SVG or PNG.
- **Versions:** every change is tracked; release a version with a change log entry (it goes into the document's change history) or restore an earlier release.
- **Claude Code and GitHub Copilot** get the same tools for everything you can do in the document and the editors (chapters, model, diagrams, tables, decisions, versions, export). Their edits are shown live: the chapter or diagram comes into view, then the change lands and is highlighted.
- **Sidebar:** Contents (chapters and headings), Diagrams, and Diagram Tools (the palette and properties of the open diagram).
