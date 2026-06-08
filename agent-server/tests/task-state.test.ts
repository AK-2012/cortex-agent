// input:  Node test runner + task-system/task-state API
// output: claim/pause/approve/block transition unit tests
// pos:    Verify non-terminal state transition API
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import './_test-home.js'; // MUST be first: isolate CORTEX_HOME before paths.ts loads
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PROJECTS_DIR } from '../src/core/paths.js';
import {
  approveTask,
  blockTask,
  claimTask,
  clearApprovalTask,
  pauseTask,
  requestApprovalTask,
  resumeTask,
  unblockTask,
  unclaimTask,
} from '../src/domain/tasks/system/task-state.js';

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

/** Write YAML fixture to PROJECTS_DIR so task-state APIs can find it.
 *  Returns cleanup function that restores or removes the file. */
function makeRepo(project: string, initialContent: string): { tasksPath: string; cleanup: () => void } {
  const projectDir = path.join(PROJECTS_DIR, project);
  fs.mkdirSync(projectDir, { recursive: true });
  const tasksPath = path.join(projectDir, 'TASKS.yaml');
  const backup = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : null;
  fs.writeFileSync(tasksPath, initialContent);
  return {
    tasksPath,
    cleanup: () => {
      if (backup !== null) fs.writeFileSync(tasksPath, backup);
      else { try { fs.unlinkSync(tasksPath); } catch {} }
      try { fs.rmdirSync(projectDir); } catch {}
    },
  };
}

// Helper to generate YAML task fixtures
function yamlTask(id: string, extras: string = ''): string {
  return `tasks:\n  - id: ${id}\n    text: "Task"\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n${extras}`;
}

// Use a unique project name prefix for test isolation
const P = '_test_state_';
let testCounter = 0;
function nextProject(): string { return `${P}${++testCounter}`; }

test('claimTask sets claimed-by/claimed-at and returns task_id/agent/claimed_at', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111'));
  try {
    const result = claimTask(null, proj, 'claude-agent', 'a111');
    assert.equal(result.success, true);
    assert.equal(result.task_id, 'a111');
    assert.equal(result.agent, 'claude-agent');
    assert.match(result.claimed_at, /^\d{4}-\d{2}-\d{2}$/);
    const content = readFile(tasksPath);
    assert.match(content, /claimed-by:\s*claude-agent/);
    assert.match(content, /claimed-at:/);
  } finally { cleanup(); }
});

test('claimTask refuses when already claimed', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo(proj, yamlTask('a111', '    claimed-by: other-agent\n    claimed-at: "2026-01-01"\n'));
  try {
    const result = claimTask(null, proj, 'claude-agent', 'a111');
    assert.equal(result.success, false);
    assert.match(result.message, /already claimed/);
  } finally { cleanup(); }
});

test('claimTask refuses completed or blocked tasks', () => {
  const proj1 = nextProject();
  const r1 = makeRepo(proj1, 'tasks:\n  - id: a111\n    text: Done\n    why: ""\n    done-when: ""\n    priority: medium\n    status: done\n    template: coder-review\n    plan: ""\n');
  try {
    assert.equal(claimTask(null, proj1, 'agent', 'a111').success, false);
  } finally { r1.cleanup(); }

  const proj2 = nextProject();
  const r2 = makeRepo(proj2, yamlTask('a111', '    blocked-by: reason\n'));
  try {
    const res = claimTask(null, proj2, 'agent', 'a111');
    assert.equal(res.success, false);
    assert.match(res.message, /blocked/);
  } finally { r2.cleanup(); }
});

test('claimTask reports 404 when project TASKS.yaml missing', () => {
  const result = claimTask(null, '_test_state_ghost', 'agent', 'a111');
  assert.equal(result.success, false);
  assert.match(result.message, /TASKS\.yaml not found/);
});

test('unclaimTask clears claimed-by/claimed-at and refuses if not claimed', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111', '    claimed-by: agent\n    claimed-at: "2026-01-01"\n'));
  try {
    const first = unclaimTask(null, proj, 'a111');
    assert.equal(first.success, true);
    assert.equal(first.task_id, 'a111');
    assert.doesNotMatch(readFile(tasksPath), /claimed-by:/);

    const second = unclaimTask(null, proj, 'a111');
    assert.equal(second.success, false);
    assert.match(second.message, /not in-progress/);
  } finally { cleanup(); }
});

