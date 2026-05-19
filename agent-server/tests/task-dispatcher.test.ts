// input:  Node test runner + task-dispatcher module
// output: preselect + guard + gate + CLI invocation tests
// pos:    Verify pre-filter, dispatch gating and CLI launch
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { _testSetRegistry } from '../src/domain/tasks/dispatch-utils.js';
import { updateScheduleInterval, hasRunningExecutionForSchedule, findActiveDispatchMatch, filterDispatchableTasks, filterLockedProjects, isValidDispatchPrompt } from '../src/domain/tasks/dispatcher.js';

before(() => {
  _testSetRegistry({ testbox: { cortexPath: '/tmp/test', gpuCount: 2 } });
});
import { loadConfig } from '../src/domain/threads/template-loader.js';
import { PROJECTS_DIR } from '../src/core/paths.js';

test('updateScheduleInterval routes interval changes through scheduler API', async () => {
  const calls = [];
  const scheduler = {
    async get(id) {
      calls.push(['get', id]);
      return { id, type: 'interval', intervalMs: 30000 };
    },
    async setInterval(id, intervalMs) {
      calls.push(['setInterval', id, intervalMs]);
    },
  };

  await updateScheduleInterval(scheduler, 'sched1', 300000);

  assert.deepEqual(calls, [
    ['get', 'sched1'],
    ['setInterval', 'sched1', 300000],
  ]);
});

test('hasRunningExecutionForSchedule matches running scheduled executions by schedule id', () => {
  const records = [
    { status: 'running', kind: 'scheduled', scheduleTaskId: 'sched-1' },
    { status: 'completed', kind: 'scheduled', scheduleTaskId: 'sched-2' },
  ];

  assert.equal(hasRunningExecutionForSchedule(records, 'sched-1'), true);
  assert.equal(hasRunningExecutionForSchedule(records, 'sched-2'), false);
  assert.equal(hasRunningExecutionForSchedule(records, 'missing'), false);
});

test('findActiveDispatchMatch returns null when no running execution matches', () => {
  const task = { id: 'abcd', project: 'example-project', text: '安装最新 Isaac Lab (develop branch)' };
  // findActiveDispatchMatch now uses executionRegistry directly (no deps injection)
  // Since there are no real running executions in test, it should return null
  const match = findActiveDispatchMatch(task, 'sched-1');
  assert.equal(match, null);
});

test('filterDispatchableTasks drops duplicate tasks before selection', async () => {
  const tasks = [
    { id: 'a1', project: 'example-project', text: 'duplicate task', gpu: null, template: 'default' },
    { id: 'b2', project: 'example-project', text: 'fresh task', gpu: null, template: 'default' },
  ];

  const filtered = await filterDispatchableTasks(tasks, 'sched-1', new Map(), {
    findActiveDispatchMatch: (task) => (task.id === 'a1' ? { source: 'pending', taskId: 'pending-1', machine: 'testbox' } : null),
    checkRealGpuOccupancy: async () => ({ gpus: [], freeIndices: [], allOccupied: false }),
  });

  assert.deepEqual(filtered.map((task) => task.id), ['b2']);
});

test('filterDispatchableTasks drops GPU-occupied candidates and keeps later free candidate', async () => {
  const tasks = [
    { id: 'a1', project: 'example-project', text: 'busy gpu task', gpu: 'testbox', template: 'default' },
    { id: 'b2', project: 'example-project', text: 'free cpu task', gpu: null, template: 'default' },
  ];

  const filtered = await filterDispatchableTasks(tasks, 'sched-1', new Map(), {
    findActiveDispatchMatch: () => null,
    checkRealGpuOccupancy: async (machine) => {
      assert.equal(machine, 'testbox');
      return { gpus: [{ index: 0, occupied: true, processes: [{ pid: '123', name: 'python', memoryMB: 4096 }] }], freeIndices: [], allOccupied: true };
    },
  });

  assert.deepEqual(filtered.map((task) => task.id), ['b2']);
});

test('filterDispatchableTasks caches GPU preflight by machine and deducts assigned slots', async () => {
  const tasks = [
    { id: 'a1', project: 'example-project', text: 'gpu task one', gpu: 'testbox', template: 'default' },
    { id: 'b2', project: 'example-project', text: 'gpu task two', gpu: 'testbox', template: 'default' },
  ];
  let calls = 0;

  // testbox has 1 free GPU (freeIndices: [0]) → first task gets it, second blocked
  const filtered = await filterDispatchableTasks(tasks, 'sched-1', new Map(), {
    findActiveDispatchMatch: () => null,
    checkRealGpuOccupancy: async () => {
      calls += 1;
      return { gpus: [{ index: 0, occupied: false, processes: [] }], freeIndices: [0], allOccupied: false };
    },
  });

  assert.equal(calls, 1); // nvidia-smi still only called once (cached)
  assert.deepEqual(filtered.map((task) => task.id), ['a1']); // second task blocked after slot deduction
});

