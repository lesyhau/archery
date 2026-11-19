// The bridge between the MCP server (a separate process started by Claude Code) and the VS Code window
// that has the documentation open: the server hands its changes to the window, which shows them live
// (src/live/liveView.ts) and applies them as an undoable edit; and it asks the window for what only VS
// Code can do (versions, PDF / PNG export). The window listens on 127.0.0.1 with a random token, and
// announces itself in a small file in the temp folder named after the documentation folder.
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface BridgeInfo {
  port: number;
  token: string;
  pid: number;
}

/** The announcement file of a documentation folder (an absolute file system path). */
export function bridgeFile(rootPath: string): string {
  let p = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32' || /^[a-zA-Z]:\//.test(p)) p = p.toLowerCase();
  return join(tmpdir(), 'archery-bridge', `${createHash('sha1').update(p).digest('hex').slice(0, 16)}.json`);
}

export type BridgeRequest =
  | { kind: 'apply'; changes: [string, string][] }
  | { kind: 'host'; method: string; args: unknown[] };
