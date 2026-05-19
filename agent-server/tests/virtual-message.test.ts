// input:  node:test, MockAdapter, VirtualMessage
// output: VirtualMessage append/flush/standalone/tail behavior tests
// pos:    Platform-agnostic VirtualMessage regression test
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VirtualMessage,
  _testSetRetryDelays,
  _testResetRetryDelays,
} from '../src/platform/virtual-message.js';
import { MockAdapter } from '../src/platform/testing.js';

async function flush(vm: VirtualMessage) {
  await vm.flush();
}

// Retry delays are real setTimeout in production. For the whole test file we
// zero them out so "sustained transient failure" cases exercise the retry
// code path without paying ~6.3s of wall-clock per case. The specific test
// that verifies the zero-delay contract re-sets defaults and then restores.
test.beforeEach(() => { _testSetRetryDelays([0, 0, 0, 0]); });
test.afterEach(() => { _testResetRetryDelays(); });

test('VirtualMessage: retry path runs without real wall-clock delay when delays are zeroed', async () => {
  _testSetRetryDelays([0, 0, 0, 0]);
  const adapter = new MockAdapter();
  adapter.failPostMessageCount = 3; // forces 2 retries (rich + plain + retry)
  const vm = new VirtualMessage(adapter, 'C-delay');
  const t0 = Date.now();
  vm.append('zero-delay retry');
  await flush(vm);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 200, `zero-delay retry must complete <200ms, got ${elapsed}ms`);
  assert.equal(adapter.posted.length, 1, 'message still reaches Slack after retries');
});

// --- Basic aggregation ---

test('VirtualMessage: single append creates one top-level message', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('hello');
  await flush(vm);

  assert.equal(adapter.posted.length, 1);
  assert.equal(adapter.posted[0].content.text, 'hello');
  assert.equal(adapter.posted[0].channel, 'C123');
  assert.equal(adapter.posted[0].threadId, undefined, 'first message is top-level');
  assert.equal(adapter.updated.length, 0);
});

test('VirtualMessage: two short messages — second uses update', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('first');
  vm.append('second');
  await flush(vm);

  assert.equal(adapter.posted.length, 1);
  assert.equal(adapter.updated.length, 1);
  assert.equal(adapter.updated[0].content.text, 'first\nsecond');
});

test('VirtualMessage: three short messages all aggregate', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('one');
  vm.append('two');
  vm.append('three');
  await flush(vm);

  assert.equal(adapter.posted.length, 1);
  assert.equal(adapter.updated.length, 2);
  const finalText = adapter.updated[1].content.text;
  assert.ok(finalText.includes('one'));
  assert.ok(finalText.includes('two'));
  assert.ok(finalText.includes('three'));
});

// --- Splitting ---

test('VirtualMessage: exceeding maxMessageLength forces new message', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('x'.repeat(2000));
  vm.append('y'.repeat(1500));
  await flush(vm);

  assert.equal(adapter.posted.length, 2);
  assert.equal(adapter.updated.length, 0);
});

test('VirtualMessage: second table forces new message', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('intro\n| a | b |\n| 1 | 2 |');
  vm.append('more\n| c | d |\n| 3 | 4 |');
  await flush(vm);

  assert.equal(adapter.posted.length, 2);
});

test('VirtualMessage: 3rd HR forces new message', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('a\n---\nb');
  vm.append('c\n---\nd');
  vm.append('e\n---\nf');
  await flush(vm);

  assert.equal(adapter.posted.length, 2);
});

// --- Thread parent behavior (no external threadId) ---

test('VirtualMessage: no threadId — first top-level, overflow to thread', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('x'.repeat(2000));
  vm.append('y'.repeat(1500));
  await flush(vm);

  assert.equal(adapter.posted.length, 2);
  assert.equal(adapter.posted[0].threadId, undefined, 'first is top-level');
  assert.equal(adapter.posted[1].threadId, '1000', 'overflow threads under first');
});

