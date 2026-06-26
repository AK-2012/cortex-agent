// input:  Node test runner + orchestration/manager-qa daemon-side ask/answer logic
// output: askManager (manager resolution + delivery + resume / human escalation) / submitAnswer /
//         getAnswer / tryAnswerFromHuman / buildQuestionNotice tests
// pos:    Verify the synchronous ask_manager / answer_subtask Q&A channel (subtask → manager up-ask)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { threadStore } from '../src/store/thread-repo.js';
import {
  askManager,
  submitAnswer,
  getAnswer,
  tryAnswerFromHuman,
  buildQuestionNotice,
  _testResetManagerQa,
} from '../src/orchestration/manager-qa.js';
import type { ThreadRecord, ThreadStatus } from '../src/core/types/thread-types.js';

const createdThreadIds = new Set<string>();
let seq = 0;

after(async () => {
  for (const id of createdThreadIds) await threadStore.delete(id);
  await threadStore.flush();
});

function makeThread(over: Partial<ThreadRecord> = {}): ThreadRecord {
  const id = over.id ?? `thr_qa${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const rec: ThreadRecord = {
    id,
    templateName: null,
    status: 'running' as ThreadStatus,
    channel: 'C-qa-test',
    projectId: 'general',
    platformThreadId: null,
    userMessage: 'x',
    userMessageTs: 'ts',
    workspacePath: '',
    artifactPath: '',
    agents: {},
    activeAgent: 'main',
    activeStage: null,
    currentStepIndex: 0,
    steps: [],
    iterationCounts: {},
    totalCostUsd: 0,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    error: null,
    abortReason: null,
    metadata: null,
    ...over,
  };
  threadStore.set(rec);
  createdThreadIds.add(id);
  return rec;
}

/** A waiting manager M (owns task `mgrTaskId`) + a running child C (owns task `childTaskId`,
 *  whose parent task is `mgrTaskId`). The injected readTask wires the task-tree link. */
function makeManagerChild(opts: { managerStatus?: ThreadStatus; parentTaskId?: string | null; originChannel?: string | null } = {}) {
  const mgrTaskId = 'MGR' + (seq++);
  const childTaskId = 'CH' + (seq++);
  const manager = makeThread({ status: opts.managerStatus ?? 'waiting', metadata: { taskId: mgrTaskId, taskProject: 'proj', trigger: 'task-dispatch', waitingOnTasks: [childTaskId] } });
  const child = makeThread({ status: 'running', metadata: { taskId: childTaskId, taskProject: 'proj', trigger: 'task-dispatch' } });
  const parentTaskId = opts.parentTaskId === undefined ? mgrTaskId : opts.parentTaskId;
  const readTask = (_project: string | null, taskId: string) => {
    if (taskId === childTaskId) return { parent: parentTaskId, origin_channel: opts.originChannel ?? null };
    if (taskId === mgrTaskId) return { parent: null, origin_channel: opts.originChannel ?? null };
    return null;
  };
  return { manager, child, mgrTaskId, childTaskId, readTask };
}

test('askManager resolves the waiting manager via the task tree, delivers the question, and resumes it', async () => {
  _testResetManagerQa();
  const { manager, child, readTask } = makeManagerChild();
  const resumed: string[] = [];
  const res = await askManager(child.id, 'Did you intend approach A or B for the loss term?', { readTask, resume: (id) => resumed.push(id) });

  assert.equal(res.ok, true);
  assert.equal(res.ok && res.target, 'manager');
  assert.equal(res.ok && (res as { managerThreadId?: string }).managerThreadId, manager.id);

  const m = threadStore.get(manager.id)!;
  assert.equal(m.metadata!.pendingMessages!.length, 1);
  assert.match(m.metadata!.pendingMessages![0], /approach A or B/);
  assert.ok(res.ok && new RegExp(res.questionId).test(m.metadata!.pendingMessages![0]), 'question notice carries the questionId');
  assert.equal(m.metadata!.pendingQuestions!.length, 1);
  assert.deepEqual(resumed, [manager.id], 'a waiting manager is resumed to answer');

  // Answer not yet available.
  const before = getAnswer(res.ok ? res.questionId : '');
  assert.equal(before.found, true);
  assert.equal(before.answered, false);
});

test('submitAnswer records the answer and forces the manager back to waiting via pendingControl', async () => {
  _testResetManagerQa();
  const { manager, child, readTask } = makeManagerChild();
  const res = await askManager(child.id, 'why?', { readTask, resume: () => {} });
  assert.equal(res.ok, true);
  const qid = res.ok ? res.questionId : '';

  const out = await submitAnswer(qid, 'Use approach A — it matches the baseline.');
  assert.equal(out.ok, true);

  const got = getAnswer(qid);
  assert.equal(got.answered, true);
  assert.equal(got.answer, 'Use approach A — it matches the baseline.');

  const m = threadStore.get(manager.id)!;
  assert.deepEqual(m.metadata!.pendingControl, { action: 'wait' }, 'manager re-suspends after answering');
  assert.equal(m.metadata!.pendingQuestions!.length, 0, 'answered question cleared from manager');
});

test('askManager does not resume a manager that is not currently waiting (only delivers)', async () => {
  _testResetManagerQa();
  const { manager, child, readTask } = makeManagerChild({ managerStatus: 'running' });
  const resumed: string[] = [];
  const res = await askManager(child.id, 'q', { readTask, resume: (id) => resumed.push(id) });

  assert.equal(res.ok, true);
  assert.equal(resumed.length, 0, 'a running manager consumes the question in-loop, not via resume');
  const m = threadStore.get(manager.id)!;
  assert.equal(m.metadata!.pendingMessages!.length, 1, 'question still delivered');
});

test('askManager escalates to the human origin channel when there is no manager', async () => {
  _testResetManagerQa();
  const { child, readTask } = makeManagerChild({ parentTaskId: null, originChannel: 'C-human-origin' });
  const posted: Array<[string, string]> = [];
  const res = await askManager(child.id, 'Should I prioritize speed or accuracy?', {
    readTask,
    resume: () => { throw new Error('must not resume — no manager'); },
    postToChannel: (ch, t) => { posted.push([ch, t]); },
  });

  assert.equal(res.ok, true);
  assert.equal(res.ok && res.target, 'human');
  assert.equal(res.ok && (res as { channel?: string }).channel, 'C-human-origin');
  assert.equal(posted.length, 1);
  assert.equal(posted[0][0], 'C-human-origin');
  assert.match(posted[0][1], /speed or accuracy/);

  // The human replies on that channel — routed back as the answer.
  const handled = tryAnswerFromHuman('C-human-origin', 'Prioritize accuracy.');
  assert.equal(handled, true);
  const got = getAnswer(res.ok ? res.questionId : '');
  assert.equal(got.answered, true);
  assert.equal(got.answer, 'Prioritize accuracy.');
});

test('askManager returns an error when there is neither a manager nor an origin channel', async () => {
  _testResetManagerQa();
  const { child, readTask } = makeManagerChild({ parentTaskId: null, originChannel: null });
  const res = await askManager(child.id, 'q', { readTask, resume: () => {} });
  assert.equal(res.ok, false);
  assert.match(res.ok ? '' : res.error, /no manager|best judgment|abort/i);
});

test('tryAnswerFromHuman returns false for a channel with no pending escalated question', () => {
  _testResetManagerQa();
  assert.equal(tryAnswerFromHuman('C-nothing-pending', 'hello'), false);
});

test('submitAnswer on an unknown question id fails cleanly', async () => {
  _testResetManagerQa();
  const out = await submitAnswer('q_does_not_exist', 'answer');
  assert.equal(out.ok, false);
  assert.match(out.error ?? '', /unknown|expired/i);
});

test('buildQuestionNotice carries the subtask id, the question, and answer_subtask guidance', () => {
  const notice = buildQuestionNotice({ questionId: 'q_abc123', fromTaskId: 'CH9', question: 'Which dataset split?' });
  assert.match(notice, /q_abc123/);
  assert.match(notice, /Which dataset split\?/);
  assert.match(notice, /answer_subtask/);
  assert.match(notice, /CH9/);
});
