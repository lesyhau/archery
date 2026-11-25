// GitHub Copilot integration: the shared tools as VS Code language model tools.
// Edits go through one WorkspaceEdit per tool call (they respect unsaved editor buffers and can be
// undone) and are shown live: the chapter, diagram or table comes into view first (src/live/liveView.ts).
import * as vscode from 'vscode';
import { scaffold } from '../template/scaffold';
import { DEFAULT_DOCS_DIR } from '../commands/init';
import { ArcherySession, OpError, type ToolHost } from '../ops/session';
import { applyLive } from '../live/liveView';
import { INITIALIZE_TOOL, TOOLS, type ToolDef } from '../ops/tools';
import { docsListing } from '../ops/docs';
import { createReader, findArcheryRoots, resolveDoc, workspaceDisk } from '../workspace';
import { applyChanges } from '../workspaceEdit';
import { COPILOT_PREFIX } from './toolManifest';

function textResult(value: unknown): vscode.LanguageModelToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

class SessionTool implements vscode.LanguageModelTool<unknown> {
  constructor(
    private readonly def: ToolDef,
    private readonly hostFor?: (root: vscode.Uri) => ToolHost,
  ) {}

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<unknown>): vscode.PreparedToolInvocation {
    const parsed = this.def.input.safeParse(options.input);
    const confirm = !this.def.readOnly && this.def.confirm && parsed.success ? this.def.confirm(parsed.data) : undefined;
    return {
      invocationMessage: `Archery: ${this.def.title}`,
      confirmationMessages: confirm ? { title: `Archery: ${this.def.title}`, message: confirm } : undefined,
    };
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<unknown>): Promise<vscode.LanguageModelToolResult> {
    const doc = (options.input as { doc?: unknown } | undefined)?.doc;
    const { root, error, docs } = await resolveDoc(typeof doc === 'string' ? doc : undefined);
    if (error) return textResult(`Error: ${error}`);
    if (!root) {
      return textResult(`No architecture documentation found in the workspace. Use the ${COPILOT_PREFIX}${INITIALIZE_TOOL.name} tool first.`);
    }
    const parsed = this.def.input.safeParse(options.input);
    if (!parsed.success) return textResult(`Invalid arguments: ${parsed.error.message}`);
    try {
      const session = await ArcherySession.load(createReader(root), vscode.workspace.asRelativePath(root));
      session.host = this.hostFor?.(root);
      session.disk = workspaceDisk(root);
      const result = await this.def.run(session, parsed.data);
      await applyLive(root, session.changes);
      const current = docs.find((d) => d.root.toString() === root.toString());
      if (this.def.name === 'overview' && docs.length > 1 && current && result && typeof result === 'object') return textResult({ ...result, ...docsListing(docs, current) });
      return textResult(result);
    } catch (e) {
      // Errors are returned to the model so it can correct itself.
      if (e instanceof OpError) return textResult(`Error: ${e.message}`);
      throw e;
    }
  }
}

class InitializeTool implements vscode.LanguageModelTool<unknown> {
  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<unknown>): vscode.PreparedToolInvocation {
    const parsed = INITIALIZE_TOOL.input.safeParse(options.input);
    return {
      invocationMessage: 'Archery: Initialize documentation',
      confirmationMessages: {
        title: 'Archery: Initialize documentation',
        message: `Create ${(parsed.success && parsed.data.folder) || DEFAULT_DOCS_DIR} for "${parsed.success ? parsed.data.system : '?'}"?`,
      },
    };
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<unknown>): Promise<vscode.LanguageModelToolResult> {
    const parsed = INITIALIZE_TOOL.input.safeParse(options.input);
    if (!parsed.success) return textResult(`Invalid arguments: ${parsed.error.message}`);
    const existing = await findArcheryRoots();
    const wanted = parsed.data.folder?.trim().replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    if (existing.length && !wanted) {
      return textResult(`architecture documentation already exists in ${existing.map((r) => vscode.workspace.asRelativePath(r, false)).join(', ')}. To add another one, pass folder.`);
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return textResult('Error: no folder is open in VS Code.');
    if (wanted?.split('/').includes('..')) return textResult('Error: folder must be inside the project.');
    const root = vscode.Uri.joinPath(folder.uri, ...(wanted || DEFAULT_DOCS_DIR).split('/'));
    if (existing.some((r) => r.toString() === root.toString())) return textResult(`architecture documentation already exists in ${vscode.workspace.asRelativePath(root, false)}.`);
    const files = scaffold({ system: parsed.data.system, includeHelp: parsed.data.includeHelp ?? true });
    await applyChanges(root, files);
    return textResult({ root: vscode.workspace.asRelativePath(root), created: [...files.keys()] });
  }
}

export function registerLanguageModelTools(hostFor?: (root: vscode.Uri) => ToolHost): vscode.Disposable[] {
  if (!vscode.lm?.registerTool) return []; // VS Code without the language model tools API
  return [
    vscode.lm.registerTool(`${COPILOT_PREFIX}${INITIALIZE_TOOL.name}`, new InitializeTool()),
    ...TOOLS.map((def) => vscode.lm.registerTool(`${COPILOT_PREFIX}${def.name}`, new SessionTool(def, hostFor))),
  ];
}
