// "Archery: Export Document" - the whole architecture document as one HTML file, or as PDF
// (printed by an installed Chromium-based browser in headless mode: Edge, Chrome, Chromium, Brave).
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { readText } from '../workspace';
import { applyChanges } from '../workspaceEdit';
import { loadDocumentContent } from '../document/content';
import { imageReferences, renderDocumentHtml, tocEntries, type ExportContent } from '../export/documentHtml';
import { outlinePages, tocPages } from '../export/pdfOutline';
import { findBrowsers } from '../export/browsers';
import { fitAutoTables } from '../export/tableMeasure';
import type { ExportSettings } from '../model/schema';
import { diagramStyle } from '../editors/webviewEditor';
import type { VersionTracker } from '../versions/tracker';

export type ExportFormat = 'html' | 'pdf';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };

/** Reads the images the document references and returns them as data URIs (path as written -> URI). */
async function embedImages(root: vscode.Uri, content: ExportContent): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const ref of imageReferences(content)) {
    const ext = /\.([a-z0-9]+)$/i.exec(ref.split(/[?#]/)[0]!)?.[1]?.toLowerCase() ?? '';
    const mime = MIME[ext];
    if (!mime) continue;
    const clean = decodeURIComponent(ref.split(/[?#]/)[0]!);
    // Section files live in sections/, data tables are relative to the root.
    for (const base of [vscode.Uri.joinPath(root, 'sections'), root]) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(base, clean));
        out.set(ref, `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`);
        break;
      } catch {
        /* try the next base */
      }
    }
  }
  return out;
}

/** Installed Chromium-based browsers that can print to PDF, in order of preference. */
export function pdfBrowsers(): string[] {
  return findBrowsers(vscode.workspace.getConfiguration('archery').get<string>('export.browserPath'));
}

function printToPdf(browser: string, htmlFile: string, pdfFile: string, profileDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--no-pdf-header-footer',
        '--print-to-pdf-no-header',
        // Bookmarks from the headings (PDF outline); ignored by browsers that do not know it.
        '--generate-pdf-document-outline',
        `--user-data-dir=${profileDir}`,
        `--print-to-pdf=${pdfFile}`,
        pathToFileURL(htmlFile).href,
      ],
      { timeout: 120_000, windowsHide: true },
      (error) => {
        if (existsSync(pdfFile) && statSync(pdfFile).size > 0) resolve();
        else reject(error ?? new Error('the browser did not write the PDF'));
      },
    );
  });
}

/** Keeps the export options in archery.yaml (`export`), so the next export and the team reuse them. */
export async function exportDocumentSettings(root: vscode.Uri, settings: ExportSettings): Promise<void> {
  const text = (await readText(vscode.Uri.joinPath(root, 'archery.yaml'))) ?? '';
  const doc = parseDocument(text);
  const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined && v !== null));
  const before = JSON.stringify((doc.get('export') as { toJSON?(): unknown } | undefined)?.toJSON?.() ?? {});
  if (before === JSON.stringify(clean)) return;
  if (Object.keys(clean).length) doc.set('export', doc.createNode(clean));
  else doc.delete('export');
  await applyChanges(root, new Map([['archery.yaml', doc.toString({ lineWidth: 0 })]]));
}