test('VirtualMessage: getParentTs returns first message id', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  assert.equal(vm.getParentTs(), null);
  vm.append('hello');
  await flush(vm);
  assert.equal(vm.getParentTs(), '1000');
});

test('VirtualMessage: getParentRef returns full MessageRef', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('hello');
  await flush(vm);
  const ref = vm.getParentRef();
  assert.ok(ref);
  assert.equal(ref!.channel, 'C123');
  assert.equal(ref!.messageId, '1000');
});

test('VirtualMessage: multiple splits all go to thread under first', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('x'.repeat(2000));
  vm.append('y'.repeat(1500));
  vm.append('z'.repeat(1500));
  await flush(vm);

  assert.equal(adapter.posted.length, 3);
  assert.equal(adapter.posted[0].threadId, undefined);
  assert.equal(adapter.posted[1].threadId, '1000');
  assert.equal(adapter.posted[2].threadId, '1000');
});

// --- External threadId behavior ---

test('VirtualMessage: with threadId — all messages use it', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123', { threadId: '999.000' });
  vm.append('x'.repeat(2000));
  vm.append('y'.repeat(1500));
  await flush(vm);

  assert.equal(adapter.posted.length, 2);
  assert.equal(adapter.posted[0].threadId, '999.000');
  assert.equal(adapter.posted[1].threadId, '999.000');
});

test('VirtualMessage: with threadId — no parentRef set', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123', { threadId: '999.000' });
  vm.append('hello');
  await flush(vm);
  assert.equal(vm.getParentTs(), null);
});

// --- Callbacks ---

test('VirtualMessage: onMessagePosted called on post, not update', async () => {
  const adapter = new MockAdapter();
  const refs: any[] = [];
  const vm = new VirtualMessage(adapter, 'C123', {
    onMessagePosted: (ref) => refs.push(ref),
  });
  vm.append('first');
  vm.append('second');
  await flush(vm);

  assert.equal(refs.length, 1);
  assert.equal(refs[0].messageId, '1000');
});

test('VirtualMessage: onMessagePosted called for each new post', async () => {
  const adapter = new MockAdapter();
  const refs: any[] = [];
  const vm = new VirtualMessage(adapter, 'C123', {
    onMessagePosted: (ref) => refs.push(ref),
  });
  vm.append('x'.repeat(2000));
  vm.append('y'.repeat(1500));
  await flush(vm);

  assert.equal(refs.length, 2);
  assert.equal(refs[0].messageId, '1000');
  assert.equal(refs[1].messageId, '1001');
});

test('VirtualMessage: empty/whitespace text ignored', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('');
  vm.append('   ');
  vm.append('\n');
  await flush(vm);

  assert.equal(adapter.posted.length, 0);
  assert.equal(adapter.updated.length, 0);
});

test('VirtualMessage: getRefs returns all message refs', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('x'.repeat(2000));
  vm.append('y'.repeat(1500));
  await flush(vm);

  const refs = vm.getRefs();
  assert.equal(refs.length, 2);
  assert.equal(refs[0].messageId, '1000');
  assert.equal(refs[1].messageId, '1001');
});

// --- Serialization ---

test('VirtualMessage: rapid appends processed in order', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('msg1');
  vm.append('msg2');
  vm.append('msg3');
  vm.append('msg4');
  vm.append('msg5');
  await flush(vm);

  assert.equal(adapter.posted.length, 1);
  assert.equal(adapter.updated.length, 4);
  const finalText = adapter.updated[3].content.text;
  assert.ok(finalText.includes('msg1'));
  assert.ok(finalText.includes('msg5'));
});

test('VirtualMessage: char limit split with correct threading', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('x'.repeat(2000));
  vm.append('y'.repeat(1500));
  vm.append('z'.repeat(500));
  await flush(vm);

  assert.equal(adapter.posted.length, 2);
  assert.equal(adapter.posted[0].threadId, undefined);
  assert.equal(adapter.posted[1].threadId, '1000');
  assert.equal(adapter.updated.length, 1);
});

