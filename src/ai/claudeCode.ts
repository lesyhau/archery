// Claude Code integration: makes the bundled MCP server available at a stable path
// and registers it with Claude Code (user scope via the `claude` CLI, or the project's .mcp.json).
import * as vscode from 'vscode';

export const MCP_SERVER_NAME = 'archery';

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

export async function setupClaudeCodeCommand(context: vscode.ExtensionContext): Promise<void> {
  const server = await installMcpServer(context);
  const path = serverPath(server);
  const cli = `claude mcp add --scope user ${MCP_SERVER_NAME} -- node "${path}"`;

  const choice = await vscode.window.showQuickPick(
    [
      {
        id: 'user',
        label: 'All my projects',
        description: 'recommended',
        detail: `Runs "${cli}" in a terminal. The server finds docs/architecture in whatever project Claude Code is started in.`,
      },
      {
        id: 'project',
        label: 'This project only (.mcp.json)',
        detail: 'Adds the server to .mcp.json in the workspace folder. The path is specific to this machine, so don\'t commit it for a team.',
      },
      { id: 'copy', label: 'Copy the command', detail: cli },
    ],
    { title: 'Archery: Set up Claude Code', placeHolder: 'Where should Claude Code use the Archery MCP server?' },
  );
  if (!choice) return;

  if (choice.id === 'copy') {
    await vscode.env.clipboard.writeText(cli);
    void vscode.window.showInformationMessage('Archery: command copied. Run it in a terminal (requires Node.js on PATH).');
    return;
  }

  if (choice.id === 'user') {
    const terminal = vscode.window.createTerminal({ name: 'Archery: Claude Code setup' });
    terminal.show();
    terminal.sendText(cli);
    void vscode.window.showInformationMessage(
      'Archery: registering the MCP server with Claude Code. Restart Claude Code sessions, then check with /mcp. Requires Node.js on PATH.',
    );
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
      void vscode.window.showErrorMessage('Archery: .mcp.json exists but is not valid JSON; please fix it first.');
      return;
    }
  }
  config.mcpServers = { ...config.mcpServers, [MCP_SERVER_NAME]: { type: 'stdio', command: 'node', args: [path] } };
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(config, null, 2) + '\n'));
  await vscode.window.showTextDocument(file);
  void vscode.window.showInformationMessage(
    'Archery: added the MCP server to .mcp.json. Claude Code asks you to approve it on the next start. Requires Node.js on PATH.',
  );
}