test('filterDispatchableTasks accepts tasks without device tag', async () => {
  const tasks = [
    { id: 'a1', project: 'example-project', text: 'no device task', gpu: null, template: 'default' },
    { id: 'b2', project: 'example-project', text: 'another task', gpu: null, template: 'default' },
  ];

  const filtered = await filterDispatchableTasks(tasks, 'sched-1', new Map(), {
    findActiveDispatchMatch: () => null,
    checkRealGpuOccupancy: async () => ({ gpus: [], freeIndices: [], allOccupied: false }),
  });

  assert.deepEqual(filtered.map((task) => task.id), ['a1', 'b2']);
});

test('filterDispatchableTasks drops tasks with unknown or missing [template:X] tag', async () => {
  // Load real thread-templates.json so listTemplateNames() is non-empty.
  // Without this, the filter is fail-open (size===0 → skip check).
  loadConfig();

  const tasks = [
    { id: 'a1', project: 'cortex-self', text: 'bad template task', gpu: null, template: 'nonexistent-template-xyz' },
    { id: 'b2', project: 'cortex-self', text: 'no-template task', gpu: null, template: null },
    { id: 'c3', project: 'cortex-self', text: 'good known-template task', gpu: null, template: 'default' },
  ];

  const filtered = await filterDispatchableTasks(tasks, 'sched-1', new Map(), {
    findActiveDispatchMatch: () => null,
    checkRealGpuOccupancy: async () => ({ gpus: [], freeIndices: [], allOccupied: false }),
  });

  // a1: unknown template → filtered; b2: missing template → filtered; c3: valid → passes
  assert.deepEqual(filtered.map((task) => task.id), ['c3']);
});

// --- Null/empty prompt guard (ISS-CS-005 durable fix) ---

test('isValidDispatchPrompt rejects null/empty/whitespace values', () => {
  assert.equal(isValidDispatchPrompt(null), false);
  assert.equal(isValidDispatchPrompt(undefined), false);
  assert.equal(isValidDispatchPrompt(''), false);
  assert.equal(isValidDispatchPrompt('   '), false);
  assert.equal(isValidDispatchPrompt('\t\n'), false);
  assert.equal(isValidDispatchPrompt('null'), false);
  assert.equal(isValidDispatchPrompt('undefined'), false);
  // Non-string types
  assert.equal(isValidDispatchPrompt(0), false);
  assert.equal(isValidDispatchPrompt(false), false);
  assert.equal(isValidDispatchPrompt([]), false);
});

test('isValidDispatchPrompt accepts valid prompt values', () => {
  assert.equal(isValidDispatchPrompt('Execute /orient fast'), true);
  assert.equal(isValidDispatchPrompt('[Scheduled Task] Execute /orient fast'), true);
  assert.equal(isValidDispatchPrompt('Run experiments'), true);
  assert.equal(isValidDispatchPrompt('true'), true);
  assert.equal(isValidDispatchPrompt('0'), true);
  assert.equal(isValidDispatchPrompt('false'), true);
  assert.equal(isValidDispatchPrompt(' null profile task'), true);  // has real content beyond "null"
  assert.equal(isValidDispatchPrompt('task is null-ish'), true);    // substring, not exact match
});

// --- Wiring regression tests: verify guard is actually called at both entry points ---
// These exist because unit tests of isValidDispatchPrompt pass even if the call site
// is deleted. A deletion of either guard invocation would silently re-open ISS-CS-005.

test('null-prompt guard is called in scheduled-task job runScheduledTask before thread spawn', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const src = await fs.readFile(path.resolve(process.cwd(), 'src/domain/scheduling/jobs/scheduled-task.ts'), 'utf8');

  // Extract runScheduledTask body
  const startIdx = src.indexOf('export function runScheduledTask');
  assert.ok(startIdx >= 0, 'runScheduledTask export must exist');
  // Body ends at the next top-level `function `/`async function ` declaration at column 0
  const after = src.slice(startIdx + 1);
  const endIdx = after.search(/\n(function|async function|export )/);
  const body = after.slice(0, endIdx);

  assert.match(body, /isValidDispatchPrompt\s*\(/, 'runScheduledTask must call isValidDispatchPrompt');
  // Guard must appear BEFORE the side-effect (trackPendingTask / thread spawn)
  const guardPos = body.indexOf('isValidDispatchPrompt');
  const spawnPos = body.indexOf('runScheduledTaskAsync');
  assert.ok(guardPos > 0 && spawnPos > guardPos, 'guard must precede runScheduledTaskAsync');
});

// --- Dry-run rate-limit pre-check regression guard ---
// Verifies that runDispatchAsync calls selectAndClaimTask with dryRun:true
// and checks allConfigsRateLimited before proceeding to real claim+execute.