test('pauseTask sets paused: true and clears claimed-by/claimed-at', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111', '    claimed-by: agent\n    claimed-at: "2026-01-01"\n'));
  try {
    const result = pauseTask(null, proj, 'a111');
    assert.equal(result.success, true);
    const content = readFile(tasksPath);
    assert.match(content, /paused:\s*true/);
    assert.doesNotMatch(content, /claimed-by:/);
  } finally { cleanup(); }
});

test('pauseTask refuses if already paused', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo(proj, yamlTask('a111', '    paused: true\n'));
  try {
    const result = pauseTask(null, proj, 'a111');
    assert.equal(result.success, false);
    assert.match(result.message, /already paused/);
  } finally { cleanup(); }
});

test('resumeTask clears paused and refuses if not paused', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111', '    paused: true\n'));
  try {
    const ok = resumeTask(null, proj, 'a111');
    assert.equal(ok.success, true);
    assert.doesNotMatch(readFile(tasksPath), /paused:\s*true/);

    const again = resumeTask(null, proj, 'a111');
    assert.equal(again.success, false);
    assert.match(again.message, /not paused/);
  } finally { cleanup(); }
});

test('requestApprovalTask marks approval-needed and refuses if already marked', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111'));
  try {
    const first = requestApprovalTask(null, proj, 'a111');
    assert.equal(first.success, true);
    assert.match(readFile(tasksPath), /approval-needed:\s*true/);

    const second = requestApprovalTask(null, proj, 'a111');
    assert.equal(second.success, false);
    assert.match(second.message, /already requires approval/);
  } finally { cleanup(); }
});

test('approveTask sets approved-at and clears approval-needed', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111', '    approval-needed: true\n'));
  try {
    const result = approveTask(null, proj, 'a111');
    assert.equal(result.success, true);
    const content = readFile(tasksPath);
    assert.match(content, /approved-at:/);
    assert.doesNotMatch(content, /approval-needed:\s*true/);
  } finally { cleanup(); }
});

test('approveTask refuses completed or blocked tasks', () => {
  const proj1 = nextProject();
  const r1 = makeRepo(proj1, 'tasks:\n  - id: a111\n    text: Done\n    why: ""\n    done-when: ""\n    priority: medium\n    status: done\n    template: coder-review\n    plan: ""\n');
  try {
    assert.equal(approveTask(null, proj1, 'a111').success, false);
  } finally { r1.cleanup(); }

  const proj2 = nextProject();
  const r2 = makeRepo(proj2, yamlTask('a111', '    blocked-by: reason\n'));
  try {
    const res = approveTask(null, proj2, 'a111');
    assert.equal(res.success, false);
    assert.match(res.message, /blocked/);
  } finally { r2.cleanup(); }
});

test('clearApprovalTask removes approval-needed + approved-at', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111', '    approved-at: "2026-01-01"\n'));
  try {
    const result = clearApprovalTask(null, proj, 'a111');
    assert.equal(result.success, true);
    const content = readFile(tasksPath);
    assert.doesNotMatch(content, /approved-at:/);
    assert.doesNotMatch(content, /approval-needed:\s*true/);
  } finally { cleanup(); }
});

test('clearApprovalTask reports no-op when no approval tags present', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo(proj, yamlTask('a111'));
  try {
    const result = clearApprovalTask(null, proj, 'a111');
    assert.equal(result.success, false);
    assert.match(result.message, /no approval tags/);
  } finally { cleanup(); }
});

test('blockTask sets blocked-by and clears claimed-by/claimed-at', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111', '    claimed-by: agent\n    claimed-at: "2026-01-01"\n'));
  try {
    const result = blockTask(null, proj, 'waiting review', 'a111');
    assert.equal(result.success, true);
    assert.equal(result.task_id, 'a111');
    const content = readFile(tasksPath);
    assert.match(content, /blocked-by:\s*waiting review/);
    assert.doesNotMatch(content, /claimed-by:/);
  } finally { cleanup(); }
});

test('unblockTask clears blocked-by', () => {
  const proj = nextProject();
  const { tasksPath, cleanup } = makeRepo(proj, yamlTask('a111', '    blocked-by: reason\n'));
  try {
    const result = unblockTask(null, proj, 'a111');
    assert.equal(result.success, true);
    assert.equal(result.task_id, 'a111');
    const content = readFile(tasksPath);
    assert.doesNotMatch(content, /blocked-by:/);
  } finally { cleanup(); }
});

test('resolveTaskLine via state APIs: unknown task id returns not found', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo(proj, yamlTask('a111'));
  try {
    const result = claimTask(null, proj, 'agent', 'dead');
    assert.equal(result.success, false);
    assert.match(result.message, /Task not found/);
  } finally { cleanup(); }
});
