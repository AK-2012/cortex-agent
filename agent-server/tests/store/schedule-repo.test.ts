// input:  Node test runner, assert, tmp filesystem
// output: regression tests for ScheduleRepo (concurrent mutate, flush ordering, CRUD)
// pos:    verifies store/schedule-repo.ts Pattern A guarantees
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ScheduleRepo, type ScheduleTask } from '../../src/store/schedule-repo.js';

// ── Shared tmp directory ───────────────────────────────────────

let tmpDir: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-schedule-repo-test-'));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helper: fresh repo + file per test ─────────────────────────

let _testIdx = 0;
function createRepo(): ScheduleRepo {
  const idx = _testIdx++;
  return new ScheduleRepo(path.join(tmpDir, `schedules-${idx}.json`));
}

function makeTask(overrides = {}): ScheduleTask {
  return {
    id: `task-${Math.random().toString(16).slice(2, 8)}`,
    type: 'interval',
    message: 'test task',
    channel: 'C1',
    profile: 'plan',
    createdAt: Date.now(),
    ...overrides,
  };
}

// ── Concurrent mutate: no lost schedules ───────────────────────

test('ScheduleRepo - 10 concurrent addTask produce all 10 entries', async () => {
  const repo = createRepo();

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      repo.addTask(makeTask({ id: `task-${i}`, message: `task ${i}` }))
    )
  );

  const data = await repo.read();
  assert.equal(data.tasks.length, 10, 'all 10 tasks should be added');
  for (let i = 0; i < 10; i++) {
    assert.equal(data.tasks[i].id, `task-${i}`);
  }
});

// ── Flush: mid-mutate flush resolves after pending mutations ──

test('ScheduleRepo - flush() resolves only after all pending mutations (FIFO on mutex)', async () => {
  const repo = createRepo();

  const resolutionOrder: string[] = [];
  const N = 10;

  const mutations = Array.from({ length: N }, (_, i) =>
    repo.addTask(makeTask({ id: `task-${i}`, message: `task ${i}` }))
      .then(() => { resolutionOrder.push(`mut-${i}`); })
  );

  const flushDone = repo.flush().then(() => { resolutionOrder.push('flush'); });

  await Promise.all([...mutations, flushDone]);

  assert.equal(resolutionOrder[N], 'flush',
    `flush must be last; got ${resolutionOrder.join(', ')}`);
});

// ── CRUD: find / add / remove / update ────────────────────────

test('ScheduleRepo - findTask returns null for unknown id', async () => {
  const repo = createRepo();
  const result = await repo.findTask('nonexistent');
  assert.equal(result, null);
});

test('ScheduleRepo - addTask then findTask returns the task', async () => {
  const repo = createRepo();
  const task = makeTask({ id: 'add-test' });
  await repo.addTask(task);

  const found = await repo.findTask('add-test');
  assert.ok(found);
  assert.equal(found.message, task.message);
  assert.equal(found.channel, task.channel);
});

test('ScheduleRepo - removeTask returns true for existing id', async () => {
  const repo = createRepo();
  await repo.addTask(makeTask({ id: 'remove-test' }));

  const removed = await repo.removeTask('remove-test');
  assert.equal(removed, true);
  assert.equal(await repo.findTask('remove-test'), null);
});

test('ScheduleRepo - removeTask returns false for unknown id', async () => {
  const repo = createRepo();
  const removed = await repo.removeTask('does-not-exist');
  assert.equal(removed, false);
});

test('ScheduleRepo - updateTask applies callback and returns updated task', async () => {
  const repo = createRepo();
  await repo.addTask(makeTask({ id: 'update-test', message: 'original' }));

  const updated = await repo.updateTask('update-test', (t) => {
    t.message = 'updated';
    t.isPaused = true;
  });
  assert.ok(updated);
  assert.equal(updated.message, 'updated');
  assert.equal(updated.isPaused, true);

  // Verify persisted
  const found = await repo.findTask('update-test');
  assert.equal(found!.message, 'updated');
  assert.equal(found!.isPaused, true);
});

test('ScheduleRepo - updateTask returns null for unknown id', async () => {
  const repo = createRepo();
  const result = await repo.updateTask('no-such-id', () => {});
  assert.equal(result, null);
});

test('ScheduleRepo - read returns all tasks after mixed operations', async () => {
  const repo = createRepo();
  await repo.addTask(makeTask({ id: 'a', message: 'A' }));
  await repo.addTask(makeTask({ id: 'b', message: 'B' }));
  await repo.removeTask('a');
  await repo.addTask(makeTask({ id: 'c', message: 'C' }));

  const data = await repo.read();
  assert.equal(data.tasks.length, 2);
  const ids = data.tasks.map(t => t.id).sort();
  assert.deepEqual(ids, ['b', 'c']);
});

// ── Rate limit throttle get/set roundtrip ─────────────────────

