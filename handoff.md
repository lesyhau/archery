# arc42 Studio — Handoff

A VS Code extension for writing **architecture documents** with a built-in, **model-based UML diagram editor**.

- **Purpose:** personal/internal tool + learning/portfolio project. Not a commercial product.
- **Status:** M0 + M1 + AI integration (Claude Code via MCP, Copilot via LM tools + `@arc42`) implemented 2026-11-17;
  not yet verified by hand in the Extension Development Host. See §11.
- **Date of decision:** 2026-11-17
- **Repo:** https://github.com/lesyhau/arc42-studio (remote `origin`, nothing pushed yet)
- **Reference:** `arc42-template-EN-withhelp-markdown/` (local only, git-ignored) is the official arc42 9.1-EN template with help. It is the
  source of truth for section structure and help texts (see `src/template/template.ts`).

---

## 1. Problem

The author draws many UML diagrams, almost all of them for architecture documents. Existing tools are either too complex
(Enterprise Architect, Visual Paradigm), too simple (Mermaid/PlantUML for some layouts, generic whiteboards), or too
expensive. Word/Confluence templates give no structure and no consistency between sections.

## 2. Core ideas (decided)

1. **Docs-as-code.** Everything is plain text in git: Markdown, YAML and JSON. No binary or proprietary format.
2. **Model-based diagrams.** Elements (components, nodes, actors, classes…) are defined **once** in a shared model.
   Diagrams are **views** that reference model elements and only add layout/styling. Renaming an element updates every
   diagram.
3. **Only the UML that arc42 needs.** Not all 14 UML diagram types:

   | arc42 section | Diagrams |
   |---|---|
   | 3 Context & scope | Context diagram (component/use-case style, with external actors and systems) |
   | 5 Building block view | Component, package; class at the deepest level |
   | 6 Runtime view | Sequence, activity |
   | 7 Deployment view | Deployment |
   | 8 Crosscutting concepts | Class (domain model), state machine |

   Out of scope: timing, interaction overview, communication, composite structure, object, profile, use-case
   (except as context style).
4. **Two editing styles:**
   - **Canvas** (drag-and-drop + palette + auto-layout) for node/edge diagrams: component, package, deployment, class,
     state, activity, context.
   - **Forms + automatic layout** for **sequence diagrams**: add lifelines/messages/fragments in a form, the tool lays
     them out. No hand-dragging of arrows.
5. **Forms for structured arc42 sections**, a normal Markdown editor for prose.
6. **Don't build a canvas engine.** Use React Flow + ELK.js.

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | |
| Extension host | VS Code API, `CustomTextEditorProvider` | Text-backed so git diff + native undo/redo work |
| Bundler | esbuild | Two bundles: extension (node) and webview (browser) |
| Webview UI | React 18 | |
| Canvas | `@xyflow/react` (React Flow, MIT) | UML shapes as custom nodes, UML arrows as custom edges |
| Auto-layout | `elkjs` | Layered layout, supports nested nodes (packages, deployment nodes) |
| Sequence diagrams | Own SVG renderer | Layout is simple to compute |
| Parsing / validation | `yaml`, `zod` | Schemas shared between extension and webview |
| Tests | `vitest` (pure logic), `@vscode/test-electron` (later) | |
| Export | SVG/PNG per diagram; Pandoc for docx/PDF | Pandoc is an external dependency, detect it and explain if missing |

Heavier alternative considered and **rejected for now**: Eclipse GLSP / Sprotty (purpose-built, but steep learning curve).

## 4. Workspace file layout (what a user's project looks like)

```
docs/architecture/
  archery.yaml              # project metadata, section order, enabled sections
  model.yaml              # shared model: elements + relationships
  sections/
    01-introduction-and-goals.md
    02-architecture-constraints.md
    03-context-and-scope.md
    04-solution-strategy.md
    05-building-block-view.md
    06-runtime-view.md
    07-deployment-view.md
    08-crosscutting-concepts.md
    09-architecture-decisions.md
    10-quality-requirements.md
    11-risks-and-technical-debt.md
    12-glossary.md
  data/                   # structured sections edited via forms
    quality-goals.yaml
    quality-scenarios.yaml
    stakeholders.yaml
    constraints.yaml
    risks.yaml
    glossary.yaml
  decisions/              # ADRs, one file each
    0001-use-postgresql.md
  diagrams/
    building-blocks-l1.uml.json
    place-order.seq.json
    production-deployment.uml.json
```

Markdown sections embed diagrams and structured data using directives that the preview/export expands, e.g.:

```markdown
<!-- archery:diagram diagrams/building-blocks-l1.uml.json -->
<!-- archery:table data/stakeholders.yaml -->
```

## 5. Data formats (first draft — refine during M1)

### `model.yaml`

```yaml
elements:
  - id: customer            # stable id, never shown; names can change freely
    kind: actor             # actor | externalSystem | component | interface | package
                            # | node | executionEnvironment | artifact | class | enum
    name: Customer
  - id: orderService
    kind: component
    name: Order Service
    parent: shop            # optional containment (package/component/node nesting)
    stereotype: service     # optional
    description: Accepts and validates orders.
  - id: order
    kind: class
    name: Order
    attributes:
      - { name: id, type: UUID, visibility: "-" }
    operations:
      - { name: total, returns: Money, visibility: "+" }
relationships:
  - id: r1
    kind: dependency        # association | aggregation | composition | generalization
                            # | realization | dependency | usage | connector | deploy
    from: orderService
    to: paymentGateway
    label: charge()
    multiplicity: { from: "1", to: "*" }   # optional, associations only
```

### Canvas diagram (`*.uml.json`)

```json
{
  "version": 1,
  "type": "component",
  "title": "Building blocks — level 1",
  "nodes": [
    { "ref": "orderService", "x": 120, "y": 80, "w": 180, "h": 80 }
  ],
  "edges": [
    { "ref": "r1", "waypoints": [] }
  ],
  "local": { "nodes": [], "edges": [] }
}
```

- `ref` points into `model.yaml`. `local` holds diagram-only items: notes, and the nodes/transitions of
  **state and activity diagrams**, which are kept diagram-local in v1 (not in the shared model).
- Positions are stored in the diagram, never in the model.

### Sequence diagram (`*.seq.json`)

```json
{
  "version": 1,
  "type": "sequence",
  "title": "Place order",
  "lifelines": [ { "ref": "customer" }, { "ref": "orderService" }, { "ref": "paymentGateway" } ],
  "steps": [
    { "msg": { "from": "customer", "to": "orderService", "label": "placeOrder()", "kind": "sync" } },
    { "fragment": "alt", "branches": [
      { "guard": "payment ok", "steps": [ { "msg": { "from": "orderService", "to": "customer", "label": "confirmation", "kind": "reply" } } ] },
      { "guard": "else", "steps": [ { "msg": { "from": "orderService", "to": "customer", "label": "error", "kind": "reply" } } ] }
    ] }
  ]
}
```

Message kinds: `sync | async | reply | create | destroy | self`. Fragments: `alt | opt | loop | par | ref`.

## 6. Extension architecture

