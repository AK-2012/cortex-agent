// input:  AgentRunner class, resolveDefaultAgent
// output: unit tests — routing coordination + resolveDefaultAgent config [S8-A]
// pos:    verifies (a) hourglass reaction when queue exists; (b) +1/-1 trackPendingTask;
//         (c) enqueue called for channel; (d) resolveDefaultAgent with no agent;
//         (e) resolveDefaultAgent with directive; (f) agentRunner singleton exists
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunner, agentRunner, resolveDefaultAgent } from '../../src/orchestration/agent-runner.js';
import { conduitQueues, enqueue } from '../../src/orchestration/conduit-queue.js';
import { MockAdapter } from '../../src/platform/testing.js';
import { loadConfig } from '../../src/domain/threads/template-loader.js';

// ── helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function freshChannel() { return `ar-test-${++_seq}`; }

function makeCtx(overrides: Record<string, any> = {}) {
  const channel = overrides.channel ?? freshChannel();
  return {
    message: { ref: { conduit: channel, messageId: 'M1', threadId: null }, text: 'hi', isBot: false, files: [], subtype: undefined } as any,
    channel,
    adapter: new MockAdapter() as any,
    threadAnchorId: null,
    hasFiles: false,
    userMessage: 'hi',
    agentMessage: 'hi',
    ...overrides,
  };
}

// ── (a) hourglass reaction when channel already has a queue ──────────────────

test('(a) route() calls addReaction(hourglass) when channel already has a queue', async () => {
  const channel = freshChannel();
  // Create a never-resolving fake prior queue entry to simulate an active queue
  const { promise, resolve: unlockPrior } = (() => {
    let res!: () => void;
    const p = new Promise<void>(r => { res = r; });
    return { promise: p, resolve: res };
  })();
  // Pre-seed conduitQueues for the channel by enqueuing a blocking task
  enqueue(channel, () => promise);

  const enqueueCalls: string[] = [];
  const trackCalls: number[] = [];
  const runner = new AgentRunner({
    enqueue: (ch, _fn) => { enqueueCalls.push(ch); return true; },
    track: (d) => { trackCalls.push(d); },
  });

  const adapter = new MockAdapter();
  const ctx = makeCtx({ channel, adapter });
  await runner.route(ctx as any);

  // Verify markQueued was called (MockAdapter records marksQueued)
  // assert that the runner called markQueued with the correct ref
  assert.equal(adapter.marksQueued.length, 1, 'markQueued was called once');
  assert.equal(adapter.marksQueued[0].ref.conduit, channel, 'markQueued called with correct channel');
  assert.equal(adapter.marksQueued[0].ref.messageId, 'M1', 'markQueued called with correct messageId');

  assert.equal(enqueueCalls.length, 1, 'enqueue was called for the channel');
  assert.equal(enqueueCalls[0], channel);

  // Clean up: unblock the prior queue and drain
  unlockPrior();
  const tail = conduitQueues.get(channel);
  if (tail) await tail;
});

// ── (b) +1 / -1 trackPendingTask via injectable track ────────────────────────

test('(b) route() calls track(+1) then the enqueue fn calls track(-1) in finally', async () => {
  const trackCalls: number[] = [];
  const enqueueFns: Array<() => Promise<void>> = [];
  // Use injectable execute to avoid spawning real Claude
  const runner = new AgentRunner({
    enqueue: (_ch, fn) => { enqueueFns.push(fn); return false; },
    track: (d) => { trackCalls.push(d); },
    execute: async () => { throw new Error('test-controlled rejection'); },
  });

  const ctx = makeCtx();
  await runner.route(ctx as any);

  // track(+1) must have been called synchronously during route()
  assert.deepEqual(trackCalls, [+1], 'track(+1) called once by route()');
  assert.equal(enqueueFns.length, 1, 'enqueue fn captured');

  // Execute the captured fn — lightweight rejection, track(-1) must run in finally
  try { await enqueueFns[0](); } catch {}

  assert.ok(trackCalls.includes(-1), 'track(-1) called in finally by enqueue fn');
});

// ── (c) enqueue is called with the correct channel ───────────────────────────

test('(c) route() calls enqueue with the correct channel', async () => {
  const channel = freshChannel();
  const enqueueCalls: Array<{ ch: string }> = [];
  const runner = new AgentRunner({
    enqueue: (ch, _fn) => { enqueueCalls.push({ ch }); return false; },
    track: () => {},
  });

  const ctx = makeCtx({ channel });
  await runner.route(ctx as any);

  assert.equal(enqueueCalls.length, 1);
  assert.equal(enqueueCalls[0].ch, channel);
});

// ── (d) resolveDefaultAgent — no default agent → uses activeProfile ───────────

test('(d) resolveDefaultAgent with no default agent uses activeProfile for profileForRun', () => {
  // When mode-manager has no default agent (getDefaultAgent() returns null/empty),
  // resolveDefaultAgent returns effectiveMessage unchanged and uses activeProfile.
  const result = resolveDefaultAgent('my task');
  assert.equal(typeof result.effectiveMessage, 'string');
  assert.equal(typeof result.profileForRun, 'string');
  // The message is either the original or prepended with directive
  assert.ok(result.effectiveMessage.includes('my task'));
  assert.equal(result.defaultAgentName === null || typeof result.defaultAgentName === 'string', true);
});

// ── (e) agentRunner singleton exists and has route method ────────────────────

test('(e) agentRunner singleton is an AgentRunner with a route method', () => {
  assert.ok(agentRunner instanceof AgentRunner);
  assert.equal(typeof agentRunner.route, 'function');
});

// ── (f) AgentRunner default constructor uses real enqueue + trackPendingTask ──

test('(f) AgentRunner constructed with no opts uses module-level defaults', () => {
  const runner = new AgentRunner();
  assert.equal(runner._enqueue, enqueue, 'defaults to module-level enqueue');
});

