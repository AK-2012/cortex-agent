// input:  Node test runner + project-store + fs
// output: regression tests for ProjectStore: list/get/exists/getDefault/resolveFromMessage + scaffolding + cache invalidation
// pos:    verifies ProjectStore behaves correctly with temp directories
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const STORE_MODULE_PATH = '../src/domain/projects/project-store.js';

/**
 * Create a temp PROJECTS_DIR with optional initial subdirectories.
 */
function makeTempProjectsDir(initialDirs: string[] = []): { baseDir: string; cleanup: () => void } {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-test-'));
  for (const d of initialDirs) {
    fs.mkdirSync(path.join(baseDir, d), { recursive: true });
  }
  const cleanup = () => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  };
  return { baseDir, cleanup };
}

function makeStore(baseDir: string): Promise<{ ProjectStore: any; store: any }> {
  return import(STORE_MODULE_PATH).then((mod) => {
    const store = new mod.ProjectStore({ projectsDir: baseDir, watchEnabled: false });
    return store.initialize().then(() => ({ ProjectStore: mod.ProjectStore, store }));
  });
}

test('ProjectStore - list returns general when dir is empty', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir();
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const projects = store.list();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, 'general');
  assert.equal(projects[0].kind, 'general');
  assert.equal(projects[0].contextDir, path.join(baseDir, 'general'));
});

test('ProjectStore - list returns user projects plus general', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['cortex-self', 'some-project']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const projects = store.list();
  const ids = projects.map(p => p.id).sort();
  assert.deepEqual(ids, ['cortex-self', 'general', 'some-project']);
  assert.equal(projects.find(p => p.id === 'cortex-self')!.kind, 'user');
  assert.equal(projects.find(p => p.id === 'some-project')!.kind, 'user');
});

test('ProjectStore - get returns project by id', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['my-project']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const p = store.get('my-project');
  assert.ok(p);
  assert.equal(p!.id, 'my-project');
  assert.equal(p!.kind, 'user');
  assert.equal(p!.contextDir, path.join(baseDir, 'my-project'));
});

test('ProjectStore - get returns undefined for unknown project', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir();
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  assert.equal(store.get('nonexistent'), undefined);
});

test('ProjectStore - exists returns true for known projects', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['known-project']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  assert.equal(store.exists('known-project'), true);
  assert.equal(store.exists('general'), true);
  assert.equal(store.exists('phantom'), false);
});

test('ProjectStore - getDefault returns general', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['some-project']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const d = store.getDefault();
  assert.equal(d.id, 'general');
  assert.equal(d.kind, 'general');
});

test('ProjectStore - resolveFromMessage matches Project: <name>', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['cortex-self']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const result = store.resolveFromMessage('Project: cortex-self');
  assert.ok(result);
  assert.equal(result!.id, 'cortex-self');
});

test('ProjectStore - resolveFromMessage matches **Project:** <name>', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['my-project']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const result = store.resolveFromMessage('**Project:** my-project');
  assert.ok(result);
  assert.equal(result!.id, 'my-project');
});

test('ProjectStore - resolveFromMessage returns null for unknown project', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir();
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  assert.equal(store.resolveFromMessage('Project: nonexistent'), null);
});

test('ProjectStore - resolveFromMessage returns null when no match', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['cortex-self']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  assert.equal(store.resolveFromMessage('Hello world'), null);
});

test('ProjectStore - scaffolding creates general directory on initialize', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir();
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const generalDir = path.join(baseDir, 'general');
  assert.ok(fs.existsSync(generalDir));
  assert.ok(fs.existsSync(path.join(generalDir, 'STATUS.md')));
  assert.ok(fs.existsSync(path.join(generalDir, 'CORTEX.md')));

  const statusContent = fs.readFileSync(path.join(generalDir, 'STATUS.md'), 'utf8');
  assert.ok(statusContent.includes('# general'));
});

test('ProjectStore - scaffolding does not overwrite existing general', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['general']);
  t.after(cleanup);

  // Pre-create a STATUS.md with custom content
  fs.writeFileSync(path.join(baseDir, 'general', 'STATUS.md'), '# custom', 'utf8');

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  // Should not overwrite
  const content = fs.readFileSync(path.join(baseDir, 'general', 'STATUS.md'), 'utf8');
  assert.equal(content, '# custom');
});

test('ProjectStore - ignore dotfiles in project enumeration', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['real-project']);
  t.after(cleanup);

  // Create dotfile dirs and regular files that should be ignored
  fs.mkdirSync(path.join(baseDir, '.hidden'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'some-file.md'), '', 'utf8');

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  const projects = store.list();
  const ids = projects.map(p => p.id).sort();
  assert.deepEqual(ids, ['general', 'real-project']);
});

test('ProjectStore - list after cache refresh picks up new directory', async (t) => {
  const { baseDir, cleanup } = makeTempProjectsDir(['existing']);
  t.after(cleanup);

  const { store } = await makeStore(baseDir);
  t.after(() => store.destroy());

  let ids = store.list().map(p => p.id).sort();
  assert.deepEqual(ids, ['existing', 'general']);

  // Manually add a new dir and refresh
  fs.mkdirSync(path.join(baseDir, 'new-project'));
  store.refresh();

  ids = store.list().map(p => p.id).sort();
  assert.deepEqual(ids, ['existing', 'general', 'new-project']);
});
