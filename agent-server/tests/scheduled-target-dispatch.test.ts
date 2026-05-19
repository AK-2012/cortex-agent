// input:  Node test runner + planScheduledDispatch (pure planner)
// output: 4-way target dispatch + fallback policy regression
// pos:    locks the dispatch decision tree extracted from scheduled-task.ts so the
//         orchestration around it (Slack / executions / progress) stays untouched.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { planScheduledDispatch, type DispatchPlan } from '../src/domain/scheduling/jobs/target-dispatch.js';
import type { ScheduleTarget } from '../src/store/schedule-repo.js';

function lookups(overrides: Partial<Parameters<typeof planScheduledDispatch>[0]['lookups']> = {}) {
  return {
    findActiveThread: () => null,
    getChannelSession: async () => undefined,
    lookupSession: async () => null,
    getThread: () => null,
    ...overrides,
  };
}

// --- target=fresh ---

test('plan: target=fresh always returns { kind: "fresh" }', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'fresh' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups(),
  });
  assert.deepEqual(plan, { kind: 'fresh', channel: 'C1' });
});

test('plan: undefined target falls back to fresh', async () => {
  const plan = await planScheduledDispatch({
    target: undefined,
    fallback: undefined,
    fallbackChannel: 'C1',
    lookups: lookups(),
  });
  assert.deepEqual(plan, { kind: 'fresh', channel: 'C1' });
});

// --- target=channel ---

test('plan: target=channel with active thread → continue that thread', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'channel', channel: 'CX' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups({
      findActiveThread: (channel) => channel === 'CX' ? { id: 'thr_active', status: 'running' } as any : null,
    }),
  });
  assert.deepEqual(plan, { kind: 'continue-thread', channel: 'CX', threadId: 'thr_active' });
});

test('plan: target=channel without active thread → channel-default with resolved sessionId', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'channel', channel: 'CX' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups({
      findActiveThread: () => null,
      getChannelSession: async (channel) => channel === 'CX' ? 'sess-uuid-xyz' : undefined,
    }),
  });
  assert.deepEqual(plan, { kind: 'default-thread', channel: 'CX', existingSessionId: 'sess-uuid-xyz' });
});

test('plan: target=channel with no active thread and no session → default with null sessionId (fresh-ish but in channel)', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'channel', channel: 'CY' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups(),
  });
  assert.deepEqual(plan, { kind: 'default-thread', channel: 'CY', existingSessionId: null });
});

// --- target=session ---

test('plan: target=session with valid session record → default-thread reusing sessionId', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'session', sessionName: 'cortex-abc', sessionId: 'sess-1', channel: 'CZ' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups({
      lookupSession: async (name) => name === 'cortex-abc' ? { sessionId: 'sess-1', channel: 'CZ' } as any : null,
    }),
  });
  assert.deepEqual(plan, { kind: 'default-thread', channel: 'CZ', existingSessionId: 'sess-1' });
});

test('plan: target=session record missing + fallback=fresh → fresh on the original task channel', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'session', sessionName: 'cortex-gone', sessionId: 'sess-old', channel: 'CZ' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups({ lookupSession: async () => null }),
  });
  assert.deepEqual(plan, { kind: 'fresh', channel: 'C1' });
});

test('plan: target=session record missing + fallback=skip → skip with reason', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'session', sessionName: 'cortex-gone', sessionId: 'sess-old', channel: 'CZ' },
    fallback: 'skip',
    fallbackChannel: 'C1',
    lookups: lookups({ lookupSession: async () => null }),
  });
  assert.equal(plan.kind, 'skip');
  assert.match((plan as { reason: string }).reason, /session/i);
});

// --- target=thread ---

test('plan: target=thread running → continue-thread', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'thread', threadId: 'thr_live', channel: 'CT' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups({
      getThread: (id) => id === 'thr_live' ? { id: 'thr_live', channel: 'CT', status: 'running' } as any : null,
    }),
  });
  assert.deepEqual(plan, { kind: 'continue-thread', channel: 'CT', threadId: 'thr_live' });
});

test('plan: target=thread waiting → continue-thread', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'thread', threadId: 'thr_wait', channel: 'CT' },
    fallback: 'fresh',
    fallbackChannel: 'C1',
    lookups: lookups({
      getThread: () => ({ id: 'thr_wait', channel: 'CT', status: 'waiting' } as any),
    }),
  });
  assert.equal(plan.kind, 'continue-thread');
});

test('plan: target=thread terminal status + fallback=skip → skip', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'thread', threadId: 'thr_done', channel: 'CT' },
    fallback: 'skip',
    fallbackChannel: 'C1',
    lookups: lookups({
      getThread: () => ({ id: 'thr_done', channel: 'CT', status: 'completed' } as any),
    }),
  });
  assert.equal(plan.kind, 'skip');
  assert.match((plan as { reason: string }).reason, /thread/i);
});

test('plan: target=thread missing + default fallback (undefined) → fresh on fallback channel', async () => {
  const plan = await planScheduledDispatch({
    target: { kind: 'thread', threadId: 'thr_404', channel: 'CT' },
    fallback: undefined,
    fallbackChannel: 'C1',
    lookups: lookups({ getThread: () => null }),
  });
  assert.deepEqual(plan, { kind: 'fresh', channel: 'C1' });
});
