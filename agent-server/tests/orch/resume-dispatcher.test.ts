// input:  Node test runner + resume-dispatcher (deps injected)
// output: direct/thread dispatch + guard (stale/busy/missing/terminal) + flag/drain tests
// pos:    Validate orchestration/resume-dispatcher.ts auto-resume behavior
// >>> If I am updated, update my require first <<<
import '../_test-home.js'; // MUST be first — isolates store singletons
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchPendingResumes, buildResumeReminder, isAutoResumeEnabled } from '../../src/orchestration/resume-dispatcher.js';
import { MockAdapter } from '../../src/platform/testing.js';
import type { ResumeEntry } from '../../src/domain/costs/resume-registry.js';

const NOW = 1_000_000_000_000;

function baseDeps(entries: ResumeEntry[], overrides: any = {}) {
  const calls = { route: [] as any[], continue: [] as any[], taken: 0 };
  const deps = {
    takeAll: () => { calls.taken++; return entries; },
    route: async (ctx: any) => { calls.route.push(ctx); },
    continueThread: async (threadId: string, msg: string, opts: any) => { calls.continue.push({ threadId, msg, opts }); },
    getThread: (_id: string) => ({ id: _id, status: 'running', channel: 'C1', projectId: 'proj' }) as any,
    channelBusy: (_c: string) => false,
    now: () => NOW,
    delay: async (_ms: number) => {},
    ...overrides,
  };
  return { deps, calls };
}

test('isAutoResumeEnabled defaults true, false only for 0/false', () => {
  const prev = process.env.CORTEX_AUTO_RESUME;
  delete process.env.CORTEX_AUTO_RESUME;
  assert.equal(isAutoResumeEnabled(), true);
  process.env.CORTEX_AUTO_RESUME = '0';
  assert.equal(isAutoResumeEnabled(), false);
  process.env.CORTEX_AUTO_RESUME = 'false';
  assert.equal(isAutoResumeEnabled(), false);
  process.env.CORTEX_AUTO_RESUME = '1';
  assert.equal(isAutoResumeEnabled(), true);
  if (prev === undefined) delete process.env.CORTEX_AUTO_RESUME; else process.env.CORTEX_AUTO_RESUME = prev;
});

test('buildResumeReminder is wrapped in a system-reminder', () => {
  const r = buildResumeReminder();
  assert.ok(r.startsWith('<system-reminder>'));
  assert.ok(r.trimEnd().endsWith('</system-reminder>'));
});

test('direct entry routes a synthetic system-reminder message', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const { deps, calls } = baseDeps([
    { kind: 'direct', channel: 'C1', userMessage: 'orig', recordedAt: NOW },
  ]);
  await dispatchPendingResumes(adapter as any, deps);

  assert.equal(calls.route.length, 1);
  const ctx = calls.route[0];
  assert.equal(ctx.channel, 'C1');
  assert.equal(ctx.threadAnchorId, null);
  assert.equal(ctx.hasFiles, false);
  assert.equal(ctx.message.kind, 'user');
  assert.equal(ctx.message.senderId, 'cortex-rate-limit-resume');
  assert.ok(ctx.message.text.includes('<system-reminder>'));
  assert.equal(ctx.message.ref.conduit, 'C1');
});

test('thread entry continues the thread with project-report destination', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const { deps, calls } = baseDeps([
    { kind: 'thread', threadId: 'thr_a', channel: 'C2', userMessage: 'go', recordedAt: NOW },
  ]);
  await dispatchPendingResumes(adapter as any, deps);

  assert.equal(calls.continue.length, 1);
  assert.equal(calls.continue[0].threadId, 'thr_a');
  assert.ok(calls.continue[0].msg.includes('<system-reminder>'));
  assert.equal(calls.continue[0].opts.channel, 'C2');
  assert.equal(calls.continue[0].opts.destination.type, 'project-report');
  assert.equal(calls.continue[0].opts.destination.projectId, 'proj');
});

test('stale entry is dropped (older than max age)', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const old = NOW - (7 * 60 * 60 * 1000); // 7h ago
  const { deps, calls } = baseDeps([
    { kind: 'direct', channel: 'C1', userMessage: 'orig', recordedAt: old },
  ]);
  await dispatchPendingResumes(adapter as any, deps);
  assert.equal(calls.route.length, 0);
});

test('entry on a busy channel is dropped', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const { deps, calls } = baseDeps(
    [{ kind: 'direct', channel: 'C1', userMessage: 'orig', recordedAt: NOW }],
    { channelBusy: (_c: string) => true },
  );
  await dispatchPendingResumes(adapter as any, deps);
  assert.equal(calls.route.length, 0);
});

test('thread entry dropped when thread no longer exists', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const { deps, calls } = baseDeps(
    [{ kind: 'thread', threadId: 'gone', channel: 'C2', userMessage: 'go', recordedAt: NOW }],
    { getThread: (_id: string) => null },
  );
  await dispatchPendingResumes(adapter as any, deps);
  assert.equal(calls.continue.length, 0);
});

test('thread entry dropped when thread is terminal', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const { deps, calls } = baseDeps(
    [{ kind: 'thread', threadId: 'thr_a', channel: 'C2', userMessage: 'go', recordedAt: NOW }],
    { getThread: (_id: string) => ({ id: _id, status: 'completed', channel: 'C2', projectId: 'proj' }) as any },
  );
  await dispatchPendingResumes(adapter as any, deps);
  assert.equal(calls.continue.length, 0);
});

test('disabled flag drains the queue without dispatching', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const prev = process.env.CORTEX_AUTO_RESUME;
  process.env.CORTEX_AUTO_RESUME = '0';
  const { deps, calls } = baseDeps([
    { kind: 'direct', channel: 'C1', userMessage: 'orig', recordedAt: NOW },
  ]);
  await dispatchPendingResumes(adapter as any, deps);
  assert.equal(calls.taken, 1, 'queue must be drained');
  assert.equal(calls.route.length, 0, 'no dispatch when disabled');
  if (prev === undefined) delete process.env.CORTEX_AUTO_RESUME; else process.env.CORTEX_AUTO_RESUME = prev;
});

test('takeAll is invoked exactly once per dispatch', async () => {
  const adapter = new MockAdapter({ adminChannel: 'admin' });
  const { deps, calls } = baseDeps([
    { kind: 'direct', channel: 'C1', userMessage: 'a', recordedAt: NOW },
    { kind: 'thread', threadId: 'thr_b', channel: 'C2', userMessage: 'b', recordedAt: NOW },
  ]);
  await dispatchPendingResumes(adapter as any, deps);
  assert.equal(calls.taken, 1);
  assert.equal(calls.route.length, 1);
  assert.equal(calls.continue.length, 1);
});
