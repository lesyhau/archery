# Changelog

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