```
src/
  extension.ts              # activate(): register editors, tree view, commands
  model/                    # shared, pure TS (also bundled into webview)
    schema.ts               # zod schemas for every file format above
    load.ts                 # load + validate a docs/architecture workspace
    checks.ts               # consistency checks -> VS Code diagnostics
  editors/
    diagramEditor.ts        # CustomTextEditorProvider for *.uml.json
    sequenceEditor.ts       # CustomTextEditorProvider for *.seq.json
    dataEditor.ts           # form editor for data/*.yaml (later)
  views/
    sectionsTree.ts         # sidebar: 12 arc42 sections, diagrams, data, ADRs
  commands/
    init.ts                 # "arc42: Initialize documentation" scaffolds docs/architecture
    export.ts               # SVG/PNG/Pandoc export
webview/
  diagram/                  # React Flow app: UML node + edge components, palette, ELK layout
  sequence/                 # forms + SVG renderer
  shared/                   # messaging, theming (use VS Code CSS variables)
```

**Webview ↔ extension sync (important to get right early):**

- Extension sends `{type: "init" | "documentChanged", text, model}`. The model comes from `model.yaml`, so the webview
  can resolve `ref`s and show names.
- Webview sends `{type: "edit", text}` with the full new file content. The extension applies it via `WorkspaceEdit`.
- Ignore the `onDidChangeTextDocument` event caused by your own edit (compare text or use a version counter), otherwise
  you get an echo loop and the cursor/selection jumps.
- Edits that create/rename elements must also update `model.yaml`. Do both in **one** `WorkspaceEdit` so undo is atomic.
- Theme: style with `var(--vscode-*)` CSS variables so light/dark themes work.

## 7. Milestones

Each milestone should be usable on a real document before starting the next.

| # | Scope | Done when |
|---|---|---|
| **M0** | Scaffold: extension + webview bundles, esbuild watch, F5 debug launch, vitest | Extension Development Host opens and a hello-world webview custom editor works for `*.uml.json` |
| **M1** | `arc42: Initialize` command, file schemas (zod), sections tree view | Running the command in an empty folder creates `docs/architecture/` with all 12 sections; the tree opens each one |
| **M2** | Component + deployment canvas: palette, drag, connect, delete, rename, nesting, ELK auto-layout, SVG export | Can draw section 5 level 1 and section 7 for a real system; the file diffs cleanly in git; undo works |
| **M3** | Sequence editor (forms + SVG auto-layout, alt/opt/loop) | Can produce a section 6 runtime scenario without touching the mouse on the canvas |
| **M4** | Class + state machine diagrams (attributes/operations, visibility, multiplicities, all relationship arrowheads) | Domain model for section 8 looks like correct UML |
| **M5** | Form editors for structured sections: quality goals/scenarios, stakeholders, constraints, ADRs, risks, glossary | Sections 1, 2, 9, 10, 11, 12 are edited via forms and render as tables in the preview |
| **M6** | Consistency checks as diagnostics + export (Markdown preview with embedded diagrams, Pandoc → docx/PDF) | Problems panel shows e.g. "component X is not deployed anywhere"; one command produces a docx |
| **M7** | Activity, package and context diagrams | All diagrams listed in §2.3 are supported |

### Consistency checks (M6 ideas)

- A quality goal has no quality scenario.
- A component appears in no building-block diagram, or is never deployed.
- A diagram `ref` points to a deleted element (also show it in the diagram as a red placeholder).
- A sequence lifeline is not a component/actor/externalSystem.
- An ADR doesn't reference any quality goal or constraint.
- Terms used in sections are not in the glossary (later, optional).

## 8. Open questions (decide while building)

- Extension/package name: `arc42-studio` is a working title.
- Should element ids be auto-generated slugs (from the name) or random? Slugs make diffs readable but must not change
  when an element is renamed.
- When an element is deleted from a diagram, remove only the view, or offer "delete from model"? (Proposal: view only,
  plus an explicit "Delete from model" action that warns if other diagrams use it.)
- How much UML fidelity for class diagrams (generics, abstract/static styling, interfaces as lollipops)?
- PNG export: render in the webview (canvas) or headless? Start with SVG, then use the webview for PNG.

## 9. How to start (next session)

1. `cd D:\Work\arc42-studio && git init`
2. Scaffold M0: `package.json` (with `contributes.customEditors` for `*.uml.json` and `*.seq.json`), `tsconfig.json`,
   `esbuild.mjs` (two entry points), `src/extension.ts`, `webview/diagram/main.tsx`, `.vscode/launch.json`.
3. Install: `react react-dom @xyflow/react elkjs yaml zod`, dev: `typescript esbuild @types/vscode @types/react
   @types/react-dom vitest @vscode/vsce`.
4. Verify F5 opens a sample `*.uml.json` in the custom editor, then continue with M1.

## 10. References

- arc42 template and help: https://arc42.org, https://docs.arc42.org
- VS Code custom editors: https://code.visualstudio.com/api/extension-guides/custom-editors
- VS Code webviews: https://code.visualstudio.com/api/extension-guides/webview
- React Flow: https://reactflow.dev
- ELK.js: https://github.com/kieler/elkjs
- UML 2.5.1 spec (notation reference): https://www.omg.org/spec/UML/2.5.1

## 11. Progress log

### 2026-11-17 — M0 + M1

**Done**

- Scaffold: `package.json` (custom editors for `*.uml.json` / `*.seq.json`, activity-bar view, commands), `tsconfig.json`
  (strict), `esbuild.mjs` (extension bundle + one webview bundle per editor), vitest, `.vscode/launch.json` +
  `tasks.json` (F5 runs `npm: watch` and opens `sample/`).
- `src/model/schema.ts`: zod schemas for `archery.yaml`, `model.yaml`, `*.uml.json`, `*.seq.json`, all `data/*.yaml`
  files, and ADR front matter.
- `src/model/load.ts`: parse + validate with line numbers (YAML via `LineCounter`), `loadWorkspace()` behind an
  injected `WorkspaceReader` so it runs in tests. Issues are published as VS Code diagnostics already.
- `src/template/template.ts`: the 12 sections with subsections and condensed help texts taken from the reference template.
  `src/template/scaffold.ts`: pure generator used by `arc42: Initialize documentation` (never overwrites existing files).
- Sections tree (`src/views/sectionsTree.ts`): sections → their `##` headings (click jumps to line), diagrams, data
  files, decisions, `model.yaml`, `archery.yaml`. Welcome view with an "Initialize" button when no `archery.yaml` exists.
- Diagram editor (M0 level): renders `*.uml.json` with React Flow, resolves names from `model.yaml` (live-reloads on
  change), missing refs shown as red dashed boxes, drag writes positions back via `WorkspaceEdit`. The echo loop is
  avoided with an "expected text" guard in `src/editors/webviewEditor.ts`. Sequence editor is a placeholder.
- `npm run sample` regenerates `sample/docs/architecture` (scaffold + small webshop model/diagrams).
- 15 vitest tests: template structure, scaffold → loads without issues, directives resolve, schema examples from §5.

**Decisions taken (resolve/refine §5 and §8)**

- Section structure follows arc42 9.1-EN exactly: 1.1 Requirements Overview / 1.2 Quality Goals / 1.3 Stakeholders,
  3.1 Business / 3.2 Technical Context, 5 Whitebox Overall System / Level 2 / Level 3, 7 Infrastructure Level 1 / 2,
  10.1 Overview / 10.2 Quality Scenarios. Headings are unnumbered (as in the template); numbering is shown in the tree
  and will come from Pandoc `--number-sections` on export.
