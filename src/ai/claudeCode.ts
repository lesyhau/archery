// Claude Code integration: makes the bundled MCP server available at a stable path
// and registers it with Claude Code (user scope in ~/.claude.json, or the project's .mcp.json).
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

export const MCP_SERVER_NAME = 'archery';

/** Set once the user-scope entry was added, so an entry the user removed is not added again. */
const REGISTERED_KEY = 'archery.claudeCodeRegistered';

/**
 * The extension folder changes with every version, so the MCP server is copied to
 * global storage, whose path stays the same across updates. Returns that path.
 */
export async function installMcpServer(context: vscode.ExtensionContext): Promise<vscode.Uri> {
  const source = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp.js');
  const target = vscode.Uri.joinPath(context.globalStorageUri, 'mcp.js');
  const bytes = await vscode.workspace.fs.readFile(source);
  let current: Uint8Array | undefined;
  try {
    current = await vscode.workspace.fs.readFile(target);
  } catch {
    current = undefined;
  }
  if (!current || Buffer.compare(Buffer.from(current), Buffer.from(bytes)) !== 0) {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(target, bytes);
  }
  return target;
}

function serverPath(uri: vscode.Uri): string {
  return uri.fsPath.replaceAll('\\', '/'); // works for node on every OS and in every shell
}

function serverEntry(path: string): { type: 'stdio'; command: string; args: string[]; env: Record<string, string> } {
  return { type: 'stdio', command: 'node', args: [path], env: {} };
}

/** Claude Code's user configuration, where `claude mcp add --scope user` writes. */
function claudeConfigFile(): string {
  return join(homedir(), '.claude.json');
}

type ClaudeConfig = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

async function readClaudeConfig(): Promise<ClaudeConfig | undefined> {
  const file = claudeConfigFile();
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ClaudeConfig) : undefined;
  } catch {
    return undefined; // unreadable or invalid: never overwrite it
  }
}

/** Adds or updates the user-scope entry. Returns false if the configuration could not be read. */
async function registerUserScope(path: string): Promise<boolean> {
  const config = await readClaudeConfig();
  if (!config) return false;
  const entry = serverEntry(path);
  if (JSON.stringify(config.mcpServers?.[MCP_SERVER_NAME]) === JSON.stringify(entry)) return true;
  config.mcpServers = { ...config.mcpServers, [MCP_SERVER_NAME]: entry };
  await writeFile(claudeConfigFile(), JSON.stringify(config, null, 2));
  return true;
}

/**
 * On activation: registers the MCP server with Claude Code once if Claude Code is installed,
 * and keeps an existing entry pointing at the current server path.
 */
export async function ensureClaudeCodeRegistration(context: vscode.ExtensionContext, server: vscode.Uri): Promise<void> {
  if (!existsSync(claudeConfigFile())) return; // Claude Code not installed
  const config = await readClaudeConfig();
  if (!config) return;
  const existing = config.mcpServers?.[MCP_SERVER_NAME];
  if (!existing && context.globalState.get<boolean>(REGISTERED_KEY)) return; // removed by the user
  if (existing && !isOurEntry(existing)) return; // someone else's server with the same name
  if (await registerUserScope(serverPath(server))) await context.globalState.update(REGISTERED_KEY, true);
}

function isOurEntry(entry: unknown): boolean {
  const args = (entry as { args?: unknown }).args;
  return Array.isArray(args) && args.some((a) => typeof a === 'string' && a.replaceAll('\\', '/').endsWith('/mcp.js'));
}

export async function setupClaudeCodeCommand(context: vscode.ExtensionContext): Promise<void> {
  const server = await installMcpServer(context);
  const path = serverPath(server);

  const choice = await vscode.window.showQuickPick(
    [
      { id: 'user', label: 'All my projects', description: 'recommended' },
      { id: 'project', label: 'This project only (.mcp.json)' },
      { id: 'copy', label: 'Copy the command' },
    ],
    { title: 'Archery: Set up Claude Code', placeHolder: 'Use Archery in' },
  );
  if (!choice) return;

  if (choice.id === 'copy') {
    await vscode.env.clipboard.writeText(`claude mcp add --scope user ${MCP_SERVER_NAME} -- node "${path}"`);
    void vscode.window.showInformationMessage('Archery: command copied.');
    return;
  }

  if (choice.id === 'user') {
    if (!(await registerUserScope(path))) {
      void vscode.window.showErrorMessage('Archery: ~/.claude.json is not valid JSON.');
      return;
    }
    await context.globalState.update(REGISTERED_KEY, true);
    void vscode.window.showInformationMessage('Archery: added to Claude Code. Restart Claude Code to use it.');
    return;
  }

  const folder =
    (vscode.workspace.workspaceFolders?.length ?? 0) > 1
      ? await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Project for .mcp.json' })
      : vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Archery: open a folder first.');
    return;
  }
  const file = vscode.Uri.joinPath(folder.uri, '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    config = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(file)));
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError)) {
      void vscode.window.showErrorMessage('Archery: .mcp.json is not valid JSON.');
      return;
    }
  }
  config.mcpServers = { ...config.mcpServers, [MCP_SERVER_NAME]: serverEntry(path) };
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(config, null, 2) + '\n'));
  await vscode.window.showTextDocument(file);
  void vscode.window.showInformationMessage('Archery: added to this project. Restart Claude Code to use it.');
}