test('VirtualMessage: richBlocks included in post and update', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('hello');
  vm.append('world');
  await flush(vm);

  assert.ok(adapter.posted[0].content.richBlocks);
  assert.equal(adapter.posted[0].content.richBlocks![0].type, 'markdown');
  assert.ok(adapter.updated[0].content.richBlocks);
  assert.equal(adapter.updated[0].content.richBlocks![0].type, 'markdown');
});

// --- postStandalone ---

test('VirtualMessage: postStandalone creates independent message', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('content');
  const ref = await vm.postStandalone('standalone text');
  await flush(vm);

  assert.equal(adapter.posted.length, 2);
  assert.ok(ref);
  assert.equal(ref!.messageId, '1001');
});

test('VirtualMessage: postStandalone resets current, next append creates new', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('before');
  await vm.postStandalone('standalone');
  vm.append('after');
  await flush(vm);

  assert.equal(adapter.posted.length, 3);
});

test('VirtualMessage: postStandalone with actions routes to postInteractive and still splits', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('A');
  vm.append('B');
  const ref = await vm.postStandalone('Form', {
    richBlocks: [{ type: 'section', text: 'Approve?' }],
    actions: [{ type: 'button', text: 'Approve', actionId: 'approve', value: 'yes' }],
  });
  vm.append('C');
  await flush(vm);

  // 3 posts: A+B aggregated → form → C; plus updateMessage for B aggregation
  assert.equal(adapter.posted.length, 3);
  assert.equal(adapter.posted[0].content.text, 'A');
  assert.deepEqual(adapter.updated[0].content.text, 'A\nB');

  // Form uses postInteractive path (actions recorded by MockAdapter)
  const formPost = adapter.posted[1];
  assert.equal(formPost.content.text, 'Form');
  assert.ok(formPost.actions, 'form post captured actions (postInteractive path)');
  assert.equal(formPost.actions!.length, 1);
  assert.equal(formPost.actions![0].actionId, 'approve');

  // Post-form append must create a new message, NOT merge back into A+B
  assert.equal(adapter.posted[2].content.text, 'C');
  // updateMessage was only used for the pre-form aggregation, never for C
  assert.equal(adapter.updated.length, 1);

  assert.ok(ref);
});

// --- postOnce static ---

test('VirtualMessage.postOnce: creates single message and returns ref', async () => {
  const adapter = new MockAdapter();
  const ref = await VirtualMessage.postOnce(adapter, 'C123', 'one-shot');

  assert.ok(ref);
  assert.equal(ref!.messageId, '1000');
  assert.equal(adapter.posted.length, 1);
  assert.equal(adapter.posted[0].content.text, 'one-shot');
});

// --- Platform capability: custom maxMessageLength ---

test('VirtualMessage: respects adapter maxMessageLength', async () => {
  const adapter = new MockAdapter({ maxMessageLength: 100 });
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('x'.repeat(80));
  vm.append('y'.repeat(80));
  await flush(vm);

  assert.equal(adapter.posted.length, 2, 'split at 100 char limit, not 3000');
});

// --- MockAdapter tests ---

test('MockAdapter: simulateMessage triggers registered handler', async () => {
  const adapter = new MockAdapter();
  const received: string[] = [];
  adapter.onMessage(async (ctx) => {
    received.push(ctx.message.text);
  });
  await adapter.simulateMessage('C123', 'hello');
  assert.deepEqual(received, ['hello']);
});

test('MockAdapter: simulateAction triggers registered handler', async () => {
  const adapter = new MockAdapter();
  const received: string[] = [];
  adapter.onAction('btn_click', async (ctx) => {
    received.push(ctx.value);
  });
  await adapter.simulateAction('btn_click', 'payload-1');
  assert.deepEqual(received, ['payload-1']);
});

