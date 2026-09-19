import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_BODY = 1024 * 1024;

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new Error('request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = (await readBody(req)).toString('utf8');
  if (raw.trim() === '') return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('request body is not valid JSON');
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serve a built web/dist. Returns false when the file is missing so the caller can fall
 * back to index.html (SPA) or to a "run npm run build" message.
 */
export async function serveStatic(res: ServerResponse, root: string, urlPath: string): Promise<boolean> {
  const rel = decodeURIComponent(urlPath.split('?')[0] ?? '/').replace(/^\/+/, '');
  const target = path.resolve(root, rel === '' ? 'index.html' : rel);
  if (target !== root && !target.startsWith(root + path.sep)) return false;
  let data: Buffer;
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) return false;
    data = await fs.readFile(target);
  } catch {
    return false;
  }
  const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
  const immutable = /\/assets\//.test(target);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(data);
  return true;
}
