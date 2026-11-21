# Changelog

## 0.2.6

- **Edit decisions in the document.** Clicking a row of the architecture decision records opens the decision in a window over the document: title, status, date, decision-makers, the decision it supersedes, the quality goals and constraints it addresses, and its context, decision and consequences, with the optional decision drivers, considered options and confirmation of MADR. "Add row" under the list records a new one there.
- **"Add row" under every table.** Tables written in a chapter now have it too, like the data tables.
- **Links work in the document.** A link to a chapter, a heading, a decision or a diagram goes there; a link to a file of the workspace opens it beside the document (`#L12` selects that line); a web link opens in the browser. Before, a relative link opened the browser on an internal address.
- **No Markdown in the way.** The Contents view no longer has a button that opens a chapter's Markdown file.
- **For agents:** `create_decision` and `update_decision` take `date`, `deciders`, `drivers`, `options` and `confirmation`; `update_decision` with `supersedes: ""` removes the link, and an empty optional part removes it. MADR headings ("Context and Problem Statement", "Decision Outcome") are read as the same parts.

## 0.2.5

- **Routed lines keep their distance.** A line that automatic layout routes around a shape no longer runs along the border of another box, where it looked like part of that box.
- **Leader lines stay off boxes.** Automatic layout no longer moves a label to a spot whose dotted leader line would cross a box.
- **For agents:** `validate` reports lines that run along a box's border (closer than 12) and leader lines that run through a box, with coordinates.

## 0.2.4

- **New logo:** a blueprint of three amber cubes, the top one still a wireframe drawing; in the Extensions view, the activity bar, editor tabs and the chat.

## 0.2.3

- **«use» only where it adds something.** A usage line with a label no longer repeats «use»; a line without a label still shows it. Right-click the canvas → Show to put keywords on every line, or on none.
- **Routed lines start and end at the border.** A line that automatic layout routes around a shape leaves and enters its shapes through their border and stays inside the box that holds both ends, instead of starting inside its own box or running along the box's wall.
- **Labels stay off other lines.** A label is placed where no other line runs through it; automatic layout moves one that still has a line through it.
- **For agents:** `validate` reports lines that run back across their own end and lines that run through another line's label, with coordinates; `show.keywords` takes `"auto"` (the new default) besides `true` and `false`.

## 0.2.2

- **Automatic layout routes lines around shapes.** A line that would run straight through a shape in between gets bend points that go around it, and a label that still covers a shape or another label is moved next to its line (with a dotted leader).
- **Deleting a diagram always deletes its file.** Before, a delete could report success and leave the file on disk while the document was open in VS Code.
- **For agents:** `validate` reports lines that run through a shape, with coordinates; `create_diagram` takes the display options (`show.keywords: false` hides «use» and the other line keywords); `get_diagram` lists the display options with their defaults, and the bend points and moved labels of each line.

## 0.2.1

- **Rename the system in the document.** Click the system name at the top of the contents to change it.
- **Maximized diagrams open in a window over the document.** Esc, the close button or a click outside closes it; it fades in and out.
- **New icon colours:** the target in teal and amber, without a tile, so it reads on light and dark themes.
- **For agents:** `rename_diagram` and `delete_diagram` find chapter embeds that have a caption (renaming updates them; deleting refuses without `force`); `validate` reports chapters that show a missing diagram or table, accepts notes inside an element shown on the diagram, and no longer calls a shape inside a container an overlap.

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
