// input:  Node test runner + agent-adapter/claude/bg-task-tracker module
// output: BgTaskTracker pending-count + continuation-detection spec
// pos:    CC backend background-task continuation tracking unit tests
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';

import { BgTaskTracker, isContinuationResult, routeLine } from '../../src/agent-adapter/claude/bg-task-tracker.js';

// Real stream-json event shapes captured from `claude -p --input-format stream-json`
// when an agent launches a `run_in_background` Bash task (see /tmp/bg-capture.mjs).
const TASK_STARTED = { type: 'system', subtype: 'task_started', task_id: 'b6vp8rywx', task_type: 'local_bash', description: 'sleep' };
const TASK_UPDATED_DONE = { type: 'system', subtype: 'task_updated', task_id: 'b6vp8rywx', patch: { status: 'completed', end_time: 1781924971128 } };
const TASK_NOTIFICATION = { type: 'system', subtype: 'task_notification', task_id: 'b6vp8rywx', status: 'completed', summary: 'done' };
const RESULT_FIRST = { type: 'result', subtype: 'success', is_error: false };
const RESULT_CONTINUATION = { type: 'result', subtype: 'success', is_error: false, origin: { kind: 'task-notification' } };

test('BgTaskTracker: task_started increments pending by task_id', () => {
  const t = new BgTaskTracker();
  assert.equal(t.pendingCount, 0);
  t.observe(TASK_STARTED);
  assert.equal(t.pendingCount, 1);
  assert.equal(t.hasPending(), true);
});

test('BgTaskTracker: pending is 1 at first result, 0 after completion signals', () => {
  const t = new BgTaskTracker();
  t.observe(TASK_STARTED);
  t.observe(RESULT_FIRST);
  // First result fires while the background task is still running.
  assert.equal(t.pendingCount, 1, 'task still pending at RESULT #1');
  t.observe(TASK_UPDATED_DONE);
  t.observe(TASK_NOTIFICATION);
  assert.equal(t.pendingCount, 0, 'task cleared after completion');
});

test('BgTaskTracker: task_updated{completed} does NOT clear pending; only task_notification does', () => {
  const t = new BgTaskTracker();
  t.observe(TASK_STARTED);
  t.observe(TASK_UPDATED_DONE);
  // task_updated marks the task's WORK as finished, but the CLI emits the model-reinvoking
  // task_notification LATER (observed gaps up to ~24s). Pending must stay until that
  // notification arrives, otherwise the turn seals before the continuation is delivered.
  assert.equal(t.pendingCount, 1, 'task_updated must not clear pending');
  t.observe(TASK_NOTIFICATION);
  assert.equal(t.pendingCount, 0, 'task_notification (the delivery signal) clears pending');
  // A duplicate notification for the same id must not drive the count negative.
  t.observe(TASK_NOTIFICATION);
  assert.equal(t.pendingCount, 0);
});

// Regression for the premature-"completion" bug: with 5 parallel run_in_background tasks,
// the CLI emits task_updated{completed} for a task SECONDS before its task_notification (the
// event that re-invokes the model / drives the continuation turn). pendingCount must not reach
// 0 until the LAST notification arrives — otherwise a continuation turn whose result is
// processed in the gap snapshots pending==0 and the turn is sealed "done" before the final
// background task's continuation is delivered. Synthetic sequence mirroring the structural
// pattern only — no real session content.
test('BgTaskTracker regression: pending stays >0 until the LAST notification, even after all task_updated arrive', () => {
  const t = new BgTaskTracker();
  const ids = ['r1', 'r2', 'r3', 'r4', 'r5'];
  for (const id of ids) t.observe({ type: 'system', subtype: 'task_started', task_id: id });
  assert.equal(t.pendingCount, 5);

  // All five task_updated{completed} arrive first (the "work done" signals).
  for (const id of ids) {
    t.observe({ type: 'system', subtype: 'task_updated', task_id: id, patch: { status: 'completed' } });
  }
  // The bug would make pendingCount === 0 here (sealing early). Correct behavior: still 5.
  assert.equal(t.pendingCount, 5, 'task_updated must not decrement pending — notifications still undelivered');

  // Notifications trickle in one at a time (each re-invokes the model → continuation turn).
  for (let i = 0; i < ids.length; i++) {
    t.observe({ type: 'system', subtype: 'task_notification', task_id: ids[i], status: 'completed' });
    const expected = ids.length - (i + 1);
    assert.equal(t.pendingCount, expected, `pending should be ${expected} after notification ${i + 1}`);
  }
  assert.equal(t.pendingCount, 0, 'pending clears only after the final notification');
});

