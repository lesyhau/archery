// The MCP server's side of the bridge to a VS Code window (see src/live/bridgeProtocol.ts). Without an
// open window the server writes the files itself and the tools that need VS Code say so.
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { OpError, type ToolHost } from '../ops/session';
import { bridgeFile, type BridgeInfo, type BridgeRequest } from '../live/bridgeProtocol';

function post(info: BridgeInfo, body: BridgeRequest, timeoutMs: number): Promise<{ ok: boolean; result?: unknown; error?: string; agent?: boolean }> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = request(
      { host: '127.0.0.1', port: info.port, method: 'POST', path: '/', headers: { 'content-type': 'application/json', 'content-length': data.length, 'x-archery-token': info.token }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('the VS Code window did not answer')));
    req.on('error', reject);
    req.end(data);
  });
}

export interface BridgeClient {
  /** Shows and applies the changes in the window; false when it could not (then write them yourself). */
  apply(changes: Map<string, string>): Promise<boolean>;
  host: ToolHost;
}

/** The bridge to the window that has `root` open, if there is one. */
export function connectBridge(root: string): BridgeClient | undefined {
  let info: BridgeInfo;
  try {
    info = JSON.parse(readFileSync(bridgeFile(root), 'utf8')) as BridgeInfo;
  } catch {
    return undefined;
  }
  const call = async (method: string, ...args: unknown[]) => {
    let reply;
    try {
      reply = await post(info, { kind: 'host', method, args }, 300_000);
    } catch {
      throw new OpError('This needs VS Code with the Archery extension open on this folder (open the folder in VS Code, then try again).');
    }
    if (!reply.ok) throw new OpError(reply.error ?? 'failed');
    return reply.result as never;
  };
  return {
    async apply(changes) {
      try {
        return (await post(info, { kind: 'apply', changes: [...changes] }, 60_000)).ok;
      } catch {
        return false;
      }
    },
    host: {
      versions: () => call('versions'),
      release: (note) => call('release', note),
      restore: (version) => call('restore', version),
      exportDocument: (format, file, settings) => call('exportDocument', format, file, settings),
      exportDiagram: (diagram, format, theme, file) => call('exportDiagram', diagram, format, theme, file),
    },
  };
}