- Help texts live in `<!-- archery:help ... -->` comments (hidden in preview/export); "Plain" variant omits them.
- `data/quality-scenarios.yaml` became **`data/quality-requirements.yaml`** with two lists, `overview` (10.1) and
  `scenarios` (10.2). Scenarios support both the short Q42 form (context, stimulus, metric) and the long SEI form
  (source, stimulus, environment, artifact, response, responseMeasure), and link to goals via `goals: [ids]`.
- Directive paths are relative to the documentation root. A `#key` fragment selects a list inside a data file. New directive
  `<!-- archery:decisions decisions -->` for the ADR index in section 9.
- ADRs: `decisions/NNNN-title.md` with YAML front matter (`status`, `date`, `qualityGoals`, `constraints`) so the
  M6 check "ADR references no quality goal or constraint" is possible.
- Init creates two empty starter diagrams: `diagrams/building-blocks-l1.uml.json`, `diagrams/deployment-l1.uml.json`.
- Library versions: `@xyflow/react` pinned to **v12** (v13 is new; v12 API is well known), React 18, zod 4,
  TypeScript 7, vitest 5.

**Gotchas**

- Windows: run vitest from an upper-case drive path (`D:\...`). A lower-case `d:\` cwd makes Node load vitest twice and
  every suite fails with `Cannot read properties of undefined (reading 'config')`.

**Next**

1. Press F5 and verify by hand: tree opens every section; the diagram opens; dragging a node changes the JSON;
   Ctrl+Z restores the position; editing `model.yaml` renames the node live; "Initialize" works in an empty folder.
2. M2: palette, connect, delete, rename (with the atomic two-file `WorkspaceEdit`), nesting, ELK layout, real UML
   shapes for component/deployment, SVG export.

### 2026-11-17 — AI assistant support (Claude Code + GitHub Copilot)

**Requirement:** the extension must support Claude Code and GitHub Copilot. Chosen scope: an MCP server for structured
edits + Copilot-native tools and chat participant. (Not chosen for now: generated AGENTS.md/CLAUDE.md instruction files
in user projects; dev instruction files for this repo.)

**Architecture**

```
src/ops/session.ts   ArcherySession: in-memory snapshot; operations record `changes` (path -> text)
src/ops/tools.ts     18 tool definitions: zod input + agent-facing description + run(session, input)
src/ops/ids.ts       slug ids: "API Gateway" -> apiGateway; relationships "<from>-<to>"; diagrams kebab-case
src/model/checks.ts  cross-file reference checks (planned for M6, needed now by `validate`)
src/model/validate.ts  schemas + reference checks; also feeds the Problems panel
src/mcp/server.ts    MCP stdio server -> dist/mcp.js (Claude Code); writes changes to disk
src/ai/lmTools.ts    Copilot language model tools `arc42_*`; changes applied as one WorkspaceEdit, clean files saved
src/ai/participant.ts  @arc42 chat participant (/check, /section N), tool-calling loop over the arc42 tools
src/ai/claudeCode.ts   copies mcp.js to globalStorage (stable path) + "arc42: Set up Claude Code" command
src/ai/toolManifest.ts generates contributes.languageModelTools (npm run gen:tools; test enforces sync)
```

**Decisions**

- One operations layer, three front-ends (MCP, Copilot tools, later the webview for M2 rename/delete). Do not
  duplicate model-editing logic in the webview.
- Element ids: camelCase slug of the name at creation, unique suffix `2`, `3`, ... Never changed by rename. This answers
  the open question in §8.
- `delete_element` refuses while the element is used; `cascade: true` removes relationships, diagram nodes/edges,
  sequence lifelines and their messages, and re-parents children. Matches the §8 proposal ("view only" removal is
  `remove_from_diagram`).
- YAML is edited through the `yaml` Document API so comments and formatting survive.
- The MCP server is not registered with VS Code (Copilot would see duplicate tools). Claude Code registration: user
  scope via `claude mcp add --scope user arc42 -- node <globalStorage>/mcp.js`, or project `.mcp.json`.

**Verified:** 32 vitest tests (operations, an in-memory MCP client against the server, manifest sync); a stdio smoke test
of the bundled `dist/mcp.js` (initialize, add elements/relationship, diagram, sequence, validate).
**Not verified yet:** Copilot tools and `@arc42` inside VS Code (needs the Extension Development Host + Copilot), the
"Set up Claude Code" command.

**Next:** besides the M0/M1 hand checks above, try in the dev host: Copilot agent mode "add a payment gateway and show
it on the building block diagram", `@arc42 /check`, `@arc42 /section 1`; run the Claude Code setup command and use
`/mcp` in Claude Code.

### 2026-11-17 — Direction change: WYSIWYG document view + versioning

**Feedback:** opening sections as raw Markdown is not what the author wants. The documentation must look like a
published architecture document (reference: `D:\Work\proxyma_workspace\proxyma\docs\architecture.html` — sticky
contents panel, numbered sections, table and figure cards, maximizable figures) and be edited in place: hover shows a
text cursor, click edits, blur auto-saves. Diagrams can be inserted anywhere; frames are resizable,
minimizable/maximizable, and open in the UML editor. Every change is tracked as vX.Y; auto-save raises the minor
version; a release raises the major and resets the minor; rollback to any release.

**Decisions (asked):** release snapshots live in `docs/architecture/.versions/` (no git commits/tags by the extension); the
document view uses the VS Code theme colors with the Proxyma layout.

**Built**

```
src/doc/extensions.ts   TipTap schema: StarterKit + tables + image + directive atom nodes (help, diagram, table, decisions, raw HTML)
src/doc/markdown.ts     Markdown <-> editor doc (markdown-it + prosemirror-markdown); directives become nodes;
                        scaffolded sections round-trip byte-identical (tested)
