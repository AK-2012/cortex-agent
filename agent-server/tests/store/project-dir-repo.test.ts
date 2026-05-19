// input:  Node test runner, assert, tmp filesystem
// output: regression tests for ProjectDirRepo (concurrent mutate, flush ordering, CRUD, cross-repo)
// pos:    verifies store/project-dir-repo.ts Pattern A guarantees
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ChannelRepo } from '../../src/store/channel-repo.js';
import { ProjectDirRepo } from '../../src/store/project-dir-repo.js';

// ── Shared tmp directory ───────────────────────────────────────

let tmpDir: string;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-project-dir-repo-test-'));
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helper: fresh repos + files per test ──────────────────────

let _testIdx = 0;
function createRepos(): { channelRepo: ChannelRepo; projectDirRepo: ProjectDirRepo } {
  const idx = _testIdx++;
  const channelFile = path.join(tmpDir, `channel-registry-${idx}.json`);
  const projectDirsFile = path.join(tmpDir, `project-dirs-${idx}.json`);

  const channelRepoInstance = new ChannelRepo({ filePath: channelFile });
  const projectDirRepoInstance = new ProjectDirRepo({
    filePath: projectDirsFile,
    channelRepoOverride: channelRepoInstance,
  });

  return { channelRepo: channelRepoInstance, projectDirRepo: projectDirRepoInstance };
}

// ── Concurrent mutate: no lost entries ─────────────────────────

test('ProjectDirRepo - 10 concurrent setProjectDir produce all 10 entries', async () => {
  const { projectDirRepo } = createRepos();

  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      projectDirRepo.setProjectDir(`proj-${i}`, `machine-${i}`, `/path/to/${i}`)
    )
  );

  const all = await projectDirRepo.getAllProjectDirs();
  assert.equal(Object.keys(all).length, 10, 'all 10 projects should be registered');
  for (let i = 0; i < 10; i++) {
    assert.equal(all[`proj-${i}`][`machine-${i}`], `/path/to/${i}`);
  }
});

// ── Flush: mid-mutate flush resolves after pending mutations ──

test('ProjectDirRepo - flush() resolves only after all pending mutations (FIFO on mutex)', async () => {
  const { projectDirRepo } = createRepos();

  const resolutionOrder: string[] = [];
  const N = 10;

  const mutations = Array.from({ length: N }, (_, i) =>
    projectDirRepo.setProjectDir(`proj-${i}`, `machine-a`, `/path-${i}`)
      .then(() => { resolutionOrder.push(`mut-${i}`); })
  );

  const flushDone = projectDirRepo.flush().then(() => { resolutionOrder.push('flush'); });

  await Promise.all([...mutations, flushDone]);

  assert.equal(resolutionOrder[N], 'flush',
    `flush must be last; got ${resolutionOrder.join(', ')}`);
});

// ── CRUD: get / set / remove ──────────────────────────────────

test('ProjectDirRepo - getProjectDir returns null for unknown project/machine', async () => {
  const { projectDirRepo } = createRepos();
  assert.equal(await projectDirRepo.getProjectDir('no-proj', 'no-machine'), null);
});

test('ProjectDirRepo - setProjectDir then getProjectDir returns the value', async () => {
  const { projectDirRepo } = createRepos();
  await projectDirRepo.setProjectDir('proj-a', 'testbox', '/home/user/proj');
  const dir = await projectDirRepo.getProjectDir('proj-a', 'testbox');
  assert.equal(dir, '/home/user/proj');
});

test('ProjectDirRepo - removeProjectDir deletes entry and cleans up empty project', async () => {
  const { projectDirRepo } = createRepos();
  await projectDirRepo.setProjectDir('proj-a', 'testbox', '/path/a');

  assert.equal(await projectDirRepo.getProjectDir('proj-a', 'testbox'), '/path/a');
  await projectDirRepo.removeProjectDir('proj-a', 'testbox');
  assert.equal(await projectDirRepo.getProjectDir('proj-a', 'testbox'), null);

  // The project key itself should be deleted when last machine removed
  const all = await projectDirRepo.getAllProjectDirs();
  assert.equal('proj-a' in all, false, 'empty project key should be cleaned up');
});

