// input:  Node test runner + orchestration/bg-continuation builder
// output: buildContinuationSink dispatch spec (merge text / waiting vs complete)
// pos:    CC background-task continuation orchestration unit tests
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContinuationSink, isBgContinuationEnabled, isInteractiveChannel } from '../../src/orchestration/bg-continuation.js';

function makeStream() {
  const emitted: string[] = [];
  return { emitted, stream: { emitText: (t: string) => emitted.push(t) } as any };
}

test('buildContinuationSink: assistant text is appended to the same output stream (merge)', () => {
  const { emitted, stream } = makeStream();
  const sink = buildContinuationSink({ stream, onWaiting: () => {}, onComplete: () => {} });
  sink.onAssistantText('background result: DONE');
  assert.deepEqual(emitted, ['background result: DONE']);
});

test('buildContinuationSink: result with 0 pending → onComplete (seal)', () => {
  const { stream } = makeStream();
  let completed: any = null;
  let waited = -1;
  const sink = buildContinuationSink({ stream, onWaiting: (n) => { waited = n; }, onComplete: (r) => { completed = r; } });
  sink.onResult({ pendingBackgroundTasks: 0, total_cost_usd: 0.01 } as any);
  assert.ok(completed, 'onComplete fired');
  assert.equal(waited, -1, 'onWaiting not fired');
});

test('buildContinuationSink: result with >0 pending → onWaiting (chained background tasks)', () => {
  const { stream } = makeStream();
  let completed = false;
  let waited = -1;
  const sink = buildContinuationSink({ stream, onWaiting: (n) => { waited = n; }, onComplete: () => { completed = true; } });
  sink.onResult({ pendingBackgroundTasks: 2 } as any);
  assert.equal(waited, 2, 'onWaiting fired with remaining count');
  assert.equal(completed, false, 'onComplete not fired while tasks remain');
});

test('buildContinuationSink: missing pendingBackgroundTasks treated as 0 → onComplete', () => {
  const { stream } = makeStream();
  let completed = false;
  const sink = buildContinuationSink({ stream, onWaiting: () => {}, onComplete: () => { completed = true; } });
  sink.onResult({} as any);
  assert.equal(completed, true);
});

test('isBgContinuationEnabled: default ON, opt-out via CORTEX_BG_CONTINUATION=0/false', () => {
  const prev = process.env.CORTEX_BG_CONTINUATION;
  try {
    delete process.env.CORTEX_BG_CONTINUATION;
    assert.equal(isBgContinuationEnabled(), true, 'enabled by default when unset');
    process.env.CORTEX_BG_CONTINUATION = '0';
    assert.equal(isBgContinuationEnabled(), false, 'disabled by "0"');
    process.env.CORTEX_BG_CONTINUATION = 'false';
    assert.equal(isBgContinuationEnabled(), false, 'disabled by "false"');
    process.env.CORTEX_BG_CONTINUATION = 'off';
    assert.equal(isBgContinuationEnabled(), false, 'disabled by "off"');
    process.env.CORTEX_BG_CONTINUATION = '1';
    assert.equal(isBgContinuationEnabled(), true, 'explicitly enabled');
    process.env.CORTEX_BG_CONTINUATION = 'true';
    assert.equal(isBgContinuationEnabled(), true);
    process.env.CORTEX_BG_CONTINUATION = '';
    assert.equal(isBgContinuationEnabled(), true, 'empty string is not an opt-out');
  } finally {
    if (prev === undefined) delete process.env.CORTEX_BG_CONTINUATION;
    else process.env.CORTEX_BG_CONTINUATION = prev;
  }
});

test('isInteractiveChannel: only slack/feishu interactive conduits, not thread/dispatch', () => {
  assert.equal(isInteractiveChannel('slack:D123'), true);
  assert.equal(isInteractiveChannel('feishu:oc_abc'), true);
  assert.equal(isInteractiveChannel('thread-abc123'), false);
  assert.equal(isInteractiveChannel('dispatch:task-1'), false);
  assert.equal(isInteractiveChannel(''), false);
});
