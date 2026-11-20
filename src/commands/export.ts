// "Archery: Export Diagram" - SVG (computed here from the shared renderer) or PNG (rasterized
// by the diagram's webview).
import * as vscode from 'vscode';
import { parseCanvasDiagram, parseModel, parseSequenceDiagram, parseTimingDiagram } from '../model/load';
import { layoutCanvas } from '../render/canvasLayout';
import type { Scene } from '../render/scene';
import { layoutInteraction } from '../render/communicationLayout';
import { layoutSequence } from '../render/sequenceLayout';
import { layoutTiming } from '../render/timingLayout';
import { sceneToSvg, type ExportTheme } from '../render/svgExport';
import { diagramStyle, WebviewDiagramEditorProvider } from '../editors/webviewEditor';
import { findRootFor, readText } from '../workspace';

function activeDiagramUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
    if (/\.(uml|seq|timing)\.json$/.test(input.uri.path)) return input.uri;
  }
  // An Archery diagram panel: the one that is active.
  for (const [key, editor] of WebviewDiagramEditorProvider.open) if (editor.panel.active) return vscode.Uri.parse(key);
  return undefined;
}

export async function diagramScene(uri: vscode.Uri): Promise<{ scene: Scene; title: string }> {
  const text = (await readText(uri)) ?? '';
  const root = await findRootFor(uri);
  const modelText = root ? await readText(vscode.Uri.joinPath(root, 'model.yaml')) : undefined;
  const model = (modelText && parseModel(modelText).value) || { elements: [], relationships: [] };
  if (uri.path.endsWith('.seq.json')) {
    const parsed = parseSequenceDiagram(text);
    if (!parsed.value) throw new Error(parsed.issues[0]?.message ?? 'invalid sequence diagram');
    return { scene: layoutInteraction(parsed.value, model, layoutSequence, diagramStyle()), title: parsed.value.title };
  }
  if (uri.path.endsWith('.timing.json')) {
    const parsed = parseTimingDiagram(text);
    if (!parsed.value) throw new Error(parsed.issues[0]?.message ?? 'invalid timing diagram');
    return { scene: layoutTiming(parsed.value, model, diagramStyle()), title: parsed.value.title };
  }
  const parsed = parseCanvasDiagram(text);
  if (!parsed.value) throw new Error(parsed.issues[0]?.message ?? 'invalid diagram');
  const self = root ? uri.path.slice(root.path.length).replace(/^\//, '') : undefined;
  return { scene: layoutCanvas(parsed.value, model, diagramStyle(), self), title: parsed.value.title };
}

/** A diagram webview that is ready: this diagram's, else any (all of them can rasterize an SVG). */
async function readyEditor(uri: vscode.Uri) {
  for (let i = 0; i < 50; i++) {
    const own = WebviewDiagramEditorProvider.open.get(uri.toString());
    const editor = own?.ready ? own : [...WebviewDiagramEditorProvider.open.values()].find((e) => e.ready);
    if (editor) return editor;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

/** Request ids of our own, apart from the editors' (they ignore answers they did not ask for). */
let pngRequest = 1_000_000_000;

/** Rasterizes an SVG in a diagram webview: the extension host has no canvas. */
function rasterize(panel: vscode.WebviewPanel, svg: string, width: number, height: number): Promise<string | null> {
  const requestId = ++pngRequest;
  return new Promise((resolve) => {
    const done = (url: string | null) => {
      clearTimeout(timer);
      sub.dispose();
      gone.dispose();
      resolve(url);
    };
    const sub = panel.webview.onDidReceiveMessage((msg: { type?: string; requestId?: number; dataUrl?: string | null }) => {
      if (msg?.type === 'png' && msg.requestId === requestId) done(msg.dataUrl ?? null);
    });
    const gone = panel.onDidDispose(() => done(null));
    const timer = setTimeout(() => done(null), 10000);
    void panel.webview.postMessage({ type: 'renderPng', requestId, svg, width, height });
  });
}

/**
 * Writes a diagram as SVG or PNG. Both are rendered here from the files as they are now (the PNG is
 * the same SVG, rasterized by a diagram webview), never from what an editor happens to show.
 */
export async function writeDiagramImage(uri: vscode.Uri, format: 'svg' | 'png', theme: ExportTheme, target: vscode.Uri): Promise<void> {
  const { scene, title } = await diagramScene(uri);
  const svg = sceneToSvg(scene, { theme, title });
  if (format === 'svg') {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(svg));
    return;
  }
  if (WebviewDiagramEditorProvider.open.size === 0) await WebviewDiagramEditorProvider.openPanel(uri, { preserveFocus: true });
  const editor = await readyEditor(uri);
  const dataUrl = editor && (await rasterize(editor.panel, svg, scene.width, scene.height));
  if (!dataUrl) throw new Error('the diagram could not be rendered as PNG');
  await vscode.workspace.fs.writeFile(target, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}

export async function exportDiagramCommand(target?: vscode.Uri | { uri?: vscode.Uri }, format?: 'svg' | 'png'): Promise<void> {
  const uri = target instanceof vscode.Uri ? target : target?.uri ?? activeDiagramUri();
  if (!uri || !/\.(uml|seq|timing)\.json$/.test(uri.path)) {
    void vscode.window.showWarningMessage('Archery: open a diagram to export it.');
    return;
  }
  let theme: ExportTheme = 'light';
  if (!format) {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'SVG', description: 'light background', format: 'svg' as const, theme: 'light' as const },
        { label: 'SVG (dark)', description: 'dark background', format: 'svg' as const, theme: 'dark' as const },
        { label: 'PNG', description: '2x resolution, light background', format: 'png' as const, theme: 'light' as const },
      ],
      { title: 'Archery: Export diagram' },
    );
    if (!pick) return;
    format = pick.format;
    theme = pick.theme;
  }
  const base = uri.path.replace(/\.(uml|seq)\.json$/, '');
  const target2 = await vscode.window.showSaveDialog({
    defaultUri: uri.with({ path: `${base}.${format}` }),
    filters: format === 'svg' ? { 'SVG image': ['svg'] } : { 'PNG image': ['png'] },
  });
  if (!target2) return;

  try {
    await writeDiagramImage(uri, format, theme, target2);
    const open = await vscode.window.showInformationMessage(`Archery: exported ${vscode.workspace.asRelativePath(target2)}.`, 'Open');
    if (open) await vscode.commands.executeCommand('vscode.open', target2);
  } catch (e) {
    void vscode.window.showErrorMessage(`Archery: export failed: ${e instanceof Error ? e.message : e}`);
  }
}
