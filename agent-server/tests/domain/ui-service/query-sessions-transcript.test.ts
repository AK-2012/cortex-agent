import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSessionsTranscript } from '../../../src/domain/ui-service/query/sessions.js';
import type { UiServiceDeps } from '../../../src/domain/ui-service/types.js';
import type { SessionHistory } from '../../../src/store/conversation-history-repo.js';

function makeDeps(history: SessionHistory | null): UiServiceDeps {
  return {
    conversationHistory: { getHistory: async () => history },
  } as unknown as UiServiceDeps;
}

test('sessions.transcript groups user/assistant/tool events by turn', async () => {
  const history: SessionHistory = {
    sessionId: 'sess-1',
    events: [
      { type: 'user', text: 'hi', ts: '2026-07-07T00:00:00.000Z', turnIndex: 0 },
      { type: 'assistant', text: 'hello', ts: '2026-07-07T00:00:01.000Z', turnIndex: 0 },
      { type: 'tool', toolName: 'Read', toolInput: 'x.ts', ts: '2026-07-07T00:00:02.000Z', turnIndex: 0 },
      { type: 'user', text: 'again', ts: '2026-07-07T00:00:03.000Z', turnIndex: 1 },
      { type: 'assistant', text: 'sure', ts: '2026-07-07T00:00:04.000Z', turnIndex: 1 },
    ],
  };
  const out = await handleSessionsTranscript(makeDeps(history), { sessionId: 'sess-1' });

  assert.equal(out.sessionId, 'sess-1');
  assert.equal(out.turns.length, 2);

  assert.equal(out.turns[0].turnIndex, 0);
  assert.equal(out.turns[0].messages.length, 3);
  assert.deepEqual(out.turns[0].messages[0], {
    type: 'user', text: 'hi', toolName: null, toolInput: null, ts: '2026-07-07T00:00:00.000Z', elapsedMs: null,
  });
  assert.deepEqual(out.turns[0].messages[2], {
    type: 'tool', text: null, toolName: 'Read', toolInput: 'x.ts', ts: '2026-07-07T00:00:02.000Z', elapsedMs: 1000,
  });

  assert.equal(out.turns[1].turnIndex, 1);
  assert.equal(out.turns[1].messages.length, 2);
});

test('sessions.transcript derives per-message elapsedMs from ts deltas (chronological, first=null)', async () => {
  const history: SessionHistory = {
    sessionId: 'sess-2',
    events: [
      { type: 'user', text: 'hi', ts: '2026-07-07T00:00:00.000Z', turnIndex: 0 },
      { type: 'assistant', text: 'thinking', ts: '2026-07-07T00:00:02.500Z', turnIndex: 0 },
      { type: 'user', text: 'again', ts: '2026-07-07T00:00:10.000Z', turnIndex: 1 },
      { type: 'assistant', text: 'done', ts: '2026-07-07T00:00:11.000Z', turnIndex: 1 },
    ],
  };
  const out = await handleSessionsTranscript(makeDeps(history), { sessionId: 'sess-2' });

  // First message overall has no predecessor.
  assert.equal(out.turns[0].messages[0].elapsedMs, null);
  // Delta from the previous message in the flat chronological stream.
  assert.equal(out.turns[0].messages[1].elapsedMs, 2500);
  // Elapsed spans turn boundaries (previous = last assistant of turn 0).
  assert.equal(out.turns[1].messages[0].elapsedMs, 7500);
  assert.equal(out.turns[1].messages[1].elapsedMs, 1000);
});

test('sessions.transcript elapsedMs is null when a ts is unparseable', async () => {
  const history: SessionHistory = {
    sessionId: 'sess-3',
    events: [
      { type: 'user', text: 'hi', ts: 'not-a-date', turnIndex: 0 },
      { type: 'assistant', text: 'ok', ts: '2026-07-07T00:00:01.000Z', turnIndex: 0 },
    ],
  };
  const out = await handleSessionsTranscript(makeDeps(history), { sessionId: 'sess-3' });
  assert.equal(out.turns[0].messages[0].elapsedMs, null);
  // Previous ts is unparseable → cannot derive a delta.
  assert.equal(out.turns[0].messages[1].elapsedMs, null);
});

test('sessions.transcript returns empty turns for an absent history', async () => {
  const out = await handleSessionsTranscript(makeDeps(null), { sessionId: 'nope' });
  assert.deepEqual(out, { sessionId: 'nope', turns: [] });
});
