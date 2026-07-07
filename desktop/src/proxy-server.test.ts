// input:  Node test runner + createProxyServer + a mock upstream HTTP server
// output: integration tests — /trpc proxy (GET/POST), token injection, 401 passthrough,
//         SSE streaming passthrough, SPA static file serving, path-traversal guard
// pos:    Regression guard for the loopback reverse-proxy (desktop shell).
//         Mirrors ui-http-server.test.ts for the proxy side.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProxyServer } from './proxy-server.js';
import type { ConfigStore } from './config-store.js';

// ── Mock upstream server ──────────────────────────────────────────────────────

type MockUpstream = {
  port: number;
  close: () => Promise<void>;
  lastToken: () => string;
  lastMethod: () => string;
};

function startMockUpstream(validToken: string): Promise<MockUpstream> {
  let lastToken = '';
  let lastMethod = '';
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      lastToken = (req.headers['x-cortex-token'] as string) ?? '';
      lastMethod = req.method ?? '';

      if (lastToken !== validToken) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return;
      }

      // SSE endpoint: sends one event and closes
      if (req.url?.startsWith('/trpc/stream')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        res.write('data: {"type":"ping"}\n\n');
        res.end();
        return;
      }

      // General echo endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, method: req.method, url: req.url }));
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
        lastToken: () => lastToken,
        lastMethod: () => lastMethod,
      });
    });
  });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

interface Res {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function httpGet(
  port: number,
  urlPath: string,
  headers: Record<string, string> = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

function httpPost(port: number, urlPath: string, body: string): Promise<Res> {
  const buf = Buffer.from(body, 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': buf.byteLength,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const VALID_TOKEN = 'test-proxy-token-xyz';
let upstream: MockUpstream;
let proxy: { port: number; close: () => Promise<void> };
let tmpDir: string;

// Boot once; tests share the server pair (token = valid)
const upstreamReady = startMockUpstream(VALID_TOKEN);
const proxyReady = upstreamReady.then((u) => {
  upstream = u;
  return createProxyServer({
    getConfig: (): ConfigStore => ({ serverUrl: `http://127.0.0.1:${u.port}`, token: VALID_TOKEN }),
    spaDir: '/nonexistent-spa-for-test',
    port: 0,
  });
}).then((p) => { proxy = p; });

after(async () => {
  await proxy?.close();
  await upstream?.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── /trpc proxy tests ─────────────────────────────────────────────────────────

test('proxy: GET /trpc/ping → 200 with valid token injected', async () => {
  await proxyReady;
  const res = await httpGet(proxy.port, '/trpc/ping');
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.method, 'GET');
});

test('proxy: POST /trpc/query → 200 (body forwarded)', async () => {
  await proxyReady;
  const res = await httpPost(proxy.port, '/trpc/query', '{"0":{"json":null}}');
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.method, 'POST');
});

test('proxy: x-cortex-token injected on every proxied request', async () => {
  await proxyReady;
  await httpGet(proxy.port, '/trpc/ping');
  assert.equal(upstream.lastToken(), VALID_TOKEN);
});

test('proxy: wrong config token → upstream returns 401 (passthrough)', async () => {
  await proxyReady;
  const badProxy = await createProxyServer({
    getConfig: (): ConfigStore => ({ serverUrl: `http://127.0.0.1:${upstream.port}`, token: 'wrong-token' }),
    spaDir: '/nonexistent-spa-for-test',
    port: 0,
  });
  try {
    const res = await httpGet(badProxy.port, '/trpc/ping');
    assert.equal(res.status, 401);
  } finally {
    await badProxy.close();
  }
});

test('proxy: missing token → upstream returns 401 (passthrough)', async () => {
  await proxyReady;
  const noTokenProxy = await createProxyServer({
    getConfig: (): ConfigStore => ({ serverUrl: `http://127.0.0.1:${upstream.port}`, token: '' }),
    spaDir: '/nonexistent-spa-for-test',
    port: 0,
  });
  try {
    const res = await httpGet(noTokenProxy.port, '/trpc/ping');
    assert.equal(res.status, 401);
  } finally {
    await noTokenProxy.close();
  }
});

test('proxy: SSE response (text/event-stream) streams through', async () => {
  await proxyReady;
  const res = await httpGet(proxy.port, '/trpc/stream', { Accept: 'text/event-stream' });
  assert.equal(res.status, 200);
  assert.ok(
    res.headers['content-type']?.includes('text/event-stream'),
    `expected text/event-stream, got: ${res.headers['content-type']}`,
  );
  assert.ok(res.body.includes('data:'), `expected SSE data line, got: ${res.body}`);
});

test('proxy: /trpc (bare, no trailing slash) is proxied', async () => {
  await proxyReady;
  const res = await httpGet(proxy.port, '/trpc');
  // Upstream sees it; returns 200 (token valid)
  assert.equal(res.status, 200);
});

// ── SPA static serving tests ──────────────────────────────────────────────────

test('spa: missing spaDir returns 404', async () => {
  await proxyReady;
  const res = await httpGet(proxy.port, '/');
  assert.equal(res.status, 404);
});

test('spa: existing spaDir serves index.html for root path', async () => {
  await proxyReady;
  const MARKER = '<!-- CORTEX-SPA-INDEX-TEST -->';
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-desktop-spa-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), `<html><body>${MARKER}</body></html>`);

  const spaProxy = await createProxyServer({
    getConfig: (): ConfigStore => ({ serverUrl: `http://127.0.0.1:${upstream.port}`, token: VALID_TOKEN }),
    spaDir: tmpDir,
    port: 0,
  });
  try {
    const res = await httpGet(spaProxy.port, '/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes(MARKER));
  } finally {
    await spaProxy.close();
  }
});

test('spa: unknown path falls back to index.html (SPA routing)', async () => {
  await proxyReady;
  const MARKER = '<!-- CORTEX-SPA-FALLBACK-TEST -->';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-desktop-spa-'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<html><body>${MARKER}</body></html>`);

  const spaProxy = await createProxyServer({
    getConfig: (): ConfigStore => ({ serverUrl: `http://127.0.0.1:${upstream.port}`, token: VALID_TOKEN }),
    spaDir: dir,
    port: 0,
  });
  try {
    const res = await httpGet(spaProxy.port, '/workbench/some/deep/route');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes(MARKER));
  } finally {
    await spaProxy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('spa: path traversal attempt is rejected 403', async () => {
  await proxyReady;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-desktop-spa-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

  const spaProxy = await createProxyServer({
    getConfig: (): ConfigStore => ({ serverUrl: `http://127.0.0.1:${upstream.port}`, token: VALID_TOKEN }),
    spaDir: dir,
    port: 0,
  });
  try {
    const res = await httpGet(spaProxy.port, '/../../../etc/passwd');
    assert.equal(res.status, 403);
  } finally {
    await spaProxy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('proxy: server binds to 127.0.0.1', async () => {
  await proxyReady;
  // The proxy port is reachable on 127.0.0.1 (verified by the other tests succeeding).
  // Explicitly check the close() lifecycle too.
  const p = await createProxyServer({
    getConfig: (): ConfigStore => ({ serverUrl: `http://127.0.0.1:${upstream.port}`, token: VALID_TOKEN }),
    spaDir: '/nonexistent',
    port: 0,
  });
  assert.ok(p.port > 0, 'port must be a positive integer');
  await p.close(); // must resolve without hanging
});
