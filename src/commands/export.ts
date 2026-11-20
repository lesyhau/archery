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

async function waitForEditor(uri: vscode.Uri) {
  const key = uri.toString();
  for (let i = 0; i < 50; i++) {
    const editor = WebviewDiagramEditorProvider.open.get(key);
    if (editor?.ready) return editor;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

/** Writes a diagram as SVG (rendered here) or PNG (rendered by its editor, opened if needed). */
export async function writeDiagramImage(uri: vscode.Uri, format: 'svg' | 'png', theme: ExportTheme, target: vscode.Uri): Promise<void> {
  if (format === 'svg') {
    const { scene, title } = await diagramScene(uri);
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(sceneToSvg(scene, { theme, title })));
    return;
  }
  if (!WebviewDiagramEditorProvider.open.has(uri.toString())) await WebviewDiagramEditorProvider.openPanel(uri, { preserveFocus: true });
  const editor = await waitForEditor(uri);
  const dataUrl = editor && (await editor.renderPng());
  if (!dataUrl) throw new Error('the diagram editor could not render the image');
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
