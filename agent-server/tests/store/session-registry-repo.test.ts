// input:  Node test runner, assert, tmp filesystem
// output: regression tests for SessionRegistryRepo (concurrent mutate, flush ordering, cache consistency)
// pos:    verifies store/session-registry-repo.ts Pattern A guarantees
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionRegistryRepo } from '../../src/store/session-registry-repo.js';

// ── Shared tmp directory ───────────────────────────────────────

let tmpDir: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-session-registry-repo-test-'));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helper: fresh repo + file per test ─────────────────────────

let _testIdx = 0;
function createRepoWithPath(): { repo: SessionRegistryRepo; filePath: string } {
  const idx = _testIdx++;
  const filePath = path.join(tmpDir, `session-registry-${idx}.json`);
  return { repo: new SessionRegistryRepo(filePath), filePath };
}

function makeOpts(sessionId: string) {
  return { sessionId, channel: 'C001', backend: 'claude', kind: 'local' as const, label: null };
}

// ── (a) Concurrent mutate: no lost entries ─────────────────────

test('SessionRegistryRepo - 10 concurrent registerSession produce all 10 entries', async () => {
  const { repo } = createRepoWithPath();
  const names = Array.from({ length: 10 }, (_, i) => `cortex-${String(i).padStart(6, '0')}`);

  await Promise.all(
    names.map((name, i) => repo.registerSession(name, makeOpts(`sess-${i}`)))
  );

  const all = await repo.listRecentSessions(20);
  assert.equal(all.length, 10, 'all 10 sessions should be registered');
  const registeredNames = new Set(all.map((s) => s.name));
  for (const name of names) {
    assert.ok(registeredNames.has(name), `missing: ${name}`);
  }
});

// ── (b) Mid-mutate flush resolves after all pending mutations ──

test('SessionRegistryRepo - flush() resolves only after all pending mutations (FIFO on mutex)', async () => {
  const { repo } = createRepoWithPath();
  const resolutionOrder: string[] = [];
  const N = 10;

  const mutations = Array.from({ length: N }, (_, i) =>
    repo.registerSession(`cortex-${String(i).padStart(6, '0')}`, makeOpts(`sess-${i}`))
      .then(() => { resolutionOrder.push(`mut-${i}`); })
  );

  const flushDone = repo.flush().then(() => { resolutionOrder.push('flush'); });

  await Promise.all([...mutations, flushDone]);

  assert.equal(resolutionOrder[N], 'flush',
    `flush must be last; got: ${resolutionOrder.join(', ')}`);
});

// ── (c) Cache consistency: write → cached; disk bypass → still cached; invalidate → fresh ──

test('SessionRegistryRepo - cache serves write value; invalidate() picks up disk changes', async () => {
  const { repo, filePath } = createRepoWithPath();

  // Write through the repo so the cache is populated.
  await repo.registerSession('cortex-aabbcc', makeOpts('sess-abc'));

  // Cache hit: record is returned without a disk read.
  const record = await repo.lookupSession('cortex-aabbcc');
  assert.ok(record !== null, 'record should be present in cache');
  assert.equal(record!.sessionId, 'sess-abc');

  // Overwrite the file on disk directly, bypassing the repo cache.
  // The cache should still serve the original value — disk changes are invisible until invalidate().
  await fs.writeFile(filePath, JSON.stringify({ 'cortex-aabbcc': { ...record, sessionId: 'STALE-FROM-DISK' } }, null, 2));
  const cachedRecord = await repo.lookupSession('cortex-aabbcc');
  assert.equal(cachedRecord!.sessionId, 'sess-abc',
    'cache should serve original value; disk bypass must not be visible');

  // After invalidate(), the repo reads from disk and returns the updated value.
  repo.invalidate();
  const freshRecord = await repo.lookupSession('cortex-aabbcc');
  assert.equal(freshRecord!.sessionId, 'STALE-FROM-DISK',
    'after invalidate(), repo must return the disk value');
});
