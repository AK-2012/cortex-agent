// input:  Node test runner + task-system/task-mutations API
// output: add/batchEdit/decompose unit tests
// pos:    Verify task structure transformation API
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PROJECTS_DIR } from '../src/core/paths.js';
import {
  addTask,
  batchEdit,
  decomposeTask,
} from '../src/domain/tasks/system/task-mutations.js';

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

// Use unique project names for test isolation
const P = '_test_mut_';
let testCounter = 0;
function nextProject(): string { return `${P}${++testCounter}`; }

function makeRepo(projects: Record<string, string>): { cleanup: () => void; tasksPathFor: (project: string) => string } {
  const backups = new Map<string, { path: string; content: string | null }>();
  const projectDirs: string[] = [];
  for (const [project, content] of Object.entries(projects)) {
    const projectDir = path.join(PROJECTS_DIR, project);
    projectDirs.push(projectDir);
    fs.mkdirSync(projectDir, { recursive: true });
    const tasksPath = path.join(projectDir, 'TASKS.yaml');
    const backup = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : null;
    backups.set(project, { path: tasksPath, content: backup });
    fs.writeFileSync(tasksPath, content);
  }
  return {
    tasksPathFor: (project: string) => path.join(PROJECTS_DIR, project, 'TASKS.yaml'),
    cleanup: () => {
      for (const [, { path: p, content }] of backups) {
        if (content !== null) fs.writeFileSync(p, content);
        else { try { fs.unlinkSync(p); } catch {} }
      }
      for (const dir of projectDirs) {
        try { fs.rmdirSync(dir); } catch {}
      }
    },
  };
}

test('addTask appends new task and returns a freshly generated 4-hex id', () => {
  const proj = nextProject();
  const { tasksPathFor, cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: Existing\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, 'New task', 'because reasons', 'tests pass', 'high', 'coder-review');
    assert.equal(result.success, true);
    assert.match(result.task_id, /^[0-9a-f]{4}$/);
    assert.notEqual(result.task_id, '1111');

    const content = readFile(tasksPathFor(proj));
    assert.match(content, /text:\s*New task/);
    assert.match(content, /why:\s*because reasons/);
    assert.match(content, /done-when:\s*tests pass/);
    assert.match(content, /priority:\s*high/);
  } finally { cleanup(); }
});

test('addTask rejects unknown template name', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: Existing\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, 'Bad template task', 'why', 'done', 'medium', 'nonexistent');
    assert.equal(result.success, false);
    assert.match(result.message, /Unknown template: 'nonexistent'/);
    assert.match(result.message, /coder-review/);
  } finally { cleanup(); }
});

test('addTask accepts known template names', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: Existing\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, 'Good template task', 'why', 'done', 'medium', 'default');
    assert.equal(result.success, true);
  } finally { cleanup(); }
});

test('addTask rejects empty text', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: A\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, null, 'why', 'done', 'medium', 'coder-review');
    assert.equal(result.success, false);
    assert.match(result.message, /--text is required/);
  } finally { cleanup(); }
});

test('addTask rejects null template', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: A\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, 'New', 'why', 'done', 'medium', null);
    assert.equal(result.success, false);
    assert.match(result.message, /--template is required/);
  } finally { cleanup(); }
});

test('addTask reports 404 when project TASKS.yaml missing', () => {
  const result = addTask('_test_mut_ghost', 'New', 'why', 'done', 'medium', 'coder-review');
  assert.equal(result.success, false);
  assert.match(result.message, /TASKS\.yaml not found/);
});

test('addTask with plan stores plan field', () => {
  const proj = nextProject();
  const { tasksPathFor, cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: A1\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, 'New A', 'why', 'done', 'medium', 'coder-review', null, 'path/to/plan.md');
    assert.equal(result.success, true);
    const content = readFile(tasksPathFor(proj));
    assert.match(content, /plan:\s*path\/to\/plan\.md/);
  } finally { cleanup(); }
});

test('addTask stores depends-on list for dependencies', () => {
  const proj = nextProject();
  const { tasksPathFor, cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: Existing\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, 'Dependent', 'why', 'done', 'medium', 'coder-review', ['1111', '2222']);
    assert.equal(result.success, true);
    const content = readFile(tasksPathFor(proj));
    assert.match(content, /depends-on:/);
    assert.match(content, /- "1111"/);
    assert.match(content, /- "2222"/);
  } finally { cleanup(); }
});

