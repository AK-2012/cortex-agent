// input:  Node test runner + createUiHttpServer (transport-host) + a FAKE tRPC router
// output: integration tests — 401 gate, HTTP query roundtrip, SSE subscription event,
//         127.0.0.1 bind, SPA static stub (present/absent), clean close()
// pos:    Regression guard for the Web UI tRPC HTTP+SSE transport-host (task d7c2, edf0/B).
//         Generic over AnyRouter — builds its own tiny router, no dependency on the real AppRouter.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import './_test-home.js'; // MUST be first: isolate CORTEX_HOME before paths.ts loads
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createUiHttpServer } from '../src/platform/ui-http/ui-http-server.js';

const TOKEN = 'test-ui-token-xyz';
const INDEX_MARKER = '<!-- CORTEX-UI-STUB-INDEX -->';
const SSE_MARKER = 'EVENT_ONE_MARKER';

// ── Fake router (built off @trpc/server directly — no real AppRouter dependency) ──
const t = initTRPC.create();
const fakeRouter = t.router({
  ping: t.procedure.input(z.object({ v: z.string() })).query(({ input }) => ({ echoed: input.v })),
  tick: t.procedure.subscription(async function* ({ signal }) {
    yield { marker: SSE_MARKER, n: 1 };
    // Stay open until the client/server aborts, so close() must force-close a live SSE socket.
    await new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener('abort', () => resolve());
    });
  }),
});

const servers: Array<{ close: () => Promise<void> }> = [];
const tmpDirs: string[] = [];
after(async () => {
  for (const s of servers) await s.close().catch(() => {});
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

async function boot(opts: { spaDir?: string; getToken?: () => string } = {}) {
  const inst = createUiHttpServer({
    router: fakeRouter,
    getToken: opts.getToken ?? (() => TOKEN),
    port: 0,
    host: '127.0.0.1',
    spaDir: opts.spaDir,
  });
  servers.push(inst);
  if (!inst.server.listening) {
    await new Promise<void>((resolve, reject) => {
      inst.server.once('listening', () => resolve());
      inst.server.once('error', reject);
    });
  }
  const addr = inst.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no TCP address');
  return { inst, port: addr.port, host: addr.address };
}

interface Res { statusCode: number; body: string }
function get(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

function encInput(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

test('bind: server listens on 127.0.0.1', async () => {
  const { host } = await boot();
  assert.equal(host, '127.0.0.1');
});

test('auth: tRPC request without a token is rejected 401', async () => {
  const { port } = await boot();
  const { statusCode } = await get(port, `/trpc/ping?input=${encInput({ v: 'hi' })}`);
  assert.equal(statusCode, 401);
});

test('auth: tRPC request with a wrong token is rejected 401', async () => {
  const { port } = await boot();
  const { statusCode } = await get(port, `/trpc/ping?input=${encInput({ v: 'hi' })}`, { 'x-cortex-token': 'nope' });
  assert.equal(statusCode, 401);
});

test('query: HTTP query roundtrip with the correct token returns 200 + data', async () => {
  const { port } = await boot();
  const { statusCode, body } = await get(port, `/trpc/ping?input=${encInput({ v: 'hello' })}`, { 'x-cortex-token': TOKEN });
  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.deepEqual(parsed.result.data, { echoed: 'hello' });
});

test('subscription: SSE receives one event', async () => {
  const { port } = await boot();
  const received = await new Promise<string>((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/trpc/tick', headers: { 'x-cortex-token': TOKEN, Accept: 'text/event-stream' } },
      (res) => {
        assert.equal(res.statusCode, 200);
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          if (buf.includes(SSE_MARKER)) { req.destroy(); resolve(buf); }
        });
        res.on('error', () => { /* destroyed by us */ });
      },
    );
    req.on('error', (e) => { if (!String(e).includes('aborted')) reject(e); });
    setTimeout(() => reject(new Error('SSE timeout — no event received')), 5000).unref();
  });
  assert.ok(received.includes(SSE_MARKER));
});

test('static stub: spaDir present serves index.html', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-spa-'));
  tmpDirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), `<html><body>${INDEX_MARKER}</body></html>`);
  const { port } = await boot({ spaDir: dir });
  const { statusCode, body } = await get(port, '/');
  assert.equal(statusCode, 200);
  assert.ok(body.includes(INDEX_MARKER));
});

test('static stub: spaDir absent returns 404 placeholder', async () => {
  const { port } = await boot({ spaDir: undefined });
  const { statusCode } = await get(port, '/');
  assert.equal(statusCode, 404);
});

test('static stub: path traversal is rejected', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cortex-spa-'));
  tmpDirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), `<html>${INDEX_MARKER}</html>`);
  const { port } = await boot({ spaDir: dir });
  const { statusCode } = await get(port, '/../../etc/passwd');
  assert.ok(statusCode === 403 || statusCode === 404, `expected 403/404, got ${statusCode}`);
});

test('close: shuts down cleanly (subsequent request refused)', async () => {
  const { inst, port } = await boot();
  await inst.close();
  await assert.rejects(get(port, `/trpc/ping?input=${encInput({ v: 'x' })}`, { 'x-cortex-token': TOKEN }));
});