test('MockAdapter: reset clears all recorded state', async () => {
  const adapter = new MockAdapter();
  await adapter.postMessage('C1', { text: 'hi' });
  await adapter.addReaction({ channel: 'C1', messageId: '1' }, 'thumbsup');
  adapter.reset();

  assert.equal(adapter.posted.length, 0);
  assert.equal(adapter.reactions.length, 0);
});

// --- Regression: silent message drops on transient adapter failures ---
// These tests guard against the bug where a single Slack API failure
// (rate limit, network blip) silently drops a message because errors
// were swallowed without retry or fallback in VirtualMessage.

test('VirtualMessage: sustained postMessage failure is retried (rich+plain+retries), message reaches Slack', async () => {
  const adapter = new MockAdapter();
  // Simulate a sustained transient failure: 3 failures across rich attempt,
  // plain attempt, and the first retry. The retry path must eventually succeed.
  adapter.failPostMessageCount = 3;
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('important content that must not be dropped');
  await flush(vm);

  assert.equal(adapter.posted.length, 1, 'message must reach Slack after retries');
  assert.equal(adapter.posted[0].content.text, 'important content that must not be dropped');
});

test('VirtualMessage: sustained updateMessage failure does not silently drop appended text', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('first');
  await flush(vm);
  assert.equal(adapter.posted.length, 1);

  // Simulate a sustained Slack rate-limit covering BOTH the rich attempt and the
  // plain-text fallback. Pre-fix: this silently drops 'second' because:
  //   1. _processAppend mutates currentContent='first\n\nsecond' BEFORE _updateCurrent
  //   2. _updateCurrent fails silently (both attempts)
  //   3. The next append triggers needsSplit and calls _postNew(text) with ONLY
  //      the new text — 'second' is permanently lost from anywhere.
  adapter.failUpdateMessageCount = 99; // enough to fail every attempt
  vm.append('second');
  await flush(vm);
  adapter.failUpdateMessageCount = 0;

  // Now append a third message large enough to trigger needsSplit → _postNew.
  vm.append('z'.repeat(3500));
  await flush(vm);

  const visible = reconstructVisibleText(adapter);
  assert.ok(
    visible.includes('first'),
    `'first' must be visible. Visible (first 200): ${visible.slice(0, 200)}`
  );
  assert.ok(
    visible.includes('second'),
    `'second' must NOT be silently dropped after sustained update failure. Visible (first 200): ${visible.slice(0, 200)}`
  );
});

test('VirtualMessage: chunk[0] sustained failure does not orphan chunk[1] as top-level message', async () => {
  const adapter = new MockAdapter();
  // Sustained failure on chunk[0] only: rich + plain both fail, but retries succeed.
  adapter.failPostMessageCount = 2;
  const vm = new VirtualMessage(adapter, 'C123');
  // Force chunking into 2 chunks.
  vm.append('a'.repeat(2500) + '\n' + 'b'.repeat(2500));
  await flush(vm);

  // After fix: parentRef is established (chunk[0] succeeded via retry),
  // both chunks visible, second chunk is in thread.
  assert.equal(adapter.posted.length, 2, 'both chunks must reach Slack');
  assert.equal(adapter.posted[0].threadId, undefined, 'first chunk top-level');
  assert.equal(
    adapter.posted[1].threadId,
    '1000',
    'second chunk must be a thread reply, not orphaned at top level'
  );
});

test('VirtualMessage: persistent failure surfaces error to flush() instead of silently passing', async () => {
  const adapter = new MockAdapter();
  // Force every attempt (including all retries) to fail.
  adapter.failPostMessageCount = 999;
  const vm = new VirtualMessage(adapter, 'C123');
  vm.append('this should fail loudly, not silently');

  // flush() must reject so callers know the message did not reach Slack.
  await assert.rejects(
    () => vm.flush(),
    /post|message|fail/i,
    'flush() must reject when a message permanently fails to send'
  );
});

