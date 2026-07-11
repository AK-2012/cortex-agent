import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleMemoryTree, handleMemoryFile } from '../../../src/domain/ui-service/query/memory.js';
import { createUiService } from '../../../src/domain/ui-service/ui-service.js';
import { mutateInputSchemas } from '../../../src/domain/ui-service/input-schemas.js';
import type { UiServiceDeps } from '../../../src/domain/ui-service/types.js';

// ── Fixture: a real on-disk project memory tree under a temp dir ──────────────
function makeProject(): { root: string; outsideFile: string } {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cortex-mem-'));
  const root = path.join(base, 'projects', 'my-project');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'mission.md'), '# mission\n', 'utf8');
  fs.writeFileSync(path.join(root, 'STATUS.md'), '# status\nline2\n', 'utf8');
  fs.writeFileSync(path.join(root, 'TASKS.yaml'), 'tasks: []\n', 'utf8');
  // roadmap.md intentionally absent → omitted from the tree.
  fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });
  fs.writeFileSync(path.join(root, 'experiments', 'EXP-001.md'), 'exp1', 'utf8');
  fs.writeFileSync(path.join(root, 'experiments', 'EXP-002.md'), 'exp2', 'utf8');
  fs.writeFileSync(path.join(root, 'experiments', 'index.md'), 'auto', 'utf8'); // excluded from count
  fs.writeFileSync(path.join(root, 'experiments', 'CORTEX.md'), '# index', 'utf8'); // excluded from count
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'K-001.md'), 'k1', 'utf8');
  fs.mkdirSync(path.join(root, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'decisions', 'DR-0001.md'), 'd1', 'utf8');
  // patterns/ intentionally absent → omitted.

  // A secret file OUTSIDE the project root, for traversal / symlink escape tests.
  const outsideFile = path.join(base, 'secret.txt');
  fs.writeFileSync(outsideFile, 'TOP SECRET', 'utf8');
  return { root, outsideFile };
}

function makeDeps(projectId: string, root: string): UiServiceDeps {
  const project = { id: projectId, name: projectId, kind: 'user' as const, contextDir: root };
  return {
    projectStore: {
      list: () => [project],
      get: (id: string) => (id === projectId ? project : undefined),
      exists: (id: string) => id === projectId,
      getDefault: () => project,
      createProject: () => ({ ok: false, code: 'invalid-name' as const, message: 'stub' }),
    },
    sessionStore: { listByProject: async () => [], listByOrigin: async () => [], listResumable: async () => [], getById: async () => null },
    threadStore: { getAll: () => [], get: () => null },
    taskStore: { getAll: () => [], getById: () => null, load: () => {}, refresh: () => {} },
    scheduler: { list: async () => [], get: async () => null, pause: async () => null, resume: async () => null, remove: async () => false, add: async () => ({ id: 'sch_new' } as any) },
    executionRegistry: { getExecution: () => null, getAll: () => [], cancelExecution: () => null },
    executionLogTailer: { startTail: () => {}, stopTail: () => {}, refCount: () => 0 },
    conversationHistory: { getHistory: async () => null },
    sendSessionMessage: () => {},
    approvalsPath: '/tmp/nonexistent-approvals.md',
    runningExecutions: { getAll: () => [] } as any,
    costSummary: async () => ({ today: 0, week: 0, month: 0, total: 0, byMode: {} as any, byProject: {}, byTrigger: {}, bySource: {}, byBackend: {}, tokens: {} as any, entryCount: 0, dailyBudget: 0, forecastToday: 0, dailyCost: [], byTriggerScoped: {} }),
    bus: { subscribe: () => ({ unsubscribe: () => {} }), publish: () => {} } as any,
    adapter: { getProjectConduits: async () => ({}) } as any,
  };
}