src/doc/tables.ts       data/*.yaml lists -> table cards (columns follow the arc42 template)
src/render/*            static diagram layouts -> drawing primitives: canvas (UML shapes, arrowheads) and sequence
                        (lifelines, messages, alt/opt/loop/par, ref, notes). Reusable for SVG export (M2/M6).
src/document/documentPanel.ts  the "arc42 Document" webview panel: data snapshot, saves, create/open diagrams
webview/document/*      page: contents panel + scroll spy, toolbar (format, tables, Insert diagram: existing or new),
                        one TipTap editor per section (save on blur), diagram frames (resize/minimize/maximize/edit),
                        lightbox with pan/zoom, help notes (collapsed "arc42 guidance"), generated tables, ADR index
src/versions/history.ts pure version rules (tested); tracker.ts: file watcher -> minor bump (debounced 1.5 s),
                        release (snapshot .versions/vN.0.json), rollback (backup snapshot of the current state first;
                        the restore becomes the next minor version, so numbers never repeat)
media/icon.svg / icon.png  white-on-transparent icon (activity bar + extension); `npm run icon` renders the PNG
```

- Directive syntax extended: `<!-- archery:diagram diagrams/x.uml.json width=640 height=420 collapsed caption="..." -->`.
- Template placeholders (`_<...>_` paragraphs) removed from the scaffold: the editor shows "Click to write…" hints on
  hover instead. Structural labels/tables stay.
- Sidebar: clicking a section or heading opens the document view at that place; "Open Markdown Source" is an inline
  action / context menu entry. Title bar actions: Open Document, Release, Restore. Status bar shows `arc42 vX.Y`.
- Diagram editor now saves after every edit (so changes are versioned like the document's).

**Verified:** 49 vitest tests; the document webview in headless Edge with sample data and a mocked VS Code API
(render in light/dark; type + blur saves only the edited section and keeps help/directives; blur without change does
not save; resize/minimize write directive attributes; maximize/Esc; Edit posts openDiagram; insert diagram at cursor;
no page errors). **Not verified in VS Code yet:** the panel wiring, version tracker, release/rollback dialogs.

**Known limitations / next**
- Generated tables (data/*.yaml) are read-only in the page ("Edit data" opens the YAML) until the M5 form editors.
- Diagram captions come from the diagram title; `caption=` exists in the directive but has no UI yet.
- Editing a section in the page and in the Markdown editor at the same time: last save wins.
- M2 (canvas editing) should reuse `src/render/canvasLayout.ts` shapes for React Flow nodes so editor and document
  look identical.

### 2026-11-18 - All planned UML (M2, M3, M4, M7 + notation gaps)

**Request:** "Implement all" (everything in scope + the notation gaps listed before); canvas editing must support
snap to grid and show/hide grid. Still out of scope: XMI, OCL, profiles, and the 7 UML diagram types arc42 does not use.

**Model/format additions (src/model/schema.ts):** element kinds usecase, port, datatype, naryAssociation; typeParams
(generics), derived attributes; relationship stereotype, roles, qualifier, navigable, associationClass; node
`style.notation: lollipop`; local node kinds for state machines (state, initial, final, choice, junction, fork, join,
history, deepHistory, terminate) and activities (action, activityFinal, flowFinal, decision, merge, object, partition,
sendSignal, acceptEvent) + note; local edges transition/flow/anchor; sequence messages lost/found (optional ends),
all 12 fragment operators, constraint steps. Canvas positions are absolute, also for nested nodes.

**Rendering (src/render/):** one renderer for document, editors and export. Containers grow around children; ports
snap to their component border; lollipop + socket; use-case ellipses; association adornments; association-class link;
all state/activity shapes; composite states and swimlanes. Sequence: activation bars (sync opens, reply closes),
created participants' heads at the create message, destroy ends the lifeline, lost/found dots, constraints.
Paths only use M/L/C/Z (arc commands were corrupted by scene normalization - fixed, tested). `svgExport.ts` writes
standalone SVG.

**Operations (src/ops/tools.ts, 28 tools total):** new update_relationship, update_diagram, move_nodes, set_node_style,
add_local_node, update_local_node, add_local_edge, update_local_edge, set_edge_waypoints, auto_layout (ELK, hierarchical,
`src/ops/autoLayout.ts`); add_element can place on a diagram; add_relationship takes all adornments; remove_from_diagram
handles local items. Same tools for the editors, Claude Code (MCP) and Copilot.

**Editors:** canvas editor (webview/diagram: palette per diagram type + existing model elements, drag/drop incl.
reparenting into containers, connect anywhere on a node + relationship menu, inline rename, resize, bend points,
properties panel with UML member text syntax `src/model/umlText.ts`, auto layout, fit, snap/grid toggles stored in
settings `arc42.canvas.snapToGrid|showGrid|gridSize`, SVG/PNG export). Every edit is an operation applied by the
extension as one WorkspaceEdit across model.yaml + diagram. Sequence editor (webview/sequence): forms + live preview,
debounced write_sequence_diagram. Commands: arc42.newDiagram, arc42.exportDiagram (editor title button, tree context).

**Verified:** 61 vitest tests; headless Edge suites with the real operation layer in the page: 14 editor interactions
(add+rename, drag+snap, connect+kind, edge label, bend point, stereotype, grid/snap toggles, auto layout, Delete vs
Shift+Delete, re-add from model, state machine build + transition, sequence message + kind + loop fragment) and 7
document interactions; figures of all six sample diagrams checked visually.
**Not verified in VS Code yet:** WorkspaceEdit/undo across model.yaml + diagram from the editor, export dialogs, PNG
rendering via webview, settings persistence, delete-from-model confirmation.

**Sample:** `npm run sample` now builds the webshop through the operations: building blocks (package, port, lollipop/
socket), deployment (nested nodes, artifacts), domain model (generics, enum, association class, qualifier, roles),
order lifecycle state machine (composite state, choice, history), checkout activity (swimlanes, decision, fork/join,
signals), place-order sequence (activations, constraint, lost message). It must pass `validate`.

### 2026-11-18 - Icon, document view feedback, editable tables, change history

- **Icon:** option 4 "UML component" (picked from 10 candidates). `media/icon.svg` (filled shapes only) is the source;
  `npm run icon` renders `media/icon.png` and the icon font `media/arc42-icons.woff`, contributed as custom icon
  `arc42-logo` and used in the status bar (`$(arc42-logo) arc42 vX.Y`). Activity bar uses the SVG.
- **Document view:** layout starts at the left edge (no centering gap); active contents entry = brighter text + weight
  (no fill); section numbers plain like "1.1" (no badge); arc42 guidance = info icon at the end of the heading with a
  hover/focus tooltip (ProseMirror widget decoration; the help block stays in the Markdown, hidden in the page).
- **Change history:** read-only table under the title (Version | Date | Author | Changes), built from release entries
  in `.versions/history.yaml`. Release now requires a change log; author = `git config user.name` (else OS user).
  Restore stays in the status bar menu / sidebar title.
- **Editable tables:** data tables (data/*.yaml) are edited in place (`webview/document/DataGrid.tsx`): cells (Enter /
  Tab / Esc), rows (add, insert above/below, move, delete), columns (add custom, insert left/right, move, rename,
  hide arc42 fields / delete custom ones, show hidden fields), images pasted into cells, Markdown in cells. Saved with
  the new `write_data_table` operation (29 tools now): typed fields, generated ids, row/column error messages, column
  layout in the file's `views:` section. Field catalog: `src/doc/dataLists.ts`.
  Markdown tables in prose: insert/move/delete rows and columns from the toolbar (`moveTablePart`).
- **Images:** paste/drop/toolbar "Image" in sections and table cells; saved to `docs/architecture/images/`.
- **Canvas editor fixes found by testing:** clicking a palette item places the element at the nearest free spot (no
  auto-nesting; dropping still nests); selected edges are drawn above nodes so bend-point handles are reachable.
- **Verified:** 67 unit tests; headless Edge: 14 editor checks, 15 document checks (incl. change history, guidance
  tooltip, grid cell/row/column editing, validation error, prose table row move). Not verified in VS Code: release
  dialog with change log, image saving to disk, the icon font in the real status bar.

### 2026-11-18 - Round 3 feedback: editor window, tables, toolbar, contents

- **Activity bar icon cache:** VS Code kept the old SVG (same path + version). The activity bar now uses
  `media/activitybar.svg` and the version is 0.1.0 (`arc42-studio-0.1.0.vsix`).
- **No "..." in buttons/menus** anywhere (user preference, recorded in memory).
- **Contents panel:** dotted leader from title to caret, dotted tree lines for subsections; **Change history** is the
  last part of the document and the last contents entry (button "Release").
- **Toolbar:** SVG icons; paragraph style menu (Paragraph, Heading 2-4), bold, italic, strike, code, link, clear
  formatting, bulleted/numbered list, indent/outdent, quote, code block, divider, table, image, diagram menu, undo/redo.
  Inside a table a second row: insert/move/delete rows and columns, merge/split cells, delete table.
- **Merged cells in prose tables:** written as an HTML `<table>` with colspan/rowspan (`src/doc/htmlTable.ts`) and read
  back as an editable table; plain GFM again once nothing is merged.
- **Data tables (DataGrid):** no menu columns. Hover "+" on column/row boundaries inserts; drag a header (hand cursor)
  or a row grip to move; right-click header/cell for rename, insert, hide/delete, delete row, merge/unmerge; drag or
  shift-click to select a range. Menus are portaled to the page (never clipped). "Delete table" removes the directive
  (entries kept, Ctrl+Z restores). Merges are stored in `views.<key>.merges` (keyed by the row's key field) and are
  dropped when the covered cells stop matching. Table/ADR node views use `stopEvent: () => true` so ProseMirror does
  not steal focus from cell editors.
- **Decisions:** info icon with ADR guidance instead of opening a file; "New decision" creates
  `decisions/NNNN-slug.md` from a template.
- **UML editor window:** editing a diagram (frame pencil, double-click, lightbox, new diagram, sidebar click) opens a
  resizable, maximizable window over the document. The canvas/sequence editors are components
  (`webview/diagram/CanvasEditor.tsx`, `webview/sequence/SequenceEditor.tsx`) behind a host interface
  (`webview/shared/host.ts`); the window renders them in a shadow root with their own stylesheet and React root, and
  routes operations through the document panel (`op` with `diagram`). Standalone custom editors still work for files
  opened directly. File names are not shown to users.
- **Verified:** 71 unit tests; headless Edge suites: editors 14, document 7 + 6 + 15 (new: contents, ellipses,
  toolbar, grid hover-insert/drag/context menu/merge, delete table, ADR info, prose merge, editor window incl. adding
  an element through the window and the sequence editor in the window).

### Round 5 (contents outline, table edges, diagram view controls)

- **Contents panel:** numbers right-aligned in a 2ch column (two-digit numbers start under the system name); tree
  line under the last digit; no fills in any state (hover only brightens text/icons); "Change history" is chapter
  13 (last numbered section + 1). Expand/collapse animates (grid 0fr -> 1fr, rotating chevron). A clicked entry
  becomes active and stays active until the user scrolls by hand; at the page bottom the last chapter is active.
  The panel's right edge resizes it (180-560px, remembered per viewer in localStorage).
- **Heading outline** (`webview/document/outline.ts`, `Toc.tsx`): the panel lists `##` and `###` (n.m / n.m.k,
  `###` numbered in the document too). Drag a heading (pointer drag, insertion line) to move it with its
  subsections, also onto another chapter row (appended there). Right-click: add heading after, add subheading,
  promote, demote; chapter rows: add subsection. All edits are editor transactions (Ctrl+Z) saved like typing.
  Clicking a subheading activates it (the scroll spy also tracks subheadings). Chapter rows: collapsed -> expand
  and go there; expanded but not active -> go there; expanded and active -> collapse; the chevron is only an
  indicator. Tree ticks, leaders and chevrons sit on the first line of wrapped titles (hanging indent).
- **Data tables:** header click renames, Ctrl/Cmd+drag on a header or cell moves the column/row (grip still works);
  the remove button is an x icon. Hovering a column/row boundary lights the whole edge with a big filled "+" in its
  middle (inserts); dragging an inner column edge resizes the two neighbors (widths saved as percent in
  `views.<key>.columns[].width`, fixed table layout).
- **Diagram view controls** (`webview/document/panZoom.tsx`): frames and the maximized view share zoom out / % /
  zoom in / Fit / Fill / 1:1. Frames pan by drag, zoom with Ctrl+wheel (plain wheel scrolls the page) and size
  themselves to the fitted diagram unless a height was saved.

### Round 6 (captions, table edges, editing, panel chrome)

- **Captions:** document-wide CSS counters (`archery-table`, `archery-diagram`, `archery-figure`, reset on `.content`)
  number every data table and Markdown table ("Table N"), diagram ("Diagram N", in the frame title) and image
  ("Figure N", under the image). Titles are edited in place (`webview/document/Caption.tsx`) and stored as:
  data table `<!-- archery:table ... caption="..." -->` (null = list name), Markdown table
  `<!-- archery:caption "..." -->` right before the table (`CaptionedTable` attr, `TableCaptions` widget), diagram
  `caption=` (null = diagram title), image = alt text (`ImageFigure` node view).
- **Table edges:** the edge highlight is a fixed layer (portal) so the line and "+" stay centered on the outer
  edges too, without covering cell text or making the table scroll; it clears on scroll.
- **Cell / header editing:** the editor lies over the cell (`position: absolute; inset: 0; padding: inherit`) with
  the cell's content kept hidden underneath for its size, so opening an editor changes no size, padding or
  position; while typing, the hidden copy follows the text so the cell grows.
- **Contents panel:** right-click menu replaces the hover icons; subheadings become active (click and scroll
  spy); chapter click expands / activates / collapses (chevron is an indicator). Equal 24px gutters (VS Code's
  default body padding is zeroed), subtitle "Architecture Design Document · vX.Y", footer "Structure based on the
  arc42 template." at the bottom of the panel.
- **Names:** document tab "<System> - Architecture Design Document - arc42 Studio"; status bar "arc42 Studio"
  (version in the tooltip and the version menu title).

### Round 7 (rename to Archery, export)

- **Name:** the extension is **Archery** ("agent-ready architecture docs"; repo https://github.com/lesyhau/archery).
  Everything the tool owns was renamed: extension id `archery`, commands/settings/views/contexts `archery.*`,
  chat participant `@archery`, Copilot tools `archery_*`, MCP server `archery` (env `ARCHERY_ROOT`), project file
  `archery.yaml`, default folder `docs/architecture/`, directives `<!-- archery:help|diagram|table|decisions|caption -->`,
  code identifiers (`ArcherySession`, `archeryDiagram`, ...), `src/template/` (was `src/arc42/`), icon font
  `media/archery-icons.woff` / `$(archery-logo)`. Only references to the arc42 *template* keep its name
  (attribution, section titles/help, "arc42 section", template fields). Earlier rounds above use the old names.
- **Icon:** a blueprint of three amber honeycomb cells, two built as cubes and the top one still a wireframe (`scripts/build-icon.mjs` draws it and writes `media/icon.svg`, `icon.png`, the logos and the icon font: `npm run icon`).
- **Export** (`archery.exportDocument`, toolbar Export menu, view title, version menu): `src/export/documentHtml.ts`
  renders one self-contained HTML (contents, numbered chapters/headings, diagrams as inline SVG, data tables, ADR
  index, images as data URIs, numbered captions, change history; guidance left out; print CSS with A4 pages and a
  page break per chapter). PDF = that HTML printed by an installed Edge/Chrome/Chromium/Brave in headless mode
  (`archery.export.browserPath` to override). `src/document/content.ts` loads the document for both the panel and
  the export. `ARCHERY_EXPORT_OUT=file.html npx vitest run test/exportHtml.test.ts` writes the sample export.
- **Branches:** `main` = tagged production releases (`vX.Y`), `dev` = integration, work on `feature/`, `bugfix/`,
  `chore/` branches (see README).

### Round 8 (README, UML editor redesign)

- **README** rewritten after the git-lanes style (centered icon, screenshot `docs/screenshot.png`, Install, Features,
  AI assistants, project layout, Settings, Development with code map, Releasing). No LICENSE yet (`npm run package`
  warns until one is added). Export moved from the document toolbar to the contents panel head (next to the system
  name) so the editing toolbar stays on one row.
- **Model details** (`ElementSchema`): `technology`, `version`, `instances`, `responsibilities`, `goals` (actors),
  `scenario` (use cases: trigger, preconditions, steps, alternatives {when, steps}, postconditions),
  `constraints`, `tags`. `update_element` takes all element fields (nullable) incl. `typeParams` (was silently
  dropped before). `update_diagram` can change a canvas diagram's `type`.
- **Usage index** (`src/model/usage.ts`): diagrams -> element/relationship refs; sent with the model to the
  standalone editors (`model.diagrams`) and built from DocumentData in the document window. Host gained
  `diagrams` and `openDiagram(file)` (`openDiagram` message -> `vscode.openWith`).
- **Canvas editor** (`webview/diagram/`): `Rail.tsx` (icons only: diagram types, add, connect tools incl. note
  link, model flyout), `Inspector.tsx` (diagram overview / element details, relations grouped by meaning with
  quick-adds, scenario editor, scenarios and diagrams, constraints, tags / relationship ends / local nodes and edges /
  multi-select align and distribute), `umlIcons.tsx` (all icons), `CanvasEditor.tsx` (icon toolbar, view modes:
  Fit default and kept on resize until the user zooms/pans, Fill, 100%, Center, zoom with accumulating clicks;
  scroll pans, Ctrl+scroll zooms, drag selects, Space/middle drag pans; click-click connect tools; arrows nudge
  (debounced save; React Flow's own keyboard moves disabled); Ctrl+A, Esc, Shift+1/2/0, +/-; context menus;
  minimap). `Properties.tsx` was replaced.
- **Sequence editor:** the preview uses the shared pan/zoom (`webview/document/panZoom.tsx`, now with Center and
  wheel panning) and the same icon toolbar; the document frames and the maximized view got Center too.

### Round 9 (license, canvas-style sequence editor)

- **License:** MIT for the code (`LICENSE`, `package.json`), with a third-party section: the arc42 structure and
  guidance texts Archery ships (`src/template/template.ts`) and writes into new documentation are adapted from the
  arc42 template and stay CC BY-SA 4.0 (arc42.org/license). `ARC42_ATTRIBUTION` (written into archery.yaml) names
  the license. The VSIX includes LICENSE; `npm run package` no longer needs `--skip-license`.
- **Sequence editor** (`webview/sequence/`): canvas style like the class/component editor. `SequenceEditor.tsx`
  (rail: new participants, model flyout, select + 8 message tools, fragment / ref / note / constraint tools;
  diagram with pan / zoom (Fit default); click lifelines to add a step at the clicked height, also inside operands;
  click to select, Shift+click for sibling ranges, double-click / F2 inline label editing, drag a header to reorder
  participants; Up/Down, Alt+Up/Down, Delete, Esc), `SeqInspector.tsx` (diagram outline, participant, message
  kind / ends / swap, fragment operator chips + operands, ref / note / constraint with "over" chips, group / ungroup),
  `steps.ts` (path-based immutable edits of the step tree). Hit areas come from `layoutSequenceWithHits`
  (`src/render/sequenceLayout.ts`, offsets via `normalizeWithOffset`). The bundle imports `../diagram/diagram.css`
  for the shared chrome.
- `add_element` with a sequence diagram (also the editor's injected default) adds the element as the last lifeline.

### Round 10 (slim sidebar, UML 2.0 conformance)

- **Sidebar** (`src/views/diagramsTree.ts`, view `archery.diagrams`): only the diagrams, each with the chapter(s)
  that show it or "not in the document"; clicking the activity bar icon opens the document; title buttons Open /
  New diagram / Export, Release / Restore / Refresh in the overflow; welcome views for "no documentation" and "no
  diagrams". The export button in the contents panel is the icon alone.
- **UML 2.0 review** against the Superstructure (formal/05-07-04), fixes:
  - kind keyword *and* stereotype (`keywordText`: «interface» «service»); «component» on components;
    «executionEnvironment» spelling; an external system is an «actor» rectangle (UML has no "external system");
  - «use» on usage edges, «deploy» on deployments, plus any stereotype (`relationshipKeywords`);
  - `{technology=…, version=…, tag=value}` and `{constraint}` lines under the name (`propertyLines`), instance
    multiplicity in the top right corner; containers grow their header for them;
  - package name in the tab only when members are shown, otherwise in the body with the keyword above it;
  - a component holding use cases is the subject: plain rectangle, name at the top (`LaidOutNode.subject`);
  - sequence lifelines `role : Type` (`lifelines[].role`, `write_sequence_diagram.roles`), anonymous `:Type`;
    `{constraints}` centered on their lifeline; `async: true` for self / lost / found messages (open arrowhead;
    lost/found no longer hard-code a filled head).
- Remaining gaps (by value): deployment instances / «manifest»; standalone required-interface sockets, port and part
  `name : Type [n]`; state machine regions and entry/exit points; activity pins, accept time event, interruptible
  regions; sequence duration/time constraints, `sd` frame with gates, `loop(min,max)`; use case extension points and
  include/extend as relationship kinds; communication diagrams.

### Round 11 (all 13 UML 2.0 diagram types)

- **Object, composite structure, interaction overview** are canvas types (`object`, `composite`,
  `interactionOverview`). New element kinds `instance` (with `classifier` and `slots`), `part` (`multiplicity`,
  `reference`), `collaboration`, `collaborationUse`; relationship kinds `link`, `manifest`; local nodes
  `interactionUse` (ref frame) and `interaction` (sd frame), both with `diagram` linking to the interaction they
  stand for (inspector "Open", context menu "Open the linked diagram").
- **Communication** is a second notation of the interaction file: `*.seq.json` with `notation: "communication"`
  and optional `positions`. `src/render/communicationLayout.ts` numbers messages by call nesting (replies close an
  activation and are not drawn; guards `[g]`, loops `*[g]`). The sequence editor has a notation switch in its
  toolbar; boxes are dragged to place them; the fragment/ref/note/constraint tools are disabled there.
- **Timing** is its own file type, `*.timing.json` (schema `TimingDiagramSchema`: `unit`, `end?`, `tick?`,
  `lifelines[{ref, role?, form?: state|value, states, changes[{at, state}]}]`, `messages[{from, to, at, arrive?,
  label, kind}]`, `constraints[{on, from, to?, label}]`). Layout `src/render/timingLayout.ts`; editor
  `webview/timing/` (shares the sequence bundle; `webview/sequence/main.tsx` picks the editor by file name);
  custom editor `archery.timingEditor`; op `write_timing_diagram`; `add_element`, `get_diagram`,
  `update_diagram`, `delete_element` (cascade) and validation know the file type.
- Shared dispatch: `src/render/docDiagram.ts` (`docDiagramScene`, `editorViewType`) and
  `newDiagramInput` in `src/commands/newDiagram.ts`.
- Sample: "Example order" (object, ch. 8), "Order service internals" (composite, ch. 5), "Order flow"
  (interaction overview), "Place order (communication)" and "Place order timing" (ch. 6).
- Remaining gaps: state machine regions and entry/exit points; activity pins, accept time event, interruptible
  regions; sequence `sd` frame with gates and `loop(min,max)`; use case extension points; timing diagram gates and
  messages between a lifeline and itself drawn as a loop.

### Round 12 (the remaining UML 2.0 details)

- **State machines:** local node kinds `region` (child of a state; `layoutNodes` stretches regions to the state's
  width and stacks them under the name compartment, `LaidOutNode.separator` draws the dashed line between them),
  `entryPoint` / `exitPoint` (snapped to the parent state's border like ports; `LaidOutNode.side` puts the name
  outside).
- **Activities:** `pin` (on its parent action's border; pins don't make the action a container),
  `acceptTimeEvent` (hourglass, name below), `interruptibleRegion` (dashed rounded container), local edge kind
  `interrupt` (lightning bolt; rail tool "Interrupting edge" on activity diagrams). Containment rules for drops:
  `canContainLocal` in `webview/diagram/CanvasEditor.tsx`.
- **Use cases:** `extensionPoints` on use case elements (compartment under a line in the ellipse); relationships
  get `condition` and `extensionPoint` for «extend», drawn as a note attached to the relationship.
- **Interactions:** sequence and communication diagrams have an `sd name` frame; `gate: true` on lost / found
  messages runs them to the frame border instead of a dot; `loop` fragments take `min` / `max` (`loop(1,3)`,
  `max: "*"`).
- **Timing:** messages may leave out `from` or `to` (a gate on the right frame edge); `from === to` is drawn as a
  self loop.
- Sample: Fulfilment (two regions, entry/exit points) in the order lifecycle; pin, time event and interruptible
  region in Checkout; `loop(1,3)` and a gate in Place order; "Shopping use cases" in chapter 3.
- Tests: `test/umlDetails.test.ts`; browser checks in the scratchpad harness (`details.mjs`).

### Round 13 (Modern diagram style, export options)

- **Diagram style** (`archery.diagramStyle`: classic | modern, carried in `CanvasSettings.diagramStyle`). Layouts take
  a `DiagramStyle` (`layoutCanvas`, `layoutSequence(WithHits)`, `layoutCommunication(WithHits)`, `layoutTiming(WithHits)`,
  `layoutInteraction`, `docDiagramScene`, `relationshipPrims`, `localEdgePrims`, `edgePoints`, `headPath`) and mark
  the scene (`Scene.style`). Modern: `roundCorners` (rect radius min(6, short side / 4)), `orthoRoute` (straight
  where boxes overlap, Z-route along the axis with more room, one turn when neither has room; only without
  waypoints; dragging a handle turns the route's corners into waypoints), `polylineD` rounded corners (8px lines,
  6px self messages, 4px timing steps), smaller heads, muted italic line labels, 6px solid activation bars,
  1px outlines with round caps (`strokeWidthOf`, renderers SceneSvg / svgExport / flow.tsx).
- **Export options** (`archery.yaml` `export`, `ExportSettingsSchema`; defaults and margin slots in
  `src/export/exportSettings.ts`): font, heading font, base size (pt), page size / orientation / margins, header and
  footer ("left | center | right", placeholders), page numbers (slot + format), contents depth 0-4, cover,
  numbered headings (now down to h4), chapter breaks, change history. The diagram style is only the extension
  setting `archery.diagramStyle` (no per-export override). Rendered with CSS page
  margin boxes (`pageCss`, `cssContent`), so they show in the PDF; the cover page has none. Edge/Chrome also get
  `--generate-pdf-document-outline` (bookmarks). The document view's Export button opens `ExportDialog.tsx` (live page
  preview); exporting saves the choices to archery.yaml, then runs `archery.exportDocument(format, settings)`.
- Not done: page numbers inside the table of contents (Chromium has no `target-counter`); running chapter titles
  in headers (no `string-set`).
- Round 13 follow-ups:
  - Modern uses one corner radius (`MODERN_CORNER` = 6, a quarter of the short side on small shapes) for every
    box, whatever the classic radius; polygons marked `round` (send signal, accept event, decision) get the same
    via `roundedPolygonD`. Object nodes are `sharp` (UML tells them from actions by the square corners).
  - Modern lines use only the four side ports of a shape (`portOf`, `portToward`): no bend points -> right-angle
    route between facing ports (`orthoRoute`; straight when the ports are within 6px); with bend points -> the
    port facing the nearest bend point.
  - Modern fills element bodies with the `node` paint (`fillShapes`); containers stay open; external systems,
    grey in Classic, stay open as the things outside the system.
  - Communication message arrows are 28px (UML 14.4: arrow parallel to the link, toward the receiver); stacked
    labels read in number order.
  - Document: a diagram frame shows only its caption at rest; border, header line and tools on hover, focus or
    selection (`.diagram-frame`).
  - The export dialog: one section per topic, real dropdowns with an inset chevron (`.xd-select`), "Other font"
    for any installed font; the diagram style is only the extension setting.

- Round 14: movable labels and adjustable lines.
  - Edge labels and the outer names of local nodes (entry / exit points, pins, decisions, time events) are
    movable: `labelOffset` (offset from the default place) on diagram edges, local edges and local nodes; tool
    `set_label_offset` (null resets). `placeLabel` in canvasLayout.ts draws a dotted leader (`line.dotted`) from
    the label's box to the nearest point of its line (`nearestOnPolyline`) or shape once it is away from it.
    Editor: `.label-grip` over the movable text (`useLabelDrag` in flow.tsx); "Reset label position" in the
    context menu and the inspector. Auto-layout resets edge label offsets.
  - Modern: a selected line shows a grip on each straight part; dragging moves that part across its direction
    (`moveSegment`): neighbours stretch, ports stay (end parts jog from a 16px stub), redundant points dropped.
    Double-click a grip (or "Automatic route", formerly "Straighten" in Modern) for the automatic route.
  - Editor edges get `zIndex` just above the deepest container they live in (`edgeZ`), so a composite state no
    longer hides its own transitions; shapes at that level stay on top (their labels stay grabbable).
- Round 15: sidebar contents, editor tabs, docked tools, captions below diagrams.
  - Sidebar views: **Contents** (`src/views/contentsTree.ts`: chapters, then their ## / ### headings numbered like
    the document; parsing in `src/doc/outline.ts`; click -> `archery.openDocument({ sectionId, index })`, the reveal
    message takes a heading `index`; the document posts `activeSection` and the tree selects it while the view is
    visible; "Open Markdown Source" inline), **Diagrams**, **Diagram Tools** (webview view). Title actions moved to
    Contents; clicking the Archery icon still opens the document.
  - Narrow document (< 860px): the contents panel is hidden.
  - Diagrams open in their own editor tab (`DocumentPanel.editDiagram(uri)` -> `vscode.openWith`, active group);
    the document's shadow-root editor window (DiagramWindow.tsx) and `editorCss` are gone; the document posts
    `openDiagram`.
  - Docked panels (`webview/shared/remote.ts`, `src/views/toolsView.ts`, `webview/tools/main.tsx`): while the
    Diagram Tools view is visible, editors get `docked: true`, hide their rail and inspector, and render
    `<DockPanels>` which posts the panels' props as data (functions -> `{ $fn: path }`); the view decodes them into
    the same components (Rail / Inspector, SeqRail / SeqInspector, TimingRail / TimingInspector) and sends
    `panelCall`s back through the extension to the active tab (`tabGroups` decides which). Panel callbacks must not
    return values (Inspector takes `canvasRefs` instead of `onCanvas()`); the sidebar palette adds by click (no
    drag across webviews). Sequence / timing rails were extracted into `SeqRail` / `TimingRail`.
  - Document diagram figures: no minimize button (the `collapsed` attribute is ignored); the caption is a
    `figcaption.diagram-caption` centered below the frame; the tools float over the top right corner on hover with
    a drag grip. The HTML / PDF export also puts diagram captions below, centered.
- Round 16: drill-down links between diagrams.
  - `Element.detail`: the diagram (root-relative path) that shows the element in detail. `add_element` /
    `update_element` take `detail` (any diagram name `resolveDiagram` accepts, null clears); validation warns when
    it is not a diagram of the documentation.
  - Rendering: `detailMarker(box, file)` / `detailOf(element, self, lollipop)` in canvasLayout.ts draw the UML rake
    in the bottom-right corner plus a hit `rect` with `link` (no stroke / fill). Not on the detail diagram itself:
    `layoutCanvas(..., file)` and `docDiagramScene(..., src)` take the diagram's own path. Marker paths use M/L
    pairs only (normalize() shifts paths pair by pair).
  - Renderers: `drawPrim` / `SceneSvg` take `onLink` (without it link rects draw nothing); `sceneToSvg` takes
    `link(file) -> href` and wraps the hit area in `<a>`. Editor: click the marker -> `host.openDiagram`; context
    menu "Open the detail diagram"; inspector section "Detailed in" (select + Open), and "Shows in detail" on the
    diagram. The editor finds its own path by matching `fileName` against `host.diagrams`. Document: figures carry
    `data-src`; `showDetail()` scrolls to the first figure of that diagram and flashes it (outline animation), else
    opens the editor; also from the lightbox. Export: figures get `id="diagram-<name>"` (first occurrence) and
    markers link there. Sample: Order Service -> order-service-internals. Canvas diagrams only (lifelines have no
    marker yet).
- Round 17: captions, table controls, alignment, diagram panels, palette labels.
  - Table captions centered above the table with a gap (data tables: `.table-figure > .table-caption`, the card is
    `.grid-card`; Markdown tables: the `.cap-block` widget); image figures centered with the caption below like
    diagrams; export CSS matches. Vertical lines between columns (`border-right`, not on the last cell).
  - `webview/document/tableControls.ts`: one DOM layer per host (DataGrid figure, or the section editor's parent for
    Markdown tables via the `TableControls` plugin in editorTools.ts): row grip left / delete right, column grip
    above / delete below, table delete beside the header row; hit-testing by geometry on window pointermove (the
    gutters count). Markdown tables only `.tableWrapper > table` (data tables render inside the same editor).
    `.section-body > .node-archeryTable` / `.tableWrapper` keep 30px below for the column buttons; narrow layout
    indents tables 12px so the gutters fit.
  - Align / distribute (`ALIGN_ACTIONS` in Inspector.tsx): toolbar group while 2+ shapes are selected, context menu
    on a multi-selection, inspector. No grid snapping; ports / pins / entry-exit points are left out (`onBorder`).
  - Diagrams open in Archery panels (`WebviewDiagramEditorProvider.openPanel`, view type `archery.diagram`) titled
    with the diagram (no file name or breadcrumb), icon media/diagram-*.svg, restored by a panel serializer (the
    webview stores `fileName` in its state). Custom editors stay for Open With (priority option, so opening the file
    shows its JSON). Panels have their own undo / redo (src/editors/history.ts: every operation records the files'
    contents before / after; Ctrl+Z / Ctrl+Y outside text fields post `undo` / `redo`). The Diagram Tools view finds
    the active panel by `panel.active` / the last active one (a webview tab carries no file). Diagrams view: "Open
    Source" (inline and context menu). `diagramName(file)` (src/model/usage.ts) replaces file names as fallback titles.
  - Palettes: `.rail-label` on every button; container query on `.rail` (>= 160px: icon and name in columns of
    136px; the sidebar shows names from 250px, two columns). In-tab width `--rail-width` (default
    clamp(76px, 14vw, 210px)), `RailResizer` splitter (drag, double-click resets; localStorage). `keepInWindow`
    keeps the model pop-out inside the window.
  - Data tables: double-click a column line (`fitColumn` in DataGrid.tsx) fits the column left of it to its widest
    cell on one line (probe element in each cell); its right neighbour (or, at the outer right edge, its left one)
    trades the width, as when dragging. Markdown tables have no stored widths, so no resizing there.
  - arc42 guidance pop-ups (`installHelpPopups` in editorTools.ts, installed by main.tsx): pointing at, focusing or
    clicking a `.help-icon` adds `.open`; it stays until a mousedown outside the icon / pop-up or Esc; one at a time.
- Round 18: agent parity, live view, export polish.
  - New shared tools (src/ops/tools.ts; 41 + initialize): get_section, write_section, edit_section,
    insert_into_section (diagram / table / decisions directive under a heading), create_decision, align_nodes
    (src/ops/align.ts, also used by the editor), and host tools list_versions, release_version, restore_version,
    export_document, export_diagram. Host tools need `session.host` (ToolHost in session.ts): Copilot gets
    `extensionHost` (src/live/host.ts) in process; the MCP server gets it over the bridge, else an OpError says to
    open VS Code. The session now loads section and decision bodies.
  - Bridge (src/live/bridge.ts, bridgeProtocol.ts, src/mcp/bridgeClient.ts): the window listens on 127.0.0.1 with a
    random token and writes {port, token, pid} to <tmp>/archery-bridge/<sha1(root)>.json; the MCP server sends
    `apply` (its change set) and `host` calls; no bridge or a failure -> it writes the files itself.
  - Live view (src/live/liveView.ts, `applyLive`, queued): diagram change -> document `follow` to the figure of the
    chapter that shows it, pause, open the diagram panel (preserveFocus), apply (recorded in the panel history),
    `highlight` the changed ids (diff of the diagram JSON and model.yaml); chapter change -> `follow` with the heading
    above the first changed line and `edit: true`, pause, apply -> the section editor highlights the first changed
    block (LiveFlash decoration in editorTools.ts; empty placeholder paragraphs ignored); data -> the table first;
    model only -> the active diagram panel highlights. External file changes (watcher; not Archery's own writes,
    tracked in workspaceEdit.ts) of chapters / diagrams / data are followed afterwards (`followExternal`, chapter
    texts cached). Setting `archery.followAgent`. Document: webview/document/follow.ts, `follow` message, `data-src`
    on data tables. Editor: `highlight` message -> select, center, `.live-change` outline.
  - Export: diagrams without a box; the PDF contents have page numbers right-aligned after dotted leaders (two prints:
    src/export/pdfOutline.ts reads the first PDF's outline written by --generate-pdf-document-outline; `tocPages`
    option of renderDocumentHtml); contents indent so a child's number lines up with its parent's title.
  - Tables: the delete-table X sits at the top right on the line of the column grips.
- Round 19: release preparation (0.1.0, first Marketplace release).
  - package.json: publisher `lesyhau` (as Git Lanes), gallery banner, bugs / homepage, categories Visualization / AI /
    Chat / Other, keywords, pricing Free. `.vscodeignore` packs dist (no maps), media, README, CHANGELOG, LICENSE.
  - CHANGELOG.md (0.1.0). `.github/workflows/ci.yml` (typecheck, test, package on Ubuntu and Windows) and
    `release.yml` (tag vX.Y.Z on main = package.json version -> GitHub Release with the .vsix and CHANGELOG as notes;
    publishes with VSCE_PAT / OVSX_PAT secrets when set), copied from Git Lanes.
  - README rewritten in the Git Lanes layout; new screenshots docs/screenshot.png and docs/diagram-editor.png (taken
    from the browser harness). README images are relative: vsce rewrites them to github.com/lesyhau/archery/raw/HEAD,
    so the repository must be public with docs/ pushed.

