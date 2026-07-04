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
  const sink = buildContinuationSink({ stream, onWaiting: () => {}, onComplete: () => {}, onRateLimited: () => {} });
  sink.onAssistantText('background result: DONE');
  assert.deepEqual(emitted, ['background result: DONE']);
});

test('buildContinuationSink: result with 0 pending → onComplete (seal)', () => {
  const { stream } = makeStream();
  let completed: any = null;
  let waited = -1;
  const sink = buildContinuationSink({ stream, onWaiting: (n) => { waited = n; }, onComplete: (r) => { completed = r; }, onRateLimited: () => {} });
  sink.onResult({ pendingBackgroundTasks: 0, total_cost_usd: 0.01 } as any);
  assert.ok(completed, 'onComplete fired');
  assert.equal(waited, -1, 'onWaiting not fired');
});

test('buildContinuationSink: result with >0 pending → onWaiting (chained background tasks)', () => {
  const { stream } = makeStream();
  let completed = false;
  let waited = -1;
  const sink = buildContinuationSink({ stream, onWaiting: (n) => { waited = n; }, onComplete: () => { completed = true; }, onRateLimited: () => {} });
  sink.onResult({ pendingBackgroundTasks: 2 } as any);
  assert.equal(waited, 2, 'onWaiting fired with remaining count');
  assert.equal(completed, false, 'onComplete not fired while tasks remain');
});

test('buildContinuationSink: missing pendingBackgroundTasks treated as 0 → onComplete', () => {
  const { stream } = makeStream();
  let completed = false;
  const sink = buildContinuationSink({ stream, onWaiting: () => {}, onComplete: () => { completed = true; }, onRateLimited: () => {} });
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

test('buildContinuationSink: onToolUse is forwarded to the sink when provided', () => {
  const { stream } = makeStream();
  const toolCalls: Array<{ name: string; input: any }> = [];
  const sink = buildContinuationSink({
    stream,
    onToolUse: (name, input) => { toolCalls.push({ name, input }); },
    onWaiting: () => {},
    onComplete: () => {},
    onRateLimited: () => {},
  });
  assert.ok(sink.onToolUse, 'onToolUse is set on the sink');
  sink.onToolUse!('Bash', { command: 'echo hi' });
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, 'Bash');
});

test('buildContinuationSink: onToolUse is undefined when not provided', () => {
  const { stream } = makeStream();
  const sink = buildContinuationSink({
    stream,
    onWaiting: () => {},
    onComplete: () => {},
    onRateLimited: () => {},
  });
  assert.equal(sink.onToolUse, undefined, 'onToolUse is undefined when not passed');
});

test('buildContinuationSink: rateLimited result → onRateLimited (not onComplete/onWaiting)', () => {
  const { stream } = makeStream();
  let limited: any = null;
  let completed = false;
  let waited = -1;
  const sink = buildContinuationSink({
    stream,
    onWaiting: (n) => { waited = n; },
    onComplete: () => { completed = true; },
    onRateLimited: (r) => { limited = r; },
  });
  sink.onResult({ rateLimited: true, pendingBackgroundTasks: 0, total_cost_usd: 0.01 } as any);
  assert.ok(limited, 'onRateLimited fired');
  assert.equal(completed, false, 'onComplete not fired for rate-limited result');
  assert.equal(waited, -1, 'onWaiting not fired for rate-limited result');
});

test('buildContinuationSink: rateLimited + pending > 0 → onRateLimited (takes priority)', () => {
  const { stream } = makeStream();
  let limited: any = null;
  let waited = -1;
  const sink = buildContinuationSink({
    stream,
    onWaiting: (n) => { waited = n; },
    onComplete: () => {},
    onRateLimited: (r) => { limited = r; },
  });
  sink.onResult({ rateLimited: true, pendingBackgroundTasks: 3 } as any);
  assert.ok(limited, 'onRateLimited fired even with pending tasks');
  assert.equal(waited, -1, 'onWaiting not fired — rate-limited takes priority over waiting');
});

test('isInteractiveChannel: only slack/feishu interactive conduits, not thread/dispatch', () => {
  assert.equal(isInteractiveChannel('slack:D123'), true);
  assert.equal(isInteractiveChannel('feishu:oc_abc'), true);
  assert.equal(isInteractiveChannel('thread-abc123'), false);
  assert.equal(isInteractiveChannel('dispatch:task-1'), false);
  assert.equal(isInteractiveChannel(''), false);
});