// ── (1) tree lists real project memory entries ───────────────────────────────
test('memory.tree lists real top-level files and memory dirs with entry counts', async () => {
  const { root } = makeProject();
  const tree = await handleMemoryTree(makeDeps('my-project', root), { projectId: 'my-project' });

  assert.equal(tree.projectId, 'my-project');
  const fileNames = tree.files.map((f) => f.name);
  assert.deepEqual(fileNames, ['mission.md', 'STATUS.md', 'TASKS.yaml']); // roadmap.md absent
  const status = tree.files.find((f) => f.name === 'STATUS.md')!;
  assert.equal(status.sizeBytes, Buffer.byteLength('# status\nline2\n'));
  assert.ok(typeof status.modifiedAt === 'string' && status.modifiedAt.length > 0);

  const dirByName = Object.fromEntries(tree.dirs.map((d) => [d.name, d.entryCount]));
  assert.equal(dirByName['experiments'], 2); // EXP-001/EXP-002 only — index.md AND CORTEX.md excluded
  assert.equal(dirByName['knowledge'], 1);
  assert.equal(dirByName['decisions'], 1);
  assert.ok(!('patterns' in dirByName)); // patterns/ absent → omitted
});

// ── (2) file returns real content ────────────────────────────────────────────
test('memory.file returns raw content + metadata for a real file', async () => {
  const { root } = makeProject();
  const dto = await handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: 'STATUS.md' });
  assert.equal(dto.projectId, 'my-project');
  assert.equal(dto.path, 'STATUS.md');
  assert.equal(dto.content, '# status\nline2\n');
  assert.equal(dto.sizeBytes, Buffer.byteLength('# status\nline2\n'));
  assert.ok(typeof dto.modifiedAt === 'string' && dto.modifiedAt.length > 0);
});

test('memory.file reads a nested file inside a memory dir', async () => {
  const { root } = makeProject();
  const dto = await handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: 'experiments/EXP-001.md' });
  assert.equal(dto.content, 'exp1');
});

// ── (3) path restricted to project root (traversal) ──────────────────────────
test('memory.file REJECTS parent-dir traversal', async () => {
  const { root } = makeProject();
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: '../secret.txt' }),
    (e: any) => e?.code === 'invalid-args',
  );
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: 'experiments/../../secret.txt' }),
    (e: any) => e?.code === 'invalid-args',
  );
});

// ── (3b) absolute path rejected ──────────────────────────────────────────────
test('memory.file REJECTS an absolute path', async () => {
  const { root, outsideFile } = makeProject();
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: outsideFile }),
    (e: any) => e?.code === 'invalid-args',
  );
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: '/etc/passwd' }),
    (e: any) => e?.code === 'invalid-args',
  );
});

// ── (3c) symlink escape rejected ─────────────────────────────────────────────
test('memory.file REJECTS a symlink that escapes the project root', async () => {
  const { root, outsideFile } = makeProject();
  const link = path.join(root, 'escape.md');
  fs.symlinkSync(outsideFile, link); // symlink inside root → file outside root
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: 'escape.md' }),
    (e: any) => e?.code === 'invalid-args',
  );
});

test('memory.file REJECTS a path traversing THROUGH a symlinked directory out of root', async () => {
  const { root, outsideFile } = makeProject();
  const outsideDir = path.dirname(outsideFile);
  const linkDir = path.join(root, 'outlink');
  fs.symlinkSync(outsideDir, linkDir); // dir symlink inside root → outside dir
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: 'outlink/secret.txt' }),
    (e: any) => e?.code === 'invalid-args',
  );
});

// ── not-found semantics (distinct from reject) ───────────────────────────────
test('memory.tree / memory.file throw not-found for an unknown project', async () => {
  const { root } = makeProject();
  await assert.rejects(
    () => handleMemoryTree(makeDeps('my-project', root), { projectId: 'ghost' }),
    (e: any) => e?.code === 'not-found',
  );
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'ghost', path: 'STATUS.md' }),
    (e: any) => e?.code === 'not-found',
  );
});

test('memory.file throws not-found for a missing file inside root', async () => {
  const { root } = makeProject();
  await assert.rejects(
    () => handleMemoryFile(makeDeps('my-project', root), { projectId: 'my-project', path: 'roadmap.md' }),
    (e: any) => e?.code === 'not-found',
  );
});

// ── (4) read-only: the scope adds ZERO mutate ops ────────────────────────────
test('memory scope is read-only — no memory.* mutate op exists', () => {
  const mutateKeys = Object.keys(mutateInputSchemas);
  assert.ok(!mutateKeys.some((k) => k.startsWith('memory.')), `no memory.* mutate op, got: ${mutateKeys.join(',')}`);
});

