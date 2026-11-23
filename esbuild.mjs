// Builds three bundles:
//   1. the extension host bundle (Node, CommonJS, `vscode` external)
//   2. the MCP server (Node, CommonJS, standalone)
//   3. the webview bundles (browser, IIFE), one per custom editor
//
// Usage: node esbuild.mjs [--watch] [--production]
import * as esbuild from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// Production builds have no source maps; drop stale ones from dev builds so they don't end up in the .vsix.
if (production) rmSync('dist', { recursive: true, force: true });

/** Logs start/end markers that the VS Code background problem matcher in .vscode/tasks.json waits for. */
const watchLogger = {
  name: 'watch-logger',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const { text, location } of [...result.errors, ...result.warnings]) {
        const where = location ? `${location.file}:${location.line}:${location.column}: ` : '';
        console.error(`✘ [ERROR] ${where}${text}`);
      }
      console.log('[watch] build finished');
    });
  },
};

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: watch ? 'silent' : 'info',
  plugins: watch ? [watchLogger] : [],
};

/** @type {esbuild.BuildOptions} */
const extensionOptions = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
};

/** Standalone MCP server (stdio) for Claude Code and other MCP clients. */
/** @type {esbuild.BuildOptions} */
const mcpOptions = {
  ...common,
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'dist/mcp.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
};

/** @type {esbuild.BuildOptions} */
const webviewOptions = {
  ...common,
  entryPoints: {
    diagram: 'webview/diagram/main.tsx',
    sequence: 'webview/sequence/main.tsx',
    document: 'webview/document/main.tsx',
    tools: 'webview/tools/main.tsx',
  },
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  loader: { '.svg': 'dataurl', '.ttf': 'file' },
};

if (watch) {
  const contexts = await Promise.all([extensionOptions, mcpOptions, webviewOptions].map((o) => esbuild.context(o)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([extensionOptions, mcpOptions, webviewOptions].map((o) => esbuild.build(o)));
}
