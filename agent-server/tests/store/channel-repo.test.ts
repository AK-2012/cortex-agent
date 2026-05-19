// input:  Node test runner, assert, tmp filesystem
// output: regression tests for ChannelRepo (concurrent mutate, flush ordering, CRUD)
// pos:    verifies store/channel-repo.ts Pattern A guarantees
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ChannelRepo } from '../../src/store/channel-repo.js';

// ── Shared tmp directory ───────────────────────────────────────

let tmpDir: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-channel-repo-test-'));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helper: fresh repo + file per test ─────────────────────────

let _testIdx = 0;
function createRepo(projectsDir?: string): ChannelRepo {
  const idx = _testIdx++;
  return new ChannelRepo({
    filePath: path.join(tmpDir, `channel-registry-${idx}.json`),
    projectsDir,
  });
}

// ── Concurrent mutate: no lost entries ─────────────────────────

test('ChannelRepo - 10 concurrent setProjectChannel produce all 10 entries', async () => {
  const repo = createRepo();

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      repo.setProjectChannel(`project-${i}`, `channel-${i}`)
    )
  );

  const all = await repo.getAllRegistrations();
  assert.equal(Object.keys(all).length, 10, 'all 10 projects should be registered');
  for (let i = 0; i < 10; i++) {
    assert.equal(all[`project-${i}`], `channel-${i}`);
  }
});

// ── Flush: mid-mutate flush resolves after pending mutations ───

test('ChannelRepo - flush() resolves only after all pending mutations (FIFO on mutex)', async () => {
  const repo = createRepo();

  const resolutionOrder: string[] = [];
  const N = 10;

  const mutations = Array.from({ length: N }, (_, i) =>
    repo.setProjectChannel(`proj-${i}`, `ch-${i}`)
      .then(() => { resolutionOrder.push(`mut-${i}`); })
  );

  const flushDone = repo.flush().then(() => { resolutionOrder.push('flush'); });

  await Promise.all([...mutations, flushDone]);

  assert.equal(resolutionOrder[N], 'flush',
    `flush must be last; got ${resolutionOrder.join(', ')}`);
});

// ── CRUD: get / set / remove ──────────────────────────────────

test('ChannelRepo - getProjectChannel returns null for unknown project', async () => {
  const repo = createRepo();
  const result = await repo.getProjectChannel('nonexistent');
  assert.equal(result, null);
});

test('ChannelRepo - setProjectChannel then getProjectChannel returns the value', async () => {
  const repo = createRepo();
  await repo.setProjectChannel('my-proj', 'C123');
  const ch = await repo.getProjectChannel('my-proj');
  assert.equal(ch, 'C123');
});

test('ChannelRepo - removeProjectChannel deletes entry', async () => {
  const repo = createRepo();
  await repo.setProjectChannel('proj-a', 'C1');
  assert.equal(await repo.getProjectChannel('proj-a'), 'C1');

  await repo.removeProjectChannel('proj-a');
  assert.equal(await repo.getProjectChannel('proj-a'), null);
});

test('ChannelRepo - getAllRegistrations returns all entries', async () => {
  const repo = createRepo();
  await repo.setProjectChannel('a', 'C1');
  await repo.setProjectChannel('b', 'C2');

  const all = await repo.getAllRegistrations();
  assert.deepEqual(all, { a: 'C1', b: 'C2' });
});

// ── listProjects: reads directory, not JSON ───────────────────

test('ChannelRepo - listProjects returns project directories', async () => {
  const projectsDir = path.join(tmpDir, 'projects');
  await fs.mkdir(projectsDir, { recursive: true });
  await fs.mkdir(path.join(projectsDir, 'proj-a'));
  await fs.mkdir(path.join(projectsDir, 'proj-b'));
  await fs.writeFile(path.join(projectsDir, 'not-a-dir.txt'), ''); // file, not dir
  await fs.mkdir(path.join(projectsDir, '.hidden')); // dot-prefixed, skipped

  const repo = createRepo(projectsDir);
  const projects = await repo.listProjects();
  assert.equal(projects.length, 2);
  assert.ok(projects.includes('proj-a'));
  assert.ok(projects.includes('proj-b'));
});

test('ChannelRepo - listProjects returns [] for missing directory', async () => {
  const repo = createRepo(path.join(tmpDir, 'does-not-exist'));
  const projects = await repo.listProjects();
  assert.equal(projects.length, 0);
});