// ── wiring: facade + tRPC router ─────────────────────────────────────────────
test('memory.tree / memory.file reachable via the ui-service facade', async () => {
  const { root } = makeProject();
  const ui = createUiService(makeDeps('my-project', root));
  const tree = await ui.query('memory.tree', { projectId: 'my-project' });
  assert.ok(tree.ok);
  assert.equal(tree.data.files[0].name, 'mission.md');

  const file = await ui.query('memory.file', { projectId: 'my-project', path: 'mission.md' });
  assert.ok(file.ok);
  assert.equal(file.data.content, '# mission\n');

  const bad = await ui.query('memory.file', { projectId: 'my-project', path: '../secret.txt' });
  assert.equal(bad.ok, false);
  assert.equal((bad as any).code, 'invalid-args');
});

// The tRPC router binding (traversal → TRPCError BAD_REQUEST) is covered in
// the ui-http app-router test (tests/platform/ui-http-app-router.test.ts); here we assert the facade reads STATUS.md and
// rejects traversal with invalid-args.
test('memory.tree / memory.file via facade read a file and reject traversal', async () => {
  const { root } = makeProject();
  const ui = createUiService(makeDeps('my-project', root));
  const tree = await ui.query('memory.tree', { projectId: 'my-project' });
  assert.ok(tree.ok);
  assert.equal(tree.data.projectId, 'my-project');
  const file = await ui.query('memory.file', { projectId: 'my-project', path: 'STATUS.md' });
  assert.ok(file.ok);
  assert.equal(file.data.content, '# status\nline2\n');
  const bad = await ui.query('memory.file', { projectId: 'my-project', path: '../secret.txt' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'invalid-args');
});

// ── (5) git line-level +/− via numstat (working tree vs HEAD) ─────────────────
// A real git repo fixture: commit a file, then modify the working tree so numstat is non-zero.
function makeGitProject(): { root: string } {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cortex-mem-git-'));
  const root = path.join(base, 'projects', 'my-project');
  fs.mkdirSync(root, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  // Committed baseline: 3 lines.
  fs.writeFileSync(path.join(root, 'STATUS.md'), 'a\nb\nc\n', 'utf8');
  git('add', 'STATUS.md');
  git('commit', '-q', '-m', 'baseline');
  return { root };
}

test('memory.file reports real +/− from git numstat when the file is modified vs HEAD', async () => {
  const { root } = makeGitProject();
  // Working-tree edit: remove line 'b', add two new lines → +2 / −1 (numstat counts changed hunks).
  fs.writeFileSync(path.join(root, 'STATUS.md'), 'a\nc\nd\ne\n', 'utf8');
  const dto = await handleMemoryFile(makeDeps('my-project', root), {
    projectId: 'my-project',
    path: 'STATUS.md',
  });
  // Cross-check against git's own numstat output (avoid pinning brittle exact numbers).
  const raw = execFileSync('git', ['-C', root, 'diff', '--numstat', 'HEAD', '--', 'STATUS.md'], {
    encoding: 'utf8',
  }).trim();
  const [added, removed] = raw.split('\t');
  assert.deepEqual(dto.lineDiff, { added: Number(added), removed: Number(removed) });
  assert.ok(dto.lineDiff!.added > 0 && dto.lineDiff!.removed > 0);
});

test('memory.file reports {added:0,removed:0} for a clean tracked file (no diff vs HEAD)', async () => {
  const { root } = makeGitProject();
  const dto = await handleMemoryFile(makeDeps('my-project', root), {
    projectId: 'my-project',
    path: 'STATUS.md',
  });
  assert.deepEqual(dto.lineDiff, { added: 0, removed: 0 });
});

test('memory.file lineDiff is null (honest placeholder) when the project dir is not a git repo', async () => {
  const { root } = makeProject(); // makeProject fixture is a plain temp dir, NOT a git repo
  const dto = await handleMemoryFile(makeDeps('my-project', root), {
    projectId: 'my-project',
    path: 'STATUS.md',
  });
  assert.equal(dto.lineDiff, null);
});
