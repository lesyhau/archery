# Contributing to Archery

Issues and pull requests are welcome at [github.com/lesyhau/archery](https://github.com/lesyhau/archery).

## Development

Requires Node.js 22+.

```sh
npm install
npm run build        # dist/extension.js, dist/mcp.js, dist/webview/*
npm test             # model, operations, Markdown, rendering, export, MCP server
npm run typecheck
npm run sample       # regenerate sample/docs/architecture
npm run gen:tools    # regenerate the Copilot tool list in package.json (a test fails if you forget)
npm run package      # archery-<version>.vsix
```

Press **F5** in VS Code to open an Extension Development Host on the `sample/` folder.

How it is organised:

- `src/model/`: schemas, loading, validation and the UML text syntax for members.
- `src/ops/`: the tools shared by Copilot, the MCP server and the editors. Each tool collects its file changes, which are applied as one edit.
- `src/render/`: layout of every diagram type into drawing primitives, and SVG export. The editors, the document and the export all draw from the same scene.
- `src/doc/`, `src/document/`: the Markdown ↔ editor pipeline and the document panel.
- `src/export/`: the HTML renderer; PDFs are printed from it.
- `src/live/`: the live view of agent edits, and the bridge the MCP server uses to reach VS Code.
- `src/ai/`, `src/mcp/`: Copilot tools and chat participant, Claude Code setup, the MCP server.
- `webview/`: the document view (TipTap) and the diagram editors (React Flow and ELK).

> **Windows:** if vitest fails with `Cannot read properties of undefined (reading 'config')`, the shell's working directory uses a lower-case drive letter (`d:\…`). Run it from `D:\…`.

## Releasing

Work branches (`feature/`, `bugfix/`, `chore/`, `docs/` and so on) come off `dev` and merge back into it. `main` changes only through a `dev` → `main` pull request.

1. On a `release/x.y.z` branch off `dev`, bump `version` in `package.json` and add the version to `CHANGELOG.md`. Merge it into `dev`.
2. Open the `dev` → `main` pull request and merge it with a merge commit.
3. Tag `main` and push the tag: `git tag vx.y.z && git push origin vx.y.z`.

The **Release** workflow then tests and packages the extension and attaches the `.vsix` to a GitHub Release. It also publishes it, but only when the repository has the tokens:
- to the VS Code Marketplace with a `VSCE_PAT` secret;
- to Open VSX (VSCodium, Cursor and other editors) with an `OVSX_PAT` secret.

Without them, upload the `.vsix` from the GitHub Release by hand.
