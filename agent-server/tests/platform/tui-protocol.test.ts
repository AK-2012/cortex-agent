// input:  src/platform/tui/protocol.js
// output: Round-trip + negative + guard + inventory tests for M4 TUI wire protocol
// pos:    Verifies every variant round-trips, guards narrow, inventory is complete

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION,
  encodeFrame, parseFrame,
  HANDSHAKE_HELLO, HANDSHAKE_ACK, SESSION_SWITCH, SESSION_SWITCHED,
  PING, PONG, CLOSE,
  CHAT_POST, CHAT_UPDATE, CHAT_DELETE, CHAT_MARK_QUEUED,
  MSG_USER, MSG_EDIT,
  STREAM_TEXT, STREAM_MUTABLE_OPEN, STREAM_MUTABLE_UPDATE, STREAM_FLUSH,
  INTERACTIVE_POST, MODAL_OPEN, MODAL_ACK, ACTION_CLICK, MODAL_SUBMIT,
  TRANSCRIPT_REPLAY, NOTIFICATION,
  UI_QUERY, UI_QUERY_RESULT, UI_MUTATE, UI_MUTATE_RESULT,
  UI_SUBSCRIBE, UI_EVENT, UI_UNSUBSCRIBE,
  ERROR,
  ALL_FRAME_TYPES, GUARD_BY_TYPE,
  isHandshakeHello, isHandshakeAck, isSessionSwitch, isSessionSwitched,
  isPing, isPong, isClose,
  isChatPost, isChatUpdate, isChatDelete, isChatMarkQueued,
  isMsgUser, isMsgEdit,
  isStreamText, isStreamMutableOpen, isStreamMutableUpdate, isStreamFlush,
  isInteractivePost, isModalOpen, isModalAck, isActionClick, isModalSubmit,
  isTranscriptReplay, isNotification,
  isUiQuery, isUiQueryResult, isUiMutate, isUiMutateResult,
  isUiSubscribe, isUiEvent, isUiUnsubscribe,
  isErrorFrame,
} from '../../src/platform/tui/protocol.js';
import type {
  TuiFrame,
  HandshakeHello, HandshakeAck, SessionSwitch, SessionSwitched,
  Ping, Pong, Close,
  ChatPost, ChatUpdate, ChatDelete, ChatMarkQueued,
  MsgUser, MsgEdit,
  StreamText, StreamMutableOpen, StreamMutableUpdate, StreamFlush,
  InteractivePost, ModalOpen, ModalAck, ActionClick, ModalSubmit,
  TranscriptReplay, Notification,
  UiQuery, UiQueryResult, UiMutate, UiMutateResult,
  UiSubscribe, UiEvent, UiUnsubscribe,
  ErrorFrame,
} from '../../src/platform/tui/protocol.js';

// ── Representative frames (one per variant, all fields populated) ──