test('ProjectDirRepo - removeProjectDir keeps project when other machines remain', async () => {
  const { projectDirRepo } = createRepos();
  await projectDirRepo.setProjectDir('proj-a', 'testbox', '/path/testbox');
  await projectDirRepo.setProjectDir('proj-a', 'lab', '/path/lab');

  await projectDirRepo.removeProjectDir('proj-a', 'testbox');

  assert.equal(await projectDirRepo.getProjectDir('proj-a', 'testbox'), null);
  assert.equal(await projectDirRepo.getProjectDir('proj-a', 'lab'), '/path/lab');
});

// ── getChannelProject: cross-repo reverse lookup ──────────────

test('ProjectDirRepo - getChannelProject reverse-lookup via channelRepo', async () => {
  const { channelRepo, projectDirRepo } = createRepos();

  await channelRepo.setProjectChannel('proj-x', 'C999');
  await channelRepo.setProjectChannel('proj-y', 'C888');

  const foundX = await projectDirRepo.getChannelProject('C999');
  assert.equal(foundX, 'proj-x');

  const foundY = await projectDirRepo.getChannelProject('C888');
  assert.equal(foundY, 'proj-y');

  const notFound = await projectDirRepo.getChannelProject('C000');
  assert.equal(notFound, null);
});

// ── getAllProjectDirs returns all entries ─────────────────────

test('ProjectDirRepo - getAllProjectDirs returns nested structure', async () => {
  const { projectDirRepo } = createRepos();
  await projectDirRepo.setProjectDir('proj-a', 'testbox', '/a');
  await projectDirRepo.setProjectDir('proj-b', 'lab', '/b');

  const all = await projectDirRepo.getAllProjectDirs();
  assert.deepEqual(all, {
    'proj-a': { 'testbox': '/a' },
    'proj-b': { 'lab': '/b' },
  });
});

// ── removeProjectDir is a no-op for non-existent project or machine ──

test('ProjectDirRepo - removeProjectDir on unknown project is a no-op', async () => {
  const { projectDirRepo } = createRepos();
  await projectDirRepo.setProjectDir('proj-a', 'testbox', '/a');

  // Remove something that doesn't exist — must not throw and must not corrupt state
  await projectDirRepo.removeProjectDir('does-not-exist', 'anywhere');

  const all = await projectDirRepo.getAllProjectDirs();
  assert.deepEqual(all, { 'proj-a': { 'testbox': '/a' } });
});

test('ProjectDirRepo - removeProjectDir on unknown machine of existing project is a no-op', async () => {
  const { projectDirRepo } = createRepos();
  await projectDirRepo.setProjectDir('proj-a', 'testbox', '/a');

  await projectDirRepo.removeProjectDir('proj-a', 'lab-ksu');

  const all = await projectDirRepo.getAllProjectDirs();
  assert.deepEqual(all, { 'proj-a': { 'testbox': '/a' } });
});

// ── Concurrent merge: same project, different machines — inner object merges ──

test('ProjectDirRepo - concurrent setProjectDir on same project merges different machines', async () => {
  const { projectDirRepo } = createRepos();

  // Fire 10 concurrent setProjectDir calls on the SAME project but different machines.
  // The mutex + JsonRepository.mutate read-modify-write semantics must merge all 10
  // into a single project entry. Without mutex serialization, a non-atomic RMW would
  // lose entries.
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      projectDirRepo.setProjectDir('shared-proj', `machine-${i}`, `/path/machine-${i}`)
    )
  );

  const all = await projectDirRepo.getAllProjectDirs();
  assert.equal(Object.keys(all).length, 1, 'exactly one project key');
  assert.ok(all['shared-proj']);
  assert.equal(Object.keys(all['shared-proj']).length, 10, 'all 10 machines merged into the same project');
  for (let i = 0; i < 10; i++) {
    assert.equal(all['shared-proj'][`machine-${i}`], `/path/machine-${i}`);
  }
});
