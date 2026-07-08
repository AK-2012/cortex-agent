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
    type: 'user', text: 'hi', toolName: null, toolInput: null, ts: '2026-07-07T00:00:00.000Z',
  });
  assert.deepEqual(out.turns[0].messages[2], {
    type: 'tool', text: null, toolName: 'Read', toolInput: 'x.ts', ts: '2026-07-07T00:00:02.000Z',
  });

  assert.equal(out.turns[1].turnIndex, 1);
  assert.equal(out.turns[1].messages.length, 2);
});

test('sessions.transcript returns empty turns for an absent history', async () => {
  const out = await handleSessionsTranscript(makeDeps(null), { sessionId: 'nope' });
  assert.deepEqual(out, { sessionId: 'nope', turns: [] });
});