/** Renders the document and writes it as HTML, or prints it as PDF (twice: with page numbers in the contents). */
export async function writeDocumentFile(
  context: vscode.ExtensionContext,
  root: vscode.Uri,
  content: Awaited<ReturnType<typeof loadDocumentContent>>,
  picked: ExportFormat,
  settings: ExportSettings | undefined,
  target: vscode.Uri,
  browsers: string[] = picked === 'pdf' ? pdfBrowsers() : [],
): Promise<void> {
  if (picked === 'pdf' && browsers.length === 0) throw new Error('PDF export needs Microsoft Edge, Google Chrome, Chromium or Brave (or set "archery.export.browserPath").');
  const version = String((context.extension.packageJSON as { version?: string }).version ?? '');
  const options = {
    images: await embedImages(root, content),
    generator: `Archery ${version}`.trim(),
    date: new Date().toISOString().slice(0, 10),
    settings: settings ?? content.exportSettings,
    diagramStyle: diagramStyle(),
  };
  // Tables whose view says `fit: auto` get column widths fitted to their content (src/export/tableFit.ts).
  content = {
    ...content,
    tables: await fitAutoTables(browsers.length ? browsers : pdfBrowsers(), { system: content.system, title: content.title, version: content.version, tables: content.tables, exportSettings: options.settings }),
  };
  let html = renderDocumentHtml(content, options);
  if (picked === 'html') {
    await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
    return;
  }
  const work = mkdtempSync(join(tmpdir(), 'archery-export-'));
  try {
    const htmlFile = join(work, 'document.html');
    const pdfFile = join(work, 'document.pdf');
    writeFileSync(htmlFile, html, 'utf8');
    let lastError: unknown;
    for (const browser of browsers) {
      try {
        await printToPdf(browser, htmlFile, pdfFile, join(work, 'profile'));
        lastError = undefined;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) throw lastError;
    // Second print with the page numbers in the contents, read from the first PDF's bookmarks.
    const entries = tocEntries(html);
    const pages = entries.length ? tocPages(entries, outlinePages(readFileSync(pdfFile))) : {};
    if (Object.keys(pages).length) {
      html = renderDocumentHtml(content, { ...options, tocPages: pages });
      writeFileSync(htmlFile, html, 'utf8');
      for (const browser of browsers) {
        try {
          await printToPdf(browser, htmlFile, pdfFile, join(work, 'profile'));
          break;
        } catch {
          // keep the first PDF (no page numbers)
        }
      }
    }
    await vscode.workspace.fs.copy(vscode.Uri.file(pdfFile), target, { overwrite: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** `settings`: the export options chosen in the export dialog (default: archery.yaml `export`). */
export async function exportDocument(context: vscode.ExtensionContext, root: vscode.Uri | undefined, tracker: VersionTracker | undefined, format?: ExportFormat, settings?: ExportSettings): Promise<void> {
  if (!root) {
    void vscode.window.showErrorMessage('Archery: no architecture documentation found in this workspace.');
    return;
  }
  const picked =
    format ??
    (
      await vscode.window.showQuickPick(
        [
          { label: '$(file-pdf) PDF', format: 'pdf' as const },
          { label: '$(globe) HTML', format: 'html' as const },
        ],
        { title: 'Archery: Export Document' },
      )
    )?.format;
  if (!picked) return;

  const browsers = picked === 'pdf' ? pdfBrowsers() : [];
  if (picked === 'pdf' && browsers.length === 0) {
    const choice = await vscode.window.showErrorMessage(
      'Archery: no browser found for PDF export.',
      'Export HTML',
      'Open Settings',
    );
    if (choice === 'Export HTML') return exportDocument(context, root, tracker, 'html', settings);
    if (choice === 'Open Settings') void vscode.commands.executeCommand('workbench.action.openSettings', 'archery.export.browserPath');
    return;
  }

  const content = await loadDocumentContent(root, tracker);
  const name = `${content.system} - Architecture Design Document.${picked}`.replace(/[\\/:*?"<>|]/g, '-');
  const target = await vscode.window.showSaveDialog({
    title: picked === 'pdf' ? 'Export as PDF' : 'Export as HTML',
    defaultUri: vscode.Uri.joinPath(root, '..', name),
    filters: picked === 'pdf' ? { PDF: ['pdf'] } : { HTML: ['html', 'htm'] },
  });
  if (!target) return;

  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Archery: exporting ${picked.toUpperCase()}` }, () =>
      writeDocumentFile(context, root, content, picked, settings, target, browsers),
    );
  } catch (e) {
    void vscode.window.showErrorMessage(`Archery: export failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const action = await vscode.window.showInformationMessage(`Archery: exported ${vscode.workspace.asRelativePath(target)}`, 'Open', 'Reveal in File Explorer');
  if (action === 'Open') void vscode.env.openExternal(target);
  if (action === 'Reveal in File Explorer') void vscode.commands.executeCommand('revealFileInOS', target);
}
