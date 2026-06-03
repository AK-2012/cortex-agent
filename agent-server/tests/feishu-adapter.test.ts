// input:  node:test, FeishuAdapter
// output: Unit tests for FeishuAdapter pure logic (form value normalization,
//         inbound file extraction, project-report routing, thread reply conduit)
// pos:    Regression tests for the 6 Feishu adapter bug fixes
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuAdapter } from '../src/platform/adapters/feishu.js';
import type { Destination } from '../src/platform/types.js';

function makeAdapter(): any {
  // Constructor only instantiates SDK clients; no network until start().
  return new FeishuAdapter({ appId: 'cli_test', appSecret: 'secret' }) as any;
}

// =========================================================================
// #6 — normalizeFormValues: type segment drives selectedOption vs value
// =========================================================================

test('Feishu normalizeFormValues: single-select → selectedOption', () => {
  const a = makeAdapter();
  const out = a.normalizeFormValues({ 'b1::a1::select': 'v2' });
  assert.deepEqual(out, { b1: { a1: { selectedOption: { value: 'v2' } } } });
});

test('Feishu normalizeFormValues: multi-select → selectedOptions', () => {
  const a = makeAdapter();
  const out = a.normalizeFormValues({ 'b1::a1::multi': ['x', 'y'] });
  assert.deepEqual(out, { b1: { a1: { selectedOptions: [{ value: 'x' }, { value: 'y' }] } } });
});

test('Feishu normalizeFormValues: text input → value', () => {
  const a = makeAdapter();
  const out = a.normalizeFormValues({ 'b1::a1::text': 'hello world' });
  assert.deepEqual(out, { b1: { a1: { value: 'hello world' } } });
});

test('Feishu normalizeFormValues: multi kind with scalar value still wraps as array', () => {
  const a = makeAdapter();
  const out = a.normalizeFormValues({ 'b1::a1::multi': 'solo' });
  assert.deepEqual(out, { b1: { a1: { selectedOptions: [{ value: 'solo' }] } } });
});

// =========================================================================
// #3 — extractInboundFiles: read resource key from parsed content
// =========================================================================

test('Feishu extractInboundFiles: image message', () => {
  const a = makeAdapter();
  const files = a.extractInboundFiles('image', { image_key: 'img_1' }, 'om_123');
  assert.equal(files.length, 1);
  assert.equal(files[0].id, 'img_1');
  assert.equal(files[0].mimetype, 'image/png');
  assert.deepEqual(files[0].raw, { message_id: 'om_123', resourceType: 'image' });
});

test('Feishu extractInboundFiles: file message carries name + file resourceType', () => {
  const a = makeAdapter();
  const files = a.extractInboundFiles('file', { file_key: 'file_1', file_name: 'report.pdf' }, 'om_9');
  assert.equal(files[0].id, 'file_1');
  assert.equal(files[0].name, 'report.pdf');
  assert.deepEqual(files[0].raw, { message_id: 'om_9', resourceType: 'file' });
});

test('Feishu extractInboundFiles: text message has no files', () => {
  const a = makeAdapter();
  assert.equal(a.extractInboundFiles('text', { text: 'hi' }, 'om_1'), undefined);
});

// =========================================================================
// #1/#2 — project-report routing resolves through the conduit store
// =========================================================================

test('Feishu resolveDestination: project-report uses bound conduit', async () => {
  const a = makeAdapter();
  a._conduitsStore = { getAll: async () => ({ proj1: 'oc_bound' }) };
  const dest: Destination = { type: 'project-report', projectId: 'proj1', trigger: 't' };
  const r = await a.resolveDestination(dest);
  assert.deepEqual(r, { channel: 'oc_bound', kind: 'project-report' });
});

test('Feishu resolveDestination: unbound project-report is dropped (channel=null)', async () => {
  const a = makeAdapter();
  a._conduitsStore = { getAll: async () => ({}) };
  const dest: Destination = { type: 'project-report', projectId: 'missing', trigger: 't' };
  const r = await a.resolveDestination(dest);
  assert.equal(r.channel, null);
  assert.equal(r.kind, 'project-report-noop');
});

// =========================================================================
// #6b — form submit routes to the handler registered under callbackId
// (submit button name === callbackId; action.name carries the button name)
// =========================================================================

test('Feishu handleCardAction: form submit reaches the modal handler with normalized values', async () => {
  const a = makeAdapter();
  const callbackId = 'ask_user_question_modal_submit';
  let received: any = null;
  a.onModalSubmit(callbackId, async (ctx: any) => { received = ctx; await ctx.ack(); });

  // Simulate the card.action.trigger event Feishu sends on form submit:
  // action.name is the submit button's name (which we set to callbackId).
  const ret = await a.handleCardAction({
    event: {
      operator: { open_id: 'ou_user' },
      context: { open_chat_id: 'oc_1', open_message_id: 'om_1' },
      action: {
        tag: 'button',
        name: callbackId,
        value: { groupId: 'g1' },
        form_value: { 'b1::a1::select': 'v2', 'b2::a2::text': 'hi' },
      },
    },
  });

  assert.ok(received, 'modal handler should have been invoked');
  assert.equal(received.callbackId, callbackId);
  assert.deepEqual(received.values.b1.a1, { selectedOption: { value: 'v2' } });
  assert.deepEqual(received.values.b2.a2, { value: 'hi' });
  assert.deepEqual(ret, { toast: { type: 'success', content: 'OK' } });
});

// =========================================================================
// #5 — replyInThread returns a non-empty conduit
// =========================================================================

test('Feishu postMessage in thread returns resolved conduit', async () => {
  const a = makeAdapter();
  a.client = {
    im: { v1: { message: { reply: async () => ({ data: { message_id: 'om_reply' } }) } } },
  };
  const dest: Destination = { type: 'interactive-reply', conduit: 'oc_chat', sessionId: '' };
  const ref = await a.postMessage(dest, { text: 'hi' }, { threadId: 'om_root' });
  assert.equal(ref.conduit, 'oc_chat');
  assert.equal(ref.messageId, 'om_reply');
  assert.equal(ref.threadId, 'om_root');
});
