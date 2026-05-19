// input:  Node test runner, RunningExecutions + EventBus
// output: regression tests for RunningExecutions: three-index consistency, kill chains, event publishing
// pos:    validates Phase 1 Step 1 invariants — register/get/kill/remove across byKey/byThreadId/byExecutionId

import test from 'node:test';
import assert from 'node:assert/strict';
import { RunningExecutions } from '../../src/core/running-executions.js';
import type { RunningExecutionInput } from '../../src/core/running-executions.js';
import { EventBus } from '../../src/events/index.js';
import type { CortexEvent } from '../../src/events/index.js';

function makeInput(overrides: Partial<RunningExecutionInput> = {}): RunningExecutionInput {
  return {
    threadId: null,
    channel: null,
    agentSlotId: null,
    executionId: null,
    kill: () => true,
    backend: 'claude',
    ...overrides,
  };
}

function makeKillTracker(): { killed: boolean; kill: () => boolean } {
  let killed = false;
  return {
    get killed() { return killed; },
    kill() { killed = true; return true; },
  };
}

function collectEvents(bus: EventBus): CortexEvent[] {
  const events: CortexEvent[] = [];
  bus.subscribe('*', (e) => { events.push(e); });
  return events;
}

// ── Index consistency ─────────────────────────────────────────────────

test('register with key only: appears only in byKey', () => {
  const exec = new RunningExecutions();
  exec.register('C123', makeInput());

  assert.ok(exec.has('C123'));
  assert.ok(exec.getByKey('C123') !== null);
  assert.equal(exec.getByKey('C123')!.registryKey, 'C123');
  assert.equal(exec.getByThreadId('T1'), null);
  assert.equal(exec.getByExecutionId('E1'), null);
});

test('register with key + threadId: appears in byKey and byThreadId; remove cleans both', () => {
  const exec = new RunningExecutions();
  exec.register('C123', makeInput({ threadId: 'T1' }));

  assert.ok(exec.has('C123'));
  assert.equal(exec.getByThreadId('T1')!.registryKey, 'C123');

  exec.remove('C123');
  assert.equal(exec.has('C123'), false);
  assert.equal(exec.getByThreadId('T1'), null);
});

test('register with key + threadId + executionId: appears in all 3 indices; remove cleans all 3', () => {
  const exec = new RunningExecutions();
  exec.register('C123', makeInput({ threadId: 'T1', executionId: 'E1' }));

  assert.equal(exec.getByKey('C123')!.executionId, 'E1');
  assert.equal(exec.getByThreadId('T1')!.executionId, 'E1');
  assert.equal(exec.getByExecutionId('E1')!.registryKey, 'C123');

  exec.remove('C123');
  assert.equal(exec.getByKey('C123'), null);
  assert.equal(exec.getByThreadId('T1'), null);
  assert.equal(exec.getByExecutionId('E1'), null);
});

// ── Kill chain ────────────────────────────────────────────────────────

test('killByKey: calls kill(), removes from all indices, returns true; second call returns false', () => {
  const exec = new RunningExecutions();
  const handle = makeKillTracker();
  exec.register('C123', makeInput({ threadId: 'T1', executionId: 'E1', kill: () => handle.kill() }));

  const result1 = exec.killByKey('C123');
  assert.equal(result1, true);
  assert.equal(handle.killed, true);
  assert.equal(exec.has('C123'), false);
  assert.equal(exec.getByThreadId('T1'), null);
  assert.equal(exec.getByExecutionId('E1'), null);

  const result2 = exec.killByKey('C123');
  assert.equal(result2, false);
});

test('killByThreadId: resolves via byThreadId, calls kill(), cleans all indices', () => {
  const exec = new RunningExecutions();
  const handle = makeKillTracker();
  exec.register('C123', makeInput({ threadId: 'T1', executionId: 'E1', kill: () => handle.kill() }));

  const result = exec.killByThreadId('T1');
  assert.equal(result, true);
  assert.equal(handle.killed, true);
  assert.equal(exec.has('C123'), false);
  assert.equal(exec.getByThreadId('T1'), null);
  assert.equal(exec.getByExecutionId('E1'), null);

  const second = exec.killByThreadId('T1');
  assert.equal(second, false);
});

// ── Event publishing ──────────────────────────────────────────────────

