// The window side of the MCP bridge (see bridgeProtocol.ts).
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname } from 'node:path';
import * as vscode from 'vscode';
import { OpError, type ToolHost } from '../ops/session';
import { bridgeFile, type BridgeRequest } from './bridgeProtocol';
import { applyLive } from './liveView';

export class Bridge implements vscode.Disposable {
  private server: Server | undefined;
  private readonly token = randomBytes(24).toString('hex');
  private file: string | undefined;

  constructor(
    private readonly root: vscode.Uri,
    private readonly host: ToolHost,
  ) {}

  start(): void {
    const server = createServer((req, res) => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'POST' || req.headers['x-archery-token'] !== this.token) return reply(403, { ok: false, error: 'forbidden' });
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        try {
          const msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as BridgeRequest;
          if (msg.kind === 'apply') {
            await applyLive(this.root, new Map(msg.changes));
            return reply(200, { ok: true });
          }
          const fn = (this.host as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[msg.method];
          if (typeof fn !== 'function') return reply(400, { ok: false, error: `unknown method ${msg.method}` });
          return reply(200, { ok: true, result: await fn.apply(this.host, msg.args) });
        } catch (e) {
          return reply(200, { ok: false, error: e instanceof Error ? e.message : String(e), agent: e instanceof OpError });
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return;
      this.file = bridgeFile(this.root.fsPath);
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify({ port: address.port, token: this.token, pid: process.pid }), { mode: 0o600 });
      } catch {
        this.file = undefined; // no temp folder: agents write files directly (not shown live)
      }
    });
    server.on('error', () => undefined);
    this.server = server;
  }

  dispose(): void {
    this.server?.close();
    if (this.file) rmSync(this.file, { force: true });
  }
}
