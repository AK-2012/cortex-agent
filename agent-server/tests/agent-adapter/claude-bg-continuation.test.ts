// input:  Node test runner + ClaudeSession handleLine wiring (_test.makeSessionForTest)
// output: spec for background-task pending-count on result + spontaneous continuation routing
// pos:    CC backend background-task continuation wiring tests (no child process)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';

import { _test } from '../../src/agent-adapter/claude/adapter.js';

const FAKE_STREAM = { write() {}, end() {} } as any;

function fakeTurn(capture: { value?: any; error?: any }) {
  return {
    resolve: (v: any) => { capture.value = v; },
    reject: (e: any) => { capture.error = e; },
    resultData: null, planFilePath: null, enteredPlanMode: false, exitedPlanMode: false,
    askUserQuestions: [], finalOutput: null, longestOutput: null, turnCount: 0,
    onProgress: null, onAssistantMessage: null, onToolUse: null,
    rawStream: FAKE_STREAM, txtStream: FAKE_STREAM, killed: false,
  };
}

const TASK_STARTED = JSON.stringify({ type: 'system', subtype: 'task_started', task_id: 'b6vp8rywx', task_type: 'local_bash' });
const TASK_NOTIFICATION = JSON.stringify({ type: 'system', subtype: 'task_notification', task_id: 'b6vp8rywx', status: 'completed', summary: 'done' });
const RESULT_FIRST = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.02, num_turns: 2, session_id: 'test-session' });
const ASSISTANT_CONT = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Background task done: DONE' }] } });
const RESULT_CONT = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, origin: { kind: 'task-notification' }, total_cost_usd: 0.01, num_turns: 1, session_id: 'test-session' });

test('handleLine: normal turn result carries pendingBackgroundTasks count', (t) => {
  const s: any = _test.makeSessionForTest();
  s.createTurnStreams = () => ({ rawStream: FAKE_STREAM, txtStream: FAKE_STREAM });
  t.after(() => s.close());

  const cap: { value?: any } = {};
  s.currentTurn = fakeTurn(cap);

  s.handleLine(TASK_STARTED);   // background task launched (pending → 1)
  s.handleLine(RESULT_FIRST);   // turn ends while it is still running

  assert.ok(cap.value, 'turn resolved');
  assert.equal(cap.value.pendingBackgroundTasks, 1, 'result reports 1 pending background task');
});

test('handleLine: spontaneous continuation routes assistant text + final result to the sink', (t) => {
  const s: any = _test.makeSessionForTest();
  s.createTurnStreams = () => ({ rawStream: FAKE_STREAM, txtStream: FAKE_STREAM });
  t.after(() => s.close());

  const texts: string[] = [];
  let finalResult: any = null;
  s.setContinuationSink({
    onAssistantText: (txt: string) => texts.push(txt),
    onResult: (r: any) => { finalResult = r; },
  });

  // Background task completes → CLI re-invokes the model with no active turn.
  s.handleLine(TASK_STARTED);
  s.handleLine(TASK_NOTIFICATION);     // arms continuation, pending → 0
  s.handleLine(ASSISTANT_CONT);        // opens a synthetic continuation turn, routes text
  s.handleLine(RESULT_CONT);           // finalizes continuation

  assert.deepEqual(texts, ['Background task done: DONE'], 'assistant text routed to sink');
  assert.ok(finalResult, 'sink received continuation result');
  assert.equal(finalResult.pendingBackgroundTasks, 0, 'no background tasks remain at continuation end');
});

test('handleLine: assistant with no active turn and NO continuation armed is dropped (no sink call)', (t) => {
  const s: any = _test.makeSessionForTest();
  s.createTurnStreams = () => ({ rawStream: FAKE_STREAM, txtStream: FAKE_STREAM });
  t.after(() => s.close());

  let called = false;
  s.setContinuationSink({ onAssistantText: () => { called = true; }, onResult: () => { called = true; } });

  s.handleLine(ASSISTANT_CONT); // no task ever started → not armed
  assert.equal(called, false, 'stray assistant output is not treated as a continuation');
});

test('setContinuationSink/clearContinuationSink and close clear the sink', (t) => {
  const s: any = _test.makeSessionForTest();
  s.createTurnStreams = () => ({ rawStream: FAKE_STREAM, txtStream: FAKE_STREAM });
  t.after(() => s.close());

  const sink = { onAssistantText: () => {}, onResult: () => {} };
  s.setContinuationSink(sink);
  assert.equal(s.continuationSink, sink);
  s.clearContinuationSink();
  assert.equal(s.continuationSink, null);
});
