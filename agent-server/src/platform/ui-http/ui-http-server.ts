// input:  an AnyRouter (injected) + a token accessor + @core/auth + @trpc/server standalone adapter
// output: createUiHttpServer({ router, getToken, port, host?, spaDir? }) -> { server, close() }
// pos:    Web UI transport-host (platform layer, L3). Mounts the injected tRPC router on the
//         standalone HTTP adapter (query/mutate over HTTP, subscription over SSE — tRPC v11),
//         gated by an x-cortex-token bearer check BEFORE tRPC (mirrors webhook + WS-upgrade),
//         and serves a minimal SPA static stub for non-tRPC paths. Generic over AnyRouter — the
//         concrete AppRouter is injected by the entry-layer wiring, keeping this file router-
//         agnostic and layer-clean (platform -> core only). Bound 127.0.0.1 by default.
// >>> If I am updated, update CORTEX.md and the parent folder's CORTEX.md <<<

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import type { AnyRouter } from '@trpc/server';
import { AUTH_HEADER, timingSafeEqualStr } from '@core/auth.js';
import { createLogger } from '@core/log.js';

const log = createLogger('ui-http');

/** tRPC is mounted under this base path (matches the web client `httpBatchLink({ url: '/trpc' })`). */
const TRPC_BASE_PATH = '/trpc/';

export interface UiHttpServerOptions {
  /** The tRPC router to host (query/mutate/subscribe). Injected — kept generic over AnyRouter. */
  router: AnyRouter;
  /** Accessor for the bearer token the server accepts (wiring passes getClientToken). */
  getToken: () => string;
  /** TCP port to listen on (0 = ephemeral, useful in tests). */
  port: number;
  /** Host to bind. Defaults to 127.0.0.1 (loopback only — exposure is via a tunnel). */
  host?: string;
  /** Directory of the built SPA to serve for non-tRPC paths. When absent/missing → 404 stub. */
  spaDir?: string;
}

export interface UiHttpServer {
  server: http.Server;
  close: () => Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Bearer gate for a tRPC request: constant-time compare of the accepted token vs the header. */
function isAuthorized(req: http.IncomingMessage, getToken: () => string): boolean {
  const provided = req.headers[AUTH_HEADER];
  const headerVal = Array.isArray(provided) ? provided[0] : provided;
  return timingSafeEqualStr(getToken(), headerVal);
}

/**
 * SPA static-serving STUB (Stage 1 — web/ not built yet, kept minimal). For a non-tRPC path:
 *  - no spaDir / missing dir  → 404 plain-text placeholder.
 *  - spaDir present           → serve an existing file under it (path-traversal safe); otherwise
 *    fall back to index.html (SPA client-side routing); if index.html is absent → 404.
 */
function serveSpaStub(req: http.IncomingMessage, res: http.ServerResponse, spaDir?: string): void {
  if (!spaDir || !fs.existsSync(spaDir)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Cortex UI not built');
    return;
  }

  const root = path.resolve(spaDir);
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const requested = path.resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath));

  // Path-traversal guard: the resolved target must stay inside the SPA root.
  if (requested !== root && !requested.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const indexPath = path.join(root, 'index.html');
  const target = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : indexPath;
  if (!fs.existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}

/**
 * Build (but do not stop) an HTTP server exposing the injected tRPC router over HTTP+SSE behind
 * an x-cortex-token bearer gate, plus a minimal SPA static stub. The server is already listening
 * when this returns. Call `close()` for a clean shutdown (force-closes live SSE sockets).
 */
export function createUiHttpServer(opts: UiHttpServerOptions): UiHttpServer {
  const host = opts.host ?? '127.0.0.1';

  const server = createHTTPServer({
    router: opts.router,
    basePath: TRPC_BASE_PATH,
    createContext: () => ({}),
    // Runs BEFORE the tRPC handler. tRPC paths are token-gated here; everything else is the SPA stub.
    middleware: (req, res, next) => {
      const url = req.url ?? '/';
      if (url.startsWith('/trpc')) {
        if (!isAuthorized(req, opts.getToken)) {
          log.warn(`ui-http auth rejected: ${req.method} ${url}`);
          res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Unauthorized');
          return;
        }
        next();
        return;
      }
      serveSpaStub(req, res, opts.spaDir);
    },
  });

  server.listen(opts.port, host, () => {
    const addr = server.address();
    const boundPort = addr && typeof addr !== 'string' ? addr.port : opts.port;
    log.info(`Listening on ${host}:${boundPort}${TRPC_BASE_PATH}`);
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      // Force-close keep-alive + live SSE sockets, else server.close() would hang on them.
      server.closeAllConnections?.();
      server.close(() => resolve());
    });

  return { server, close };
}