test('addTask splits comma-joined depends-on argument', () => {
  const proj = nextProject();
  const { tasksPathFor, cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: "1111"\n    text: A\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = addTask(proj, 'Tagged', 'why', 'done', 'medium', 'coder-review', ['1111,2222']);
    assert.equal(result.success, true);
    const content = readFile(tasksPathFor(proj));
    assert.match(content, /- "1111"/);
    assert.match(content, /- "2222"/);
  } finally { cleanup(); }
});

test('batchEdit applies the same options to every listed task id and summarises results', () => {
  const proj = nextProject();
  const { tasksPathFor, cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: a111\n    text: Task A\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n  - id: a222\n    text: Task B\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = batchEdit(proj, ['a111', 'a222'], { priority: 'high' });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((r: any) => r.success));

    const content = readFile(tasksPathFor(proj));
    const highHits = content.match(/priority:\s*high/g) || [];
    assert.equal(highHits.length, 2);
  } finally { cleanup(); }
});

test('batchEdit reports failures for unknown task ids without erroring out', () => {
  const proj = nextProject();
  const { cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: a111\n    text: Task A\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = batchEdit(proj, ['a111', 'dead'], { priority: 'high' });
    assert.equal(result.success, false);
    assert.equal(result.results[0].success, true);
    assert.equal(result.results[1].success, false);
    assert.match(result.message, /1\/2 tasks updated/);
  } finally { cleanup(); }
});

test('decomposeTask replaces original task with N subtasks each with unique 4-hex ids', () => {
  const proj = nextProject();
  const { tasksPathFor, cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: p111\n    text: Parent\n    why: split me\n    done-when: all done\n    priority: high\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = decomposeTask(proj, null, [
      { text: 'Sub 1', why: 'first', done_when: 'one done' },
      { text: 'Sub 2', template: 'coder-review', priority: 'low' },
      { text: 'Sub 3' },
    ], 'p111');
    assert.equal(result.success, true);
    assert.match(result.message, /decomposed into 3 subtasks/);

    const content = readFile(tasksPathFor(proj));
    assert.doesNotMatch(content, /text:\s*Parent/);
    assert.match(content, /text:\s*Sub 1/);
    assert.match(content, /text:\s*Sub 2/);
    assert.match(content, /text:\s*Sub 3/);
    assert.match(content, /why:\s*first/);
    assert.match(content, /done-when:\s*one done/);
    assert.match(content, /priority:\s*low/);

    const subIds = [...content.matchAll(/id:\s*"?([0-9a-f]{4})"?/g)].map((m) => m[1]);
    assert.equal(subIds.length, 3);
    assert.equal(new Set(subIds).size, 3);
    assert.equal(subIds.includes('p111'), false);
  } finally { cleanup(); }
});

test('decomposeTask defaults priority to medium when not supplied', () => {
  const proj = nextProject();
  const { tasksPathFor, cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: p111\n    text: Parent\n    why: ""\n    done-when: ""\n    priority: high\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const result = decomposeTask(proj, null, [{ text: 'Only sub' }], 'p111');
    assert.equal(result.success, true);
    assert.match(readFile(tasksPathFor(proj)), /priority:\s*medium/);
  } finally { cleanup(); }
});

test('decomposeTask reports 404 when TASKS.yaml absent and Task-not-found for unknown id', () => {
  const missing = decomposeTask('_test_mut_ghost2', null, [{ text: 'X' }], 'p111');
  assert.equal(missing.success, false);
  assert.match(missing.message, /TASKS\.yaml not found/);

  const proj = nextProject();
  const { cleanup } = makeRepo({ [proj]: 'tasks:\n  - id: p111\n    text: Parent\n    why: ""\n    done-when: ""\n    priority: medium\n    status: open\n    template: coder-review\n    plan: ""\n' });
  try {
    const unknown = decomposeTask(proj, null, [{ text: 'X' }], 'dead');
    assert.equal(unknown.success, false);
    assert.match(unknown.message, /Task not found/);
  } finally { cleanup(); }
});
