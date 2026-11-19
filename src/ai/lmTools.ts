// GitHub Copilot integration: the shared tools as VS Code language model tools.
// Edits go through one WorkspaceEdit per tool call (they respect unsaved editor buffers and can be
// undone) and are shown live: the chapter, diagram or table comes into view first (src/live/liveView.ts).
import * as vscode from 'vscode';
import { scaffold } from '../template/scaffold';
import { DEFAULT_DOCS_DIR } from '../commands/init';
import { ArcherySession, OpError, type ToolHost } from '../ops/session';
import { applyLive } from '../live/liveView';
import { INITIALIZE_TOOL, TOOLS, type ToolDef } from '../ops/tools';
import { createReader, findArcheryRoots } from '../workspace';
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
    const root = (await findArcheryRoots())[0];
    if (!root) {
      return textResult(`No architecture documentation found in the workspace. Use the ${COPILOT_PREFIX}${INITIALIZE_TOOL.name} tool first.`);
    }
    const parsed = this.def.input.safeParse(options.input);
    if (!parsed.success) return textResult(`Invalid arguments: ${parsed.error.message}`);
    try {
      const session = await ArcherySession.load(createReader(root), vscode.workspace.asRelativePath(root));
      session.host = this.hostFor?.(root);
      const result = await this.def.run(session, parsed.data);
      await applyLive(root, session.changes);
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
        message: `Create ${DEFAULT_DOCS_DIR} for "${parsed.success ? parsed.data.system : '?'}"?`,
      },
    };
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<unknown>): Promise<vscode.LanguageModelToolResult> {
    const existing = (await findArcheryRoots())[0];
    if (existing) return textResult(`architecture documentation already exists in ${vscode.workspace.asRelativePath(existing)}.`);
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return textResult('Error: no folder is open in VS Code.');
    const parsed = INITIALIZE_TOOL.input.safeParse(options.input);
    if (!parsed.success) return textResult(`Invalid arguments: ${parsed.error.message}`);
    const root = vscode.Uri.joinPath(folder.uri, ...DEFAULT_DOCS_DIR.split('/'));
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