test('dry-run rate-limit pre-check guard is called in runDispatchAsync before real claim', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const src = await fs.readFile(path.resolve(process.cwd(), 'src/domain/scheduling/jobs/task-dispatch.ts'), 'utf8');

  const startIdx = src.indexOf('async function runDispatchAsync');
  assert.ok(startIdx >= 0, 'runDispatchAsync declaration must exist');
  const after = src.slice(startIdx + 1);
  const endIdx = after.search(/\n(function|async function|export )/);
  const body = after.slice(0, endIdx);

  // Must call selectAndClaimTask with dryRun:true before real claim
  assert.match(body, /dryRun:\s*true/, 'runDispatchAsync must call selectAndClaimTask with dryRun:true');

  // Must import and call allConfigsRateLimited
  assert.match(body, /allConfigsRateLimited\s*\(/, 'runDispatchAsync must call allConfigsRateLimited');

  // dryRun call must precede the real selectAndClaimTask call (without dryRun)
  const dryRunPos = body.indexOf('dryRun: true');
  const realCallPos = body.indexOf('selectAndClaimTask({ scheduleTaskId })');
  assert.ok(dryRunPos >= 0, 'dryRun:true must be present');
  assert.ok(realCallPos > dryRunPos, 'dry run must precede real claim');
});

test('null-prompt guard is called in task-dispatcher selectAndClaimTask before taskMutator.claim', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const src = await fs.readFile(path.resolve(process.cwd(), 'src/domain/tasks/dispatcher.ts'), 'utf8');

  const startIdx = src.indexOf('async function selectAndClaimTask');
  assert.ok(startIdx >= 0, 'selectAndClaimTask declaration must exist');
  const after = src.slice(startIdx + 1);
  const endIdx = after.search(/\n(function|async function|export )/);
  const body = after.slice(0, endIdx);

  assert.match(body, /isValidDispatchPrompt\s*\(/, 'selectAndClaimTask must call isValidDispatchPrompt');
  // Guard must appear BEFORE taskMutator.claim
  const guardPos = body.indexOf('isValidDispatchPrompt');
  const claimPos = body.indexOf('taskMutator.claim');
  assert.ok(guardPos > 0, 'guard must be present');
  assert.ok(claimPos > guardPos, 'guard must precede taskMutator.claim');
});


// --- Locked-project filtering (plan §8) ---

const _LOCK_TEST_PREFIX = '_test_dispatch_lock_';
let _lockCounter = 0;
function nextLockProject(): string { return `${_LOCK_TEST_PREFIX}${++_lockCounter}`; }

function setupLockProject(project: string, lockYaml: string | null): void {
  const dir = path.join(PROJECTS_DIR, project);
  fs.mkdirSync(dir, { recursive: true });
  const content = lockYaml !== null
    ? lockYaml + '\ntasks: []\n'
    : 'tasks: []\n';
  fs.writeFileSync(path.join(dir, 'TASKS.yaml'), content);
}

function cleanupLockProject(project: string): void {
  try { fs.unlinkSync(path.join(PROJECTS_DIR, project, 'TASKS.yaml')); } catch {}
  try { fs.rmdirSync(path.join(PROJECTS_DIR, project)); } catch {}
}

test('filterLockedProjects — removes tasks from locked project', () => {
  const lockedP = nextLockProject();
  const unlockedP = nextLockProject();
  try {
    setupLockProject(lockedP, `lock:
  owner: some-agent
  acquired_at: '2026-01-01T00:00:00.000Z'
  expires_at: '2099-01-01T00:00:00.000Z'`);
    setupLockProject(unlockedP, null);

    const tasks = [
      { id: 'a1', project: lockedP, text: 'locked task', template: 'default' },
      { id: 'b2', project: unlockedP, text: 'free task', template: 'default' },
    ];

    const result = filterLockedProjects(tasks);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'b2');
  } finally {
    cleanupLockProject(lockedP);
    cleanupLockProject(unlockedP);
  }
});

test('filterLockedProjects — expired lock does not block dispatch', () => {
  const expiredP = nextLockProject();
  try {
    setupLockProject(expiredP, `lock:
  owner: old-agent
  acquired_at: '2020-01-01T00:00:00.000Z'
  expires_at: '2020-06-01T00:00:00.000Z'`);

    const tasks = [
      { id: 'c3', project: expiredP, text: 'expired lock task', template: 'default' },
    ];

    const result = filterLockedProjects(tasks);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'c3');
  } finally {
    cleanupLockProject(expiredP);
  }
});

test('filterLockedProjects — all tasks pass through when no locks exist', () => {
  const p1 = nextLockProject();
  const p2 = nextLockProject();
  try {
    setupLockProject(p1, null);
    setupLockProject(p2, null);

    const tasks = [
      { id: 'd4', project: p1, text: 'first', template: 'default' },
      { id: 'e5', project: p2, text: 'second', template: 'default' },
    ];

    const result = filterLockedProjects(tasks);
    assert.equal(result.length, 2);
  } finally {
    cleanupLockProject(p1);
    cleanupLockProject(p2);
  }
});

test('filterLockedProjects — empty input returns empty', () => {
  assert.deepEqual(filterLockedProjects([]), []);
});

test('filterLockedProjects — null input returns null (passthrough)', () => {
  assert.equal(filterLockedProjects(null as any), null);
});