test('BgTaskTracker: task_updated with non-completed status does not clear pending', () => {
  const t = new BgTaskTracker();
  t.observe(TASK_STARTED);
  t.observe({ type: 'system', subtype: 'task_updated', task_id: 'b6vp8rywx', patch: { status: 'running' } });
  assert.equal(t.pendingCount, 1);
});

test('BgTaskTracker: task_notification arms continuation; disarm clears it', () => {
  const t = new BgTaskTracker();
  t.observe(TASK_STARTED);
  assert.equal(t.continuationArmed, false);
  t.observe(TASK_NOTIFICATION);
  assert.equal(t.continuationArmed, true);
  t.disarmContinuation();
  assert.equal(t.continuationArmed, false);
});

test('BgTaskTracker: multiple concurrent tasks counted independently', () => {
  const t = new BgTaskTracker();
  t.observe({ type: 'system', subtype: 'task_started', task_id: 'a1' });
  t.observe({ type: 'system', subtype: 'task_started', task_id: 'a2' });
  assert.equal(t.pendingCount, 2);
  t.observe({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'completed' });
  assert.equal(t.pendingCount, 1);
  assert.equal(t.hasPending(), true);
  t.observe({ type: 'system', subtype: 'task_notification', task_id: 'a2', status: 'completed' });
  assert.equal(t.pendingCount, 0);
});

test('BgTaskTracker: ignores non-system events and malformed payloads', () => {
  const t = new BgTaskTracker();
  t.observe(null);
  t.observe(undefined);
  t.observe({ type: 'assistant' });
  t.observe({ type: 'system', subtype: 'init', model: 'x' });
  t.observe({ type: 'system', subtype: 'task_started' }); // no task_id
  assert.equal(t.pendingCount, 0);
});

test('routeLine: any line during an active turn routes normally', () => {
  const t = new BgTaskTracker();
  t.observe(TASK_NOTIFICATION); // armed, but a turn is active
  assert.equal(routeLine(t, { type: 'assistant' }, true), 'normal');
  assert.equal(routeLine(t, RESULT_FIRST, true), 'normal');
});

test('routeLine: assistant with no active turn + armed → open-continuation', () => {
  const t = new BgTaskTracker();
  t.observe(TASK_STARTED);
  t.observe(TASK_NOTIFICATION);
  assert.equal(routeLine(t, { type: 'assistant', message: {} }, false), 'open-continuation');
});

test('routeLine: assistant with no active turn but NOT armed → ignore (preserve current drop behavior)', () => {
  const t = new BgTaskTracker();
  assert.equal(routeLine(t, { type: 'assistant', message: {} }, false), 'ignore');
});

test('routeLine: non-assistant lines with no active turn → ignore', () => {
  const t = new BgTaskTracker();
  t.observe(TASK_NOTIFICATION);
  assert.equal(routeLine(t, { type: 'system', subtype: 'init' }, false), 'ignore');
  assert.equal(routeLine(t, RESULT_CONTINUATION, false), 'ignore');
});

test('isContinuationResult: true only for result with origin.kind=task-notification', () => {
  assert.equal(isContinuationResult(RESULT_CONTINUATION), true);
  assert.equal(isContinuationResult(RESULT_FIRST), false);
  assert.equal(isContinuationResult({ type: 'assistant', origin: { kind: 'task-notification' } }), false);
  assert.equal(isContinuationResult(null), false);
});