const REPRESENTATIVE_FRAMES: TuiFrame[] = [
  // Lifecycle
  { type: HANDSHAKE_HELLO, protocolVersion: PROTOCOL_VERSION, clientInfo: 'test-client' } satisfies HandshakeHello,
  { type: HANDSHAKE_ACK, protocolVersion: PROTOCOL_VERSION, serverInfo: 'test-server' } satisfies HandshakeAck,
  { type: SESSION_SWITCH, sessionId: 'sess-001', projectId: 'proj-a' } satisfies SessionSwitch,
  { type: SESSION_SWITCHED, sessionId: 'sess-001', ok: true } satisfies SessionSwitched,
  { type: PING, timestamp: 1234567890 } satisfies Ping,
  { type: PONG, timestamp: 1234567890 } satisfies Pong,
  { type: CLOSE, reason: 'shutdown' } satisfies Close,

  // Chat outbound
  { type: CHAT_POST, conduit: 'C123', content: { text: 'hello', richBlocks: [{ type: 'markdown', text: '**bold**' }] }, messageId: 'm1', threadId: 't1' } satisfies ChatPost,
  { type: CHAT_UPDATE, conduit: 'C123', messageId: 'm1', content: { text: 'updated' } } satisfies ChatUpdate,
  { type: CHAT_DELETE, conduit: 'C123', messageId: 'm1' } satisfies ChatDelete,
  { type: CHAT_MARK_QUEUED, conduit: 'C123', messageId: 'm1' } satisfies ChatMarkQueued,

  // Chat inbound
  { type: MSG_USER, conduit: 'C123', text: 'hello', senderId: 'u1', isBot: false, messageId: 'm1', threadId: 't1' } satisfies MsgUser,
  { type: MSG_EDIT, conduit: 'C123', messageId: 'm1', newText: 'edited' } satisfies MsgEdit,

  // Streaming
  { type: STREAM_TEXT, conduit: 'C123', text: 'part1', streamId: 's1' } satisfies StreamText,
  { type: STREAM_MUTABLE_OPEN, conduit: 'C123', text: 'initial', streamId: 's1', mutableId: 'm1' } satisfies StreamMutableOpen,
  { type: STREAM_MUTABLE_UPDATE, conduit: 'C123', text: 'update', streamId: 's1', mutableId: 'm1' } satisfies StreamMutableUpdate,
  { type: STREAM_FLUSH, conduit: 'C123', streamId: 's1' } satisfies StreamFlush,

  // Interactive
  { type: INTERACTIVE_POST, conduit: 'C123', text: 'choose:', actions: [{ type: 'button', text: 'Go', actionId: 'go', value: '1' }], richBlocks: [{ type: 'divider' }] } satisfies InteractivePost,
  { type: MODAL_OPEN, triggerId: 'trig-1', modal: { callbackId: 'cb1', title: 'Form', fields: [{ type: 'text_input', blockId: 'b1', label: 'Name', actionId: 'a1' }] } } satisfies ModalOpen,
  { type: MODAL_ACK, ok: true } satisfies ModalAck,
  { type: ACTION_CLICK, actionId: 'btn_go', value: '1', triggerId: 'trig-1', conduit: 'C123', messageId: 'm1' } satisfies ActionClick,
  { type: MODAL_SUBMIT, callbackId: 'cb1', values: { q_0: { selection: { selectedOption: { value: '0' } } } }, privateMetadata: '{}' } satisfies ModalSubmit,

  // Other
  { type: TRANSCRIPT_REPLAY, conduit: 'C123', messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], streamId: 's1' } satisfies TranscriptReplay,
  { type: NOTIFICATION, level: 'info', message: 'task complete', title: 'Done' } satisfies Notification,

  // UI side-channel
  { type: UI_QUERY, queryId: 'q1', selector: '#root' } satisfies UiQuery,
  { type: UI_QUERY_RESULT, queryId: 'q1', data: { width: 800 } } satisfies UiQueryResult,
  { type: UI_MUTATE, mutationId: 'm1', action: 'setTheme', payload: { theme: 'dark' } } satisfies UiMutate,
  { type: UI_MUTATE_RESULT, mutationId: 'm1', ok: true } satisfies UiMutateResult,
  { type: UI_SUBSCRIBE, event: 'resize', subId: 'sub1' } satisfies UiSubscribe,
  { type: UI_EVENT, event: 'resize', subId: 'sub1', data: { width: 1024 } } satisfies UiEvent,
  { type: UI_UNSUBSCRIBE, subId: 'sub1' } satisfies UiUnsubscribe,

  // Error
  { type: ERROR, code: 400, message: 'bad request', originalType: CHAT_POST } satisfies ErrorFrame,
];

// ── Group 1: Round-trip per frame type ──

for (const frame of REPRESENTATIVE_FRAMES) {
  test(`round-trip: ${frame.type}`, () => {
    const encoded = encodeFrame(frame);
    const decoded = parseFrame(encoded);
    assert.ok(decoded !== null, `parseFrame returned null for ${frame.type}`);
    assert.deepEqual(decoded, frame);
  });
}

// ── Group 2: Negative tests ──

test('parseFrame returns null for empty string', () => {
  assert.equal(parseFrame(''), null);
});

test('parseFrame returns null for malformed JSON', () => {
  assert.equal(parseFrame('{not json}'), null);
});

test('parseFrame returns null for non-object JSON', () => {
  assert.equal(parseFrame('null'), null);
  assert.equal(parseFrame('"string"'), null);
  assert.equal(parseFrame('42'), null);
});

test('parseFrame returns null when type field is missing', () => {
  assert.equal(parseFrame('{}'), null);
  assert.equal(parseFrame('{"protocolVersion":1}'), null);
});

test('parseFrame returns null when type is not a string', () => {
  assert.equal(parseFrame('{"type":123}'), null);
  assert.equal(parseFrame('{"type":null}'), null);
});

test('parseFrame returns null for unknown discriminator', () => {
  assert.equal(parseFrame('{"type":"unknown.type"}'), null);
  assert.equal(parseFrame('{"type":"handshake.unknown"}'), null);
});