test('VirtualMessage.postStandalone: persistent failure rejects the returned promise', async () => {
  const adapter = new MockAdapter();
  adapter.failPostMessageCount = 999;
  const vm = new VirtualMessage(adapter, 'C123');

  await assert.rejects(
    () => vm.postStandalone('critical message'),
    /post|standalone|fail/i,
    'postStandalone must reject on persistent failure, not resolve null'
  );
});

// --- DurableHooks integration ---

test('VirtualMessage: durable hooks called on post and update', async () => {
  const adapter = new MockAdapter();
  const walOps: { op: string; channel?: string; text?: string; walId?: string; messageId?: string }[] = [];
  let walCounter = 0;
  const durable = {
    async beforePost(channel: string, text: string) {
      const id = `wal-${++walCounter}`;
      walOps.push({ op: 'beforePost', channel, text, walId: id });
      return id;
    },
    async beforeUpdate(channel: string, messageId: string, text: string) {
      const id = `wal-${++walCounter}`;
      walOps.push({ op: 'beforeUpdate', channel, messageId, text, walId: id });
      return id;
    },
    async afterSent(walId: string, slackTs?: string) {
      walOps.push({ op: 'afterSent', walId, messageId: slackTs });
    },
  };

  const vm = new VirtualMessage(adapter, 'C-durable', { durable });
  vm.append('first');
  vm.append('second');
  await flush(vm);

  // first → beforePost → adapter.postMessage → afterSent
  // second → beforeUpdate → adapter.updateMessage → afterSent
  assert.equal(walOps.length, 4);
  assert.equal(walOps[0].op, 'beforePost');
  assert.equal(walOps[0].text, 'first');
  assert.equal(walOps[1].op, 'afterSent');
  assert.equal(walOps[1].walId, 'wal-1');
  assert.equal(walOps[2].op, 'beforeUpdate');
  assert.ok(walOps[2].text!.includes('first'));
  assert.ok(walOps[2].text!.includes('second'));
  assert.equal(walOps[3].op, 'afterSent');
  assert.equal(walOps[3].walId, 'wal-2');
});

test('VirtualMessage: durable hooks called on postStandalone', async () => {
  const adapter = new MockAdapter();
  const walOps: string[] = [];
  const durable = {
    async beforePost() { walOps.push('beforePost'); return 'w1'; },
    async beforeUpdate() { walOps.push('beforeUpdate'); return 'w2'; },
    async afterSent() { walOps.push('afterSent'); },
  };

  const vm = new VirtualMessage(adapter, 'C-standalone', { durable });
  await vm.postStandalone('standalone text');
  await flush(vm);

  assert.deepEqual(walOps, ['beforePost', 'afterSent']);
});

test('VirtualMessage: no durable hooks — works without hooks (backward compat)', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C-nodurable');
  vm.append('hello');
  await flush(vm);

  assert.equal(adapter.posted.length, 1);
  assert.equal(adapter.posted[0].content.text, 'hello');
});

/**
 * Helper: reconstruct what Slack would actually display by applying all updates
 * (last update per messageId wins) to the posted content.
 */
function reconstructVisibleText(adapter: MockAdapter): string {
  const lastByRef = new Map<string, string>();
  for (const p of adapter.posted) {
    lastByRef.set(`${p.channel}:${(p as any).messageId ?? ''}`, p.content.text || '');
  }
  // Posted captures the initial text; updates overwrite. Track by index since
  // MockAdapter doesn't store messageId on PostedMessage — use posted order.
  const texts: string[] = adapter.posted.map(p => p.content.text || '');
  for (const u of adapter.updated) {
    // updated.ref.messageId starts at '1000' and increments per post.
    const idx = parseInt(u.ref.messageId, 10) - 1000;
    if (idx >= 0 && idx < texts.length) {
      texts[idx] = u.content.text || '';
    }
  }
  return texts.join('\n---\n');
}