test('register with executionId publishes agent.started', () => {
  const bus = new EventBus();
  const events = collectEvents(bus);
  const exec = new RunningExecutions(bus);

  exec.register('C123', makeInput({ channel: 'C123', executionId: 'exec-1', backend: 'claude' }));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent.started');
  if (events[0].type === 'agent.started') {
    assert.equal(events[0].channel, 'C123');
    assert.equal(events[0].executionId, 'exec-1');
    assert.equal(events[0].backend, 'claude');
  }
});

test('register without executionId does NOT publish agent.started', () => {
  const bus = new EventBus();
  const events = collectEvents(bus);
  const exec = new RunningExecutions(bus);

  exec.register('C123', makeInput());

  assert.equal(exec.has('C123'), true);
  assert.equal(events.length, 0, 'no executionId → no event');
});

test('complete publishes agent.completed with cost + durationMs and removes entry', async () => {
  const bus = new EventBus();
  const exec = new RunningExecutions(bus);
  exec.register('C123', makeInput({ channel: 'C123', executionId: 'exec-2', backend: 'codex' }));

  // Wait long enough for durationMs > 0
  await new Promise((r) => setTimeout(r, 5));

  const events = collectEvents(bus);
  const ok = exec.complete('C123', 0.42);

  assert.equal(ok, true);
  assert.equal(exec.has('C123'), false);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent.completed');
  if (events[0].type === 'agent.completed') {
    assert.equal(events[0].executionId, 'exec-2');
    assert.equal(events[0].cost, 0.42);
    assert.ok(events[0].durationMs >= 0);
  }

  // Second complete is a no-op
  const second = exec.complete('C123');
  assert.equal(second, false);
});

test('fail publishes agent.failed with error and removes entry', () => {
  const bus = new EventBus();
  const exec = new RunningExecutions(bus);
  exec.register('C123', makeInput({ channel: 'C123', executionId: 'exec-3', backend: 'claude' }));

  const events = collectEvents(bus);
  const ok = exec.fail('C123', 'boom');

  assert.equal(ok, true);
  assert.equal(exec.has('C123'), false);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent.failed');
  if (events[0].type === 'agent.failed') {
    assert.equal(events[0].executionId, 'exec-3');
    assert.equal(events[0].error, 'boom');
  }
});

test('supersede kills handle, removes entry, and publishes agent.superseded', () => {
  const bus = new EventBus();
  const exec = new RunningExecutions(bus);
  const handle = makeKillTracker();
  exec.register('C123', makeInput({
    channel: 'C123', executionId: 'exec-4', backend: 'claude',
    kill: () => handle.kill(),
  }));

  const events = collectEvents(bus);
  const ok = exec.supersede('C123', 'edit');

  assert.equal(ok, true);
  assert.equal(handle.killed, true, 'supersede must call kill()');
  assert.equal(exec.has('C123'), false);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent.superseded');
  if (events[0].type === 'agent.superseded') {
    assert.equal(events[0].executionId, 'exec-4');
    assert.equal(events[0].reason, 'edit');
  }
});

// ── Edge cases ────────────────────────────────────────────────────────