test('parseFrame returns null when required field is missing', () => {
  // ChatPost requires 'conduit' and 'content'
  assert.equal(parseFrame('{"type":"chat.post"}'), null);
  assert.equal(parseFrame('{"type":"chat.post","conduit":"C123"}'), null);
  // ModalOpen requires 'triggerId' and 'modal'
  assert.equal(parseFrame('{"type":"modal.open"}'), null);
  // HandshakeHello requires 'protocolVersion'
  assert.equal(parseFrame('{"type":"handshake.hello"}'), null);
  // Error requires 'code' and 'message'
  assert.equal(parseFrame('{"type":"error"}'), null);
});

// ── Group 3: Modal submit values round-trip ──

test('modal.submit values round-trip matches ModalSubmitContext.values shape', () => {
  const frame: ModalSubmit = {
    type: MODAL_SUBMIT,
    callbackId: 'ask_user_question_modal_submit',
    values: {
      q_0: {
        selection: { selectedOption: { value: '0' } },
      },
      b_text: {
        input: { value: 'some text' },
      },
      b_multi: {
        picks: { selectedOptions: [{ value: 'a' }, { value: 'b' }] },
      },
    },
    privateMetadata: JSON.stringify({ groupId: 'grp-1' }),
  };

  const encoded = encodeFrame(frame);
  const decoded = parseFrame(encoded);
  assert.ok(decoded !== null, 'parseFrame returned null for modal.submit');
  assert.equal(decoded.type, MODAL_SUBMIT);

  // Verify nested values shape matches ModalSubmitContext.values
  const submit = decoded as ModalSubmit;
  assert.equal(submit.callbackId, 'ask_user_question_modal_submit');
  assert.equal(submit.values.q_0.selection.selectedOption?.value, '0');
  assert.equal(submit.values.b_text.input.value, 'some text');
  assert.equal(submit.values.b_multi.picks.selectedOptions?.[0]?.value, 'a');
  assert.equal(submit.values.b_multi.picks.selectedOptions?.[1]?.value, 'b');
  assert.equal(submit.privateMetadata, JSON.stringify({ groupId: 'grp-1' }));
});

// ── Group 4: Guard discrimination ──

test('guards narrow correctly under strict type checking', () => {
  // Each guard must return true only for its own variant type
  for (const frame of REPRESENTATIVE_FRAMES) {
    const frameType = frame.type;
    for (const typeStr of ALL_FRAME_TYPES) {
      const guard = GUARD_BY_TYPE[typeStr];
      assert.ok(typeof guard === 'function', `guard for ${typeStr} is not a function`);
      const result = guard(frame);
      if (typeStr === frameType) {
        assert.ok(result, `guard for ${typeStr} should return true for ${frameType}`);
      } else {
        assert.ok(!result, `guard for ${typeStr} should return false for ${frameType}`);
      }
    }
  }
});

// Specific narrowing checks that TypeScript can infer (ensures discrim union works)
test('specific guard narrowing (type narrowing safety)', () => {
  const f: TuiFrame = { type: HANDSHAKE_HELLO, protocolVersion: 1 };

  assert.ok(isHandshakeHello(f));
  assert.ok(!isChatPost(f));
  assert.ok(!isErrorFrame(f));
  assert.ok(!isNotification(f));
  assert.ok(!isModalOpen(f));

  // Narrowed usage: after guard, TS knows the concrete type
  if (isHandshakeHello(f)) {
    assert.equal(f.protocolVersion, 1); // Would fail compile if narrowing didn't work
  } else {
    assert.fail('should have narrowed to HandshakeHello');
  }
});

// ── Group 5: Frame inventory test ──

test('every type string in ALL_FRAME_TYPES has a guard in GUARD_BY_TYPE', () => {
  for (const typeStr of ALL_FRAME_TYPES) {
    const guard = GUARD_BY_TYPE[typeStr];
    assert.ok(
      typeof guard === 'function',
      `missing guard function for type: ${typeStr} — ` +
      'if you added a variant to TuiFrame, add its guard to GUARD_BY_TYPE',
    );
  }
});

test('GUARD_BY_TYPE has no extra entries beyond ALL_FRAME_TYPES', () => {
  const guardCount = Object.keys(GUARD_BY_TYPE).length;
  assert.equal(guardCount, ALL_FRAME_TYPES.length,
    `GUARD_BY_TYPE has ${guardCount} entries but ALL_FRAME_TYPES has ${ALL_FRAME_TYPES.length}`);
});

// ── Protocol version ──

test('PROTOCOL_VERSION is 1', () => {
  assert.equal(PROTOCOL_VERSION, 1);
});
