// input:  getConfig() → { serverUrl, token } + spaDir (path to built web/dist) + port
// output: createProxyServer(opts) → Promise<{ port, close() }>
// pos:    Loopback HTTP server for the Cortex Desktop shell. Mirrors ui-http-server.ts
//         (agent-server/src/platform/ui-http/) but instead of mounting a local tRPC
//         router, it reverse-proxies /trpc to a remote serverUrl, injecting x-cortex-token.
//         The BrowserWindow loads http://127.0.0.1:<port> so the SPA's relative /trpc
//         URL resolves same-origin; the SPA source is unchanged (zero web/src edits).
//
//         Token flow: browser SPA sends no token (EventSource cannot set headers);
//         this proxy injects x-cortex-token from config on every /trpc forward, mirroring
//         the Vite dev-proxy behaviour (vite.config.ts proxy.configure).

import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConfigStore } from './config-store.js';

/** Path prefix that routes to the upstream tRPC server. */
const TRPC_BASE_PATH = '/trpc';

/**
 * Hop-by-hop headers that must not be forwarded across a proxy boundary.
 * See RFC 7230 §6.1.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
]);

/** MIME types for static SPA asset serving (mirrors ui-http-server.ts). */
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

export interface ProxyServerOptions {
  /** Config accessor — called per-request so hot-reload is possible without restart. */
  getConfig: () => ConfigStore;
  /** Absolute path to the built web/dist directory to serve for non-/trpc paths. */
  spaDir: string;
  /** TCP port to listen on. 0 = ephemeral (OS picks; actual port returned in result). */
  port?: number;
  /** Host to bind. Defaults to 127.0.0.1 (loopback — not exposed to the network). */
  host?: string;
}

export interface ProxyServer {
  /** Actual bound port (useful when opts.port was 0). */
  port: number;
  /** Graceful shutdown: drains existing connections, resolves when server is closed. */
  close: () => Promise<void>;
}

// ── SPA static file handler (verbatim from ui-http-server.ts) ────────────────

function serveSpa(req: http.IncomingMessage, res: http.ServerResponse, spaDir: string): void {
  if (!fs.existsSync(spaDir)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Cortex UI not built');
    return;
  }

  let urlPath: string;
  try {
    urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const root = path.resolve(spaDir);
  const requested = path.resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath));

  // Path-traversal guard: resolved target must remain inside the SPA root.
  if (requested !== root && !requested.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const indexPath = path.join(root, 'index.html');
  const target =
    fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : indexPath;

  if (!fs.existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const stream = fs.createReadStream(target);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end();
  });
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
  stream.pipe(res);
}

// ── Reverse-proxy handler ─────────────────────────────────────────────────────

function proxyTrpc(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  getConfig: () => ConfigStore,
): void {
  const config = getConfig();

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(req.url!, config.serverUrl);
  } catch {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Gateway: invalid upstream URL');
    return;
  }

  // Build upstream request headers: strip hop-by-hop, override host, inject token.
  const upstreamHeaders: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) {
      upstreamHeaders[k] = v as string | string[];
    }
  }
  upstreamHeaders['host'] = upstreamUrl.host;
  upstreamHeaders['x-cortex-token'] = config.token;

  const mod = upstreamUrl.protocol === 'https:' ? https : http;

  const proxyReq = mod.request(
    {
      protocol: upstreamUrl.protocol,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port !== '' ? upstreamUrl.port : (upstreamUrl.protocol === 'https:' ? 443 : 80),
      path: upstreamUrl.pathname + upstreamUrl.search,
      method: req.method,
      headers: upstreamHeaders,
    },
    (proxyRes) => {
      // Build response headers: strip hop-by-hop, pass the rest through.
      const responseHeaders: http.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) {
          responseHeaders[k] = v;
        }
      }
      res.writeHead(proxyRes.statusCode!, responseHeaders);
      // Pipe directly — works for both buffered JSON and streaming SSE.
      proxyRes.pipe(res);
      proxyRes.on('error', () => { if (!res.destroyed) res.end(); });
    },
  );

  proxyReq.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[proxy-server] upstream error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Bad Gateway: ${err.message}`);
    }
  });

  // Forward the request body (required for tRPC POST mutations/queries).
  req.pipe(proxyReq);
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Creates and starts a loopback HTTP server that:
 * - Reverse-proxies /trpc/* to config.serverUrl with x-cortex-token injected.
 * - Serves the built SPA (spaDir) for all other paths, falling back to index.html
 *   for unknown routes (client-side React Router navigation).
 *
 * Returns a Promise that resolves once the server is listening.
 */
export function createProxyServer(opts: ProxyServerOptions): Promise<ProxyServer> {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 0;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    // Route /trpc and /trpc/* to the upstream proxy; everything else → SPA.
    const urlBase = url.split('?')[0];
    if (urlBase === TRPC_BASE_PATH || urlBase.startsWith(TRPC_BASE_PATH + '/')) {
      proxyTrpc(req, res, opts.getConfig);
    } else {
      serveSpa(req, res, opts.spaDir);
    }
  });

  return new Promise<ProxyServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = addr && typeof addr !== 'string' ? addr.port : port;
      console.log(`[proxy-server] listening on ${host}:${boundPort}`);
      resolve({
        port: boundPort,
        close: (): Promise<void> =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}