test('ScheduleRepo - rateLimitThrottle get/set roundtrip', async () => {
  const repo = createRepo();

  // Initially null
  assert.equal(await repo.getRateLimitThrottle(), null);

  // Set
  const meta = { resetsAt: 1234567890, activatedAt: Date.now() };
  await repo.setRateLimitThrottle(meta);

  // Get
  const got = await repo.getRateLimitThrottle();
  assert.ok(got);
  assert.equal(got.resetsAt, 1234567890);

  // Clear
  await repo.setRateLimitThrottle(null);
  assert.equal(await repo.getRateLimitThrottle(), null);
});

test('ScheduleRepo - rateLimitThrottle persists alongside tasks', async () => {
  const repo = createRepo();
  await repo.addTask(makeTask({ id: 't1', message: 'task 1' }));
  await repo.setRateLimitThrottle({ resetsAt: 999, activatedAt: 888 });

  const data = await repo.read();
  assert.equal(data.tasks.length, 1);
  assert.equal(data.rateLimitThrottle?.resetsAt, 999);
});

// ── On-disk schema matches SchedulesData ──────────────────────

test('ScheduleRepo - on-disk schema matches SchedulesData format', async () => {
  const idx = _testIdx++;
  const filePath = path.join(tmpDir, `schedules-${idx}.json`);
  const repo = new ScheduleRepo(filePath);
  await repo.addTask(makeTask({ id: 'schema-1', type: 'interval', intervalMs: 3600000 }));
  await repo.setRateLimitThrottle({ resetsAt: 111, activatedAt: 222 });

  // Flush and read raw from disk
  await repo.flush();
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));

  assert.ok(raw.tasks);
  assert.equal(Array.isArray(raw.tasks), true);
  assert.equal(raw.tasks[0].id, 'schema-1');
  assert.ok(raw.rateLimitThrottle);
  assert.equal(raw.rateLimitThrottle.resetsAt, 111);
});

// ── target / fallback fields round-trip ───────────────────────

test('ScheduleRepo - target field round-trips through addTask/findTask (channel kind)', async () => {
  const repo = createRepo();
  const task = makeTask({
    id: 'target-channel',
    target: { kind: 'channel', channel: 'C999' },
    fallback: 'fresh',
  } as Partial<ScheduleTask>);
  await repo.addTask(task);
  const found = await repo.findTask('target-channel');
  assert.ok(found);
  assert.deepEqual(found.target, { kind: 'channel', channel: 'C999' });
  assert.equal(found.fallback, 'fresh');
});

test('ScheduleRepo - target field round-trips for session and thread kinds', async () => {
  const repo = createRepo();
  await repo.addTask(makeTask({
    id: 'target-session',
    target: { kind: 'session', sessionName: 'cortex-abc', sessionId: 'sess-uuid', channel: 'C1' },
  } as Partial<ScheduleTask>));
  await repo.addTask(makeTask({
    id: 'target-thread',
    target: { kind: 'thread', threadId: 'thr_xyz', channel: 'C1' },
  } as Partial<ScheduleTask>));
  const s = await repo.findTask('target-session');
  const t = await repo.findTask('target-thread');
  assert.ok(s && s.target?.kind === 'session');
  assert.ok(t && t.target?.kind === 'thread');
  assert.equal((s.target as { sessionName: string }).sessionName, 'cortex-abc');
  assert.equal((t.target as { threadId: string }).threadId, 'thr_xyz');
});

test('ScheduleRepo - migrate fills target=fresh for legacy records without target field', async () => {
  const idx = _testIdx++;
  const filePath = path.join(tmpDir, `schedules-${idx}.json`);
  // Write an old-format record (no target/fallback fields) directly to disk
  await fs.writeFile(filePath, JSON.stringify({
    tasks: [{ id: 'legacy-1', type: 'interval', intervalMs: 60000, message: 'old task', channel: 'C1', profile: 'plan', createdAt: Date.now() }],
  }));
  const repo = new ScheduleRepo(filePath);
  const found = await repo.findTask('legacy-1');
  assert.ok(found, 'legacy task should still load');
  assert.deepEqual(found.target, { kind: 'fresh' }, 'migrate should default target to fresh');
});

// ── Invalidate: clears cache so next read fetches from disk ────

test('ScheduleRepo - invalidate() clears in-memory cache', async () => {
  const idx = _testIdx++;
  const filePath = path.join(tmpDir, `schedules-${idx}.json`);
  const repo = new ScheduleRepo(filePath);
  await repo.addTask(makeTask({ id: 'cache-1' }));
  assert.equal((await repo.read()).tasks.length, 1);

  // Write directly to disk, bypassing the repo
  await fs.writeFile(filePath, JSON.stringify({ tasks: [{ id: 'external', type: 'interval', message: 'external', channel: 'C1', profile: 'plan', createdAt: Date.now() }] }));

  // Without invalidate, cache would still have the old data
  repo.invalidate();
  const data = await repo.read();
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].id, 'external');
});
