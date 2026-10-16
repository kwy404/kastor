/**
 * `kastor studio`: a local web UI on node:http. It binds to 127.0.0.1 only,
 * answers only to its own host name (no DNS rebinding), and every API call
 * needs the random session token from the URL the CLI prints.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Adapter, SchemaIR } from '../core/ir';
import { introspect } from '../migrate/engine';
import { handleApi, toJson, type StudioState } from './api';
import { clientScript } from './client';
import { QueryLog } from './queries';
import { findSeasonsDir, seasonFiles } from './seasons';
import { FAVICON, renderPage, THEME_SCRIPT } from './page';

export interface StudioOptions {
  adapter: Adapter;
  /** Port to listen on. Default 5555; the next free port is used when it is taken and no port was asked for. */
  port?: number;
  /** Fixed token, for tests. Default: 32 random bytes. */
  token?: string;
  /** Schema to show. Default: introspect the database. */
  schema?: SchemaIR;
  version?: string;
  readOnly?: boolean;
  /** Statements kept in the query log. Default 200; 0 turns the log off. */
  queryLog?: number;
  /** Folder with seasons.js and the seasonal art; false turns seasonal themes off. Default: the one shipped with kastor. */
  seasons?: string | false;
}

export interface StudioServer {
  url: string;
  /** URL with the token, the one to open. */
  openUrl: string;
  port: number;
  token: string;
  server: Server;
  state: StudioState;
  close(): Promise<void>;
}

export const HOST = '127.0.0.1';
export const MAX_BODY = 1024 * 1024;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; font-src https://cdn.jsdelivr.net data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => send(res, status, 'application/json; charset=utf-8', toJson(body));

function sameToken(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

export async function startStudio(options: StudioOptions): Promise<StudioServer> {
  const token = options.token ?? randomBytes(32).toString('base64url');
  const state: StudioState = {
    adapter: options.adapter,
    schema: options.schema ?? (await introspect(options.adapter)),
    version: options.version ?? '0.0.0',
    readOnly: options.readOnly,
    queries: options.queryLog === 0 ? undefined : new QueryLog(options.queryLog ?? 200),
  };
  let port = 0;
  const allowedHosts = (): Set<string> => new Set([`${HOST}:${port}`, `localhost:${port}`]);
  const script = clientScript();
  const seasons = seasonFiles(options.seasons === false ? null : (options.seasons ?? findSeasonsDir()));

  const server = createServer(async (req, res) => {
    try {
      if (!allowedHosts().has(String(req.headers.host ?? '').toLowerCase())) {
        send(res, 421, 'text/plain; charset=utf-8', 'kastor studio only answers on 127.0.0.1.');
        return;
      }
      const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);
      const method = req.method ?? 'GET';
      if (!url.pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed.');
        if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, 'text/html; charset=utf-8', renderPage({ version: state.version }));
        if (url.pathname === '/app.js') return send(res, 200, 'text/javascript; charset=utf-8', script);
        if (url.pathname === '/theme.js') return send(res, 200, 'text/javascript; charset=utf-8', THEME_SCRIPT);
        if (url.pathname === '/favicon.svg') return send(res, 200, 'image/svg+xml', FAVICON);
        if (url.pathname === '/seasons.js') return send(res, 200, 'text/javascript; charset=utf-8', seasons.script);
        const art = url.pathname.startsWith('/seasons/') ? seasons.art(url.pathname) : null;
        if (art !== null) return send(res, 200, 'image/svg+xml', art);
        return send(res, 404, 'text/plain; charset=utf-8', 'Not found.');
      }
      if (!sameToken(req.headers['x-kastor-token'] as string | undefined, token)) {
        return sendJson(res, 401, { error: { code: 'TOKEN', message: 'Missing or wrong session token.', hint: 'Open the studio with the link the kastor studio command printed.' } });
      }
      let body: unknown;
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin && !allowedHosts().has(origin.replace(/^https?:\/\//, '').toLowerCase())) {
          return sendJson(res, 403, { error: { code: 'ORIGIN', message: 'Cross origin requests are not allowed.' } });
        }
        const text = await readBody(req);
        if (text) {
          if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
            return sendJson(res, 415, { error: { code: 'CONTENT_TYPE', message: 'Send JSON with Content-Type: application/json.' } });
          }
          try {
            body = JSON.parse(text);
          } catch {
            return sendJson(res, 400, { error: { code: 'JSON', message: 'The request body is not valid JSON.' } });
          }
        }
      }
      const result = await handleApi(state, method, url.pathname, url.searchParams, body);
      sendJson(res, result.status, result.body);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      if (!res.headersSent) sendJson(res, status, { error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } });
    }
  });

  const wanted = options.port ?? 5555;
  for (let attempt = 0; ; attempt++) {
    try {
      port = await listen(server, wanted === 0 ? 0 : wanted + attempt);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || options.port !== undefined || attempt >= 20) throw error;
    }
  }
  const url = `http://${HOST}:${port}`;
  return {
    url,
    openUrl: `${url}/?token=${token}`,
    port,
    token,
    server,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