test('setBus after construction: events not published until bus is wired', () => {
  const exec = new RunningExecutions();
  exec.register('C123', makeInput({ channel: 'C123', executionId: 'exec-5', backend: 'claude' }));

  // No bus yet → no events. Now wire one.
  const bus = new EventBus();
  const events = collectEvents(bus);
  exec.setBus(bus);

  exec.complete('C123', 1.0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent.completed');
});

test('non-channel key (hookHandleKey): register with threadId=null, entry in byKey but not byThreadId', () => {
  const exec = new RunningExecutions();
  exec.register('hook:my-handle', makeInput({ threadId: null, channel: null }));

  assert.ok(exec.has('hook:my-handle'));
  assert.equal(exec.getByKey('hook:my-handle')!.registryKey, 'hook:my-handle');
  assert.equal(exec.getByKey('hook:my-handle')!.threadId, null);
  assert.equal(exec.getByThreadId('anything'), null);
});

test('duplicate threadId replaced: second registration with same threadId updates byThreadId', () => {
  const exec = new RunningExecutions();
  exec.register('C1', makeInput({ threadId: 'T1', channel: 'C1' }));
  exec.register('C2', makeInput({ threadId: 'T1', channel: 'C2' }));

  // byThreadId now points to C2
  assert.equal(exec.getByThreadId('T1')!.registryKey, 'C2');
  // C1 still exists in byKey with its original threadId value
  assert.equal(exec.getByKey('C1')!.threadId, 'T1');
  assert.equal(exec.getByKey('C1')!.channel, 'C1');

  // Removing C2 (owner of byThreadId) cleans the index
  exec.remove('C2');
  assert.equal(exec.getByThreadId('T1'), null);
  // C1 is still in byKey with its original threadId value
  assert.equal(exec.getByKey('C1')!.registryKey, 'C1');
  assert.equal(exec.getByKey('C1')!.threadId, 'T1');
});

test('removing stale key with shared threadId must not corrupt byThreadId for active entry', () => {
  const exec = new RunningExecutions();
  exec.register('A', makeInput({ threadId: 'T' }));
  exec.register('B', makeInput({ threadId: 'T' }));
  // byThreadId['T'] = B (the second registration wins)
  // byKey['A'] still holds threadId: 'T' as stale data

  exec.remove('A');
  // byThreadId['T'] must still point to B — removing stale key A must not touch it
  assert.equal(exec.getByThreadId('T')!.registryKey, 'B');
});

test('removing stale key with shared executionId must not corrupt byExecutionId for active entry', () => {
  const exec = new RunningExecutions();
  const handleA = makeKillTracker();
  const handleD = makeKillTracker();
  exec.register('C', makeInput({ executionId: 'E', kill: () => handleA.kill() }));
  exec.register('D', makeInput({ executionId: 'E', kill: () => handleD.kill() }));
  // byExecutionId['E'] = D (the second registration wins)

  exec.killByKey('C');
  // byExecutionId['E'] must still point to D — killing stale key C must not touch it
  assert.equal(exec.getByExecutionId('E')!.registryKey, 'D');
  // D is still alive and its kill was NOT called
  assert.equal(handleD.killed, false);
});

// ── Additional edge cases ─────────────────────────────────────────────

test('getAll returns snapshot of all registered entries', () => {
  const exec = new RunningExecutions();
  assert.equal(exec.getAll().length, 0);

  exec.register('C1', makeInput({ channel: 'C1' }));
  exec.register('C2', makeInput({ channel: 'C2' }));
  assert.equal(exec.getAll().length, 2);

  exec.remove('C1');
  assert.equal(exec.getAll().length, 1);
  assert.equal(exec.getAll()[0]!.registryKey, 'C2');
});

test('getByExecutionId returns null for unknown executionId', () => {
  const exec = new RunningExecutions();
  exec.register('C123', makeInput({ executionId: 'exec-1' }));

  assert.equal(exec.getByExecutionId('exec-1')!.registryKey, 'C123');
  assert.equal(exec.getByExecutionId('nonexistent'), null);
});

test('re-register at same key silently replaces old entry and cleans old indices', () => {
  const exec = new RunningExecutions();
  exec.register('C1', makeInput({ threadId: 'T1', executionId: 'E1', channel: 'C1', backend: 'claude' }));
  exec.register('C1', makeInput({ threadId: 'T2', executionId: 'E2', channel: 'C1', backend: 'codex' }));

  // Old indices are gone
  assert.equal(exec.getByThreadId('T1'), null);
  assert.equal(exec.getByExecutionId('E1'), null);

  // New indices active
  assert.equal(exec.getByThreadId('T2')!.registryKey, 'C1');
  assert.equal(exec.getByExecutionId('E2')!.registryKey, 'C1');
  assert.equal(exec.getByKey('C1')!.backend, 'codex');
});

test('remove is no-op for non-existent key', () => {
  const exec = new RunningExecutions();
  // Should not throw
  exec.remove('nonexistent');
  assert.equal(exec.has('nonexistent'), false);
});

test('register stores startTime as a recent timestamp', () => {
  const exec = new RunningExecutions();
  const before = Date.now();
  exec.register('C1', makeInput());
  const entry = exec.getByKey('C1')!;
  assert.ok(entry.startTime >= before, 'startTime must be >= before timestamp');
  assert.ok(entry.startTime <= Date.now(), 'startTime must be <= now');
});

test('constructor accepts optional bus', () => {
  const bus = new EventBus();
  const events = collectEvents(bus);
  const exec = new RunningExecutions(bus);

  exec.register('C1', makeInput({ executionId: 'exec-1' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'agent.started');
});
