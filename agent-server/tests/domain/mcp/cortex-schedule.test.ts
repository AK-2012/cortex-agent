// input:  Node test runner + cortex_schedule_* MCP tool helpers
// output: target shorthand resolution + tool registration regression
// pos:    locks the __current__ shorthand → concrete ScheduleTarget mapping that
//         cortex_schedule_add applies at create time (decided 2026-04: resolve at create,
//         not at fire — so the persisted record always shows real IDs in list output).
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargetShorthand, type CortexContextSnapshot } from '../../../src/domain/mcp/tools/schedule.js';

const FULL_CTX: CortexContextSnapshot = {
  channel: 'C123',
  sessionId: 'sess-uuid-1',
  sessionName: 'cortex-abc111',
  threadId: 'thr_xyz999',
  profile: 'fast-worker',
  project: 'cortex-self',
  backend: 'claude',
  scheduleTaskId: null,
  callbackSource: null,
};

// --- shorthand strings ---

test('resolveTargetShorthand: undefined target → fresh', () => {
  const out = resolveTargetShorthand(undefined, FULL_CTX);
  assert.deepEqual(out, { kind: 'fresh' });
});

test('resolveTargetShorthand: "fresh" string → fresh', () => {
  const out = resolveTargetShorthand('fresh', FULL_CTX);
  assert.deepEqual(out, { kind: 'fresh' });
});

test('resolveTargetShorthand: "current-channel" → resolved channel', () => {
  const out = resolveTargetShorthand('current-channel', FULL_CTX);
  assert.deepEqual(out, { kind: 'channel', channel: 'C123' });
});

test('resolveTargetShorthand: "current-session" → resolved session', () => {
  const out = resolveTargetShorthand('current-session', FULL_CTX);
  assert.deepEqual(out, { kind: 'session', sessionName: 'cortex-abc111', sessionId: 'sess-uuid-1', channel: 'C123' });
});

test('resolveTargetShorthand: "current-thread" → resolved thread', () => {
  const out = resolveTargetShorthand('current-thread', FULL_CTX);
  assert.deepEqual(out, { kind: 'thread', threadId: 'thr_xyz999', channel: 'C123' });
});

// --- shorthand error paths (context missing required fields) ---

test('resolveTargetShorthand: "current-channel" without channel → throws', () => {
  assert.throws(
    () => resolveTargetShorthand('current-channel', { ...FULL_CTX, channel: null }),
    /current-channel.*channel/i,
  );
});

test('resolveTargetShorthand: "current-session" without sessionName → throws', () => {
  assert.throws(
    () => resolveTargetShorthand('current-session', { ...FULL_CTX, sessionName: null }),
    /current-session.*session/i,
  );
});

test('resolveTargetShorthand: "current-thread" without threadId → throws (does not silently fall back to fresh)', () => {
  assert.throws(
    () => resolveTargetShorthand('current-thread', { ...FULL_CTX, threadId: null }),
    /current-thread.*thread/i,
  );
});

// --- object form passthrough + validation ---

test('resolveTargetShorthand: explicit { kind: "channel", channel } passes through', () => {
  const out = resolveTargetShorthand({ kind: 'channel', channel: 'C-explicit' }, FULL_CTX);
  assert.deepEqual(out, { kind: 'channel', channel: 'C-explicit' });
});

test('resolveTargetShorthand: explicit { kind: "session", ... } requires sessionName + sessionId + channel', () => {
  assert.throws(
    () => resolveTargetShorthand({ kind: 'session', sessionName: 'cortex-x' } as any, FULL_CTX),
    /session.*sessionId|channel/i,
  );
});

test('resolveTargetShorthand: explicit { kind: "thread", threadId, channel } passes through', () => {
  const out = resolveTargetShorthand({ kind: 'thread', threadId: 'thr_explicit', channel: 'C-other' }, FULL_CTX);
  assert.deepEqual(out, { kind: 'thread', threadId: 'thr_explicit', channel: 'C-other' });
});

test('resolveTargetShorthand: unknown shorthand string → throws', () => {
  assert.throws(
    () => resolveTargetShorthand('foo-bar' as any, FULL_CTX),
    /unknown target/i,
  );
});
