// input:  Node test runner + startUiHttpServer (entry wiring) + a FAKE UiService
// output: integration tests — env gate (enabled/disabled), default port 3004, token 401,
//         HTTP query roundtrip, HTTP mutate roundtrip, SSE subscription event, clean close()
// pos:    Regression guard for the entry-layer wiring that builds createAppRouter(uiService)
//         and starts createUiHttpServer on CORTEX_UI_PORT behind getClientToken (task 3af2, edf0/C).
//         Drives the REAL wiring code path with an injected fake UiService (analogous to the
//         transport-host test's fake router) — proves the injected service threads through to a
//         token-gated HTTP/SSE server on the configured port.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import './_test-home.js'; // MUST be first: isolate CORTEX_HOME before paths.ts loads
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { startUiHttpServer } from '../src/entry/start-ui-http.js';
import type { UiService, UiEvent } from '../src/domain/ui-service/types.js';

const TOKEN = 'test-wiring-token';
const SSE_MARKER = 'WIRING_EVENT_MARKER';

// ── Fake UiService: deterministic Ok data for one query + one mutate + a subscription ──
function makeFakeUiService(): UiService {
  return {
    query: (async (scope: string) => {
      if (scope === 'projects.list') {
        return { ok: true, data: [{ id: 'demo', kind: 'general', contextDir: '/x', hasMission: false, conduits: {} }] };
      }
      return { ok: false, code: 'not-found', message: `unexpected scope ${scope}` };
    }) as UiService['query'],
    mutate: (async (op: string) => {
      if (op === 'threads.cancel') return { ok: true, data: { cancelled: true } };
      return { ok: false, code: 'not-found', message: `unexpected op ${op}` };
    }) as UiService['mutate'],
    subscribe: () => makeOneShotStream(),
    subscribeExecutionLog: () => makeOneShotStream(),
  };
}

/** One-shot subscription stub: yields a single SSE marker event, then ends. */
function makeOneShotStream(): AsyncIterable<UiEvent> & { close(): void } {
  let done = false;
  const iterator: AsyncIterator<UiEvent> = {
    async next() {
      if (done) return { value: undefined as unknown as UiEvent, done: true };
      done = true;
      return { value: { type: SSE_MARKER, ts: new Date().toISOString(), payload: { n: 1 } }, done: false };
    },
  };
  return {
    [Symbol.asyncIterator]: () => iterator,
    close: () => { done = true; },
  };
}

const servers: Array<{ close: () => Promise<void> }> = [];
after(async () => {
  for (const s of servers) await s.close().catch(() => {});
});

async function boot(env: Record<string, string>) {
  const inst = startUiHttpServer({ uiService: makeFakeUiService(), getToken: () => TOKEN, env });
  if (inst) {
    servers.push(inst);
    if (!inst.server.listening) {
      await new Promise<void>((resolve, reject) => {
        inst.server.once('listening', () => resolve());
        inst.server.once('error', reject);
      });
    }
  }
  return inst;
}

function portOf(inst: { server: http.Server }): number {
  const addr = inst.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no TCP address');
  return addr.port;
}

interface Res { statusCode: number; body: string }
function req(
  port: number,
  method: 'GET' | 'POST',
  urlPath: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: buf }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));

test('env gate: disabled (unset) returns null — clean skip', () => {
  const inst = startUiHttpServer({ uiService: makeFakeUiService(), env: {} });
  assert.equal(inst, null);
});

test('env gate: enabled binds 127.0.0.1 and defaults to port 3004', async () => {
  const inst = await boot({ CORTEX_UI_HTTP: '1' });
  assert.ok(inst, 'expected a server when enabled');
  const addr = inst!.server.address();
  assert.ok(addr && typeof addr !== 'string');
  assert.equal((addr as { address: string }).address, '127.0.0.1');
  assert.equal((addr as { port: number }).port, 3004);
});

test('auth: query without a token is rejected 401', async () => {
  const inst = await boot({ CORTEX_UI_HTTP: '1', CORTEX_UI_PORT: '0' });
  const { statusCode } = await req(portOf(inst!), 'GET', `/trpc/projects.list?input=${enc({})}`);
  assert.equal(statusCode, 401);
});

test('query: HTTP query roundtrip returns real data from the injected UiService', async () => {
  const inst = await boot({ CORTEX_UI_HTTP: '1', CORTEX_UI_PORT: '0' });
  const { statusCode, body } = await req(
    portOf(inst!), 'GET', `/trpc/projects.list?input=${enc({})}`, { 'x-cortex-token': TOKEN },
  );
  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.deepEqual(parsed.result.data, [{ id: 'demo', kind: 'general', contextDir: '/x', hasMission: false, conduits: {} }]);
});

test('mutate: HTTP mutation roundtrip routes to the injected UiService and unwraps Result', async () => {
  const inst = await boot({ CORTEX_UI_HTTP: '1', CORTEX_UI_PORT: '0' });
  const { statusCode, body } = await req(
    portOf(inst!), 'POST', '/trpc/threads.cancel',
    { 'x-cortex-token': TOKEN, 'content-type': 'application/json' },
    JSON.stringify({ threadId: 'abc' }),
  );
  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.deepEqual(parsed.result.data, { cancelled: true });
});

test('subscription: SSE receives an event from the injected UiService', async () => {
  const inst = await boot({ CORTEX_UI_HTTP: '1', CORTEX_UI_PORT: '0' });
  const port = portOf(inst!);
  const received = await new Promise<string>((resolve, reject) => {
    const r = http.get(
      { host: '127.0.0.1', port, path: `/trpc/subscribe?input=${enc({ events: ['*'] })}`,
        headers: { 'x-cortex-token': TOKEN, Accept: 'text/event-stream' } },
      (res) => {
        assert.equal(res.statusCode, 200);
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          if (buf.includes(SSE_MARKER)) { r.destroy(); resolve(buf); }
        });
        res.on('error', () => { /* destroyed by us */ });
      },
    );
    r.on('error', (e) => { if (!String(e).includes('aborted')) reject(e); });
    setTimeout(() => reject(new Error('SSE timeout — no event received')), 5000).unref();
  });
  assert.ok(received.includes(SSE_MARKER));
});

test('close: shuts down cleanly (subsequent request refused)', async () => {
  const inst = await boot({ CORTEX_UI_HTTP: '1', CORTEX_UI_PORT: '0' });
  const port = portOf(inst!);
  await inst!.close();
  await assert.rejects(req(port, 'GET', `/trpc/projects.list?input=${enc({})}`, { 'x-cortex-token': TOKEN }));
});
