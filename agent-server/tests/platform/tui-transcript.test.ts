// input:  buildTranscriptReplay (pure formatter) + ports types
// output: unit tests — transcript replay as a pure function
// pos:    verifies TranscriptData → TranscriptReplay | null transformation

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscriptReplay } from '../../src/platform/adapters/tui/tui-transcript.js';
import type { TranscriptData, TranscriptTurn } from '../../src/platform/adapters/tui/ports.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTurn(overrides: Partial<TranscriptTurn> & { userMessageTs: string }): TranscriptTurn {
  return {
    userMessageText: 'hello',
    responseMessageTimestamps: [],
    status: 'completed',
    ...overrides,
  };
}

function makeData(overrides: Partial<TranscriptData> = {}): TranscriptData {
  return {
    sessionId: 'test-session-1',
    channel: 'tui-test-conduit',
    turns: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

test('buildTranscriptReplay — maps a 2-turn TranscriptData into correct ChatPost items', () => {
  const turns: TranscriptTurn[] = [
    {
      userMessageTs: 'ts-1',
      userMessageText: 'First user message',
      responseMessageTimestamps: ['ts-1a', 'ts-1b'],
      status: 'completed',
    },
    {
      userMessageTs: 'ts-2',
      userMessageText: 'Second user message',
      responseMessageTimestamps: ['ts-2a'],
      status: 'completed',
    },
  ];

  const data = makeData({ turns });
  const result = buildTranscriptReplay(data);

  assert.ok(result !== null, 'should return a TranscriptReplay');

  // Frame type
  assert.equal(result.type, 'transcript.replay');
  assert.equal(result.sessionId, 'test-session-1');
  assert.equal(result.isCatchUp, true);

  // Seq range
  assert.equal(result.seqStart, 1);
  // Turn1: user(1) + 2 responses(2,3) = 3 items, Turn2: user(4) + 1 response(5) = 2 items → seqEnd=5
  assert.equal(result.seqEnd, 5);

  // Item count
  assert.equal(result.items.length, 5);

  // Item 1: user message from turn 1
  assert.equal(result.items[0].type, 'chat.post');
  assert.equal(result.items[0].ref.conduit, 'tui-test-conduit');
  assert.equal(result.items[0].ref.messageId, 'ts-1');
  assert.equal(result.items[0].content.text, '**You:** First user message');
  assert.equal(result.items[0].seq, 1);

  // Item 2: first response from turn 1
  assert.equal(result.items[1].type, 'chat.post');
  assert.equal(result.items[1].ref.conduit, 'tui-test-conduit');
  assert.equal(result.items[1].ref.messageId, 'ts-1a');
  assert.equal(result.items[1].content.text, '*(response)*');
  assert.equal(result.items[1].seq, 2);

  // Item 3: second response from turn 1
  assert.equal(result.items[2].type, 'chat.post');
  assert.equal(result.items[2].ref.conduit, 'tui-test-conduit');
  assert.equal(result.items[2].ref.messageId, 'ts-1b');
  assert.equal(result.items[2].content.text, '*(response)*');
  assert.equal(result.items[2].seq, 3);

  // Item 4: user message from turn 2
  assert.equal(result.items[3].type, 'chat.post');
  assert.equal(result.items[3].ref.conduit, 'tui-test-conduit');
  assert.equal(result.items[3].ref.messageId, 'ts-2');
  assert.equal(result.items[3].content.text, '**You:** Second user message');
  assert.equal(result.items[3].seq, 4);

  // Item 5: response from turn 2
  assert.equal(result.items[4].type, 'chat.post');
  assert.equal(result.items[4].ref.conduit, 'tui-test-conduit');
  assert.equal(result.items[4].ref.messageId, 'ts-2a');
  assert.equal(result.items[4].content.text, '*(response)*');
  assert.equal(result.items[4].seq, 5);
});

test('buildTranscriptReplay — skips turns with status:processing', () => {
  const turns: TranscriptTurn[] = [
    makeTurn({ userMessageTs: 'ts-1', userMessageText: 'first', status: 'completed' }),
    makeTurn({ userMessageTs: 'ts-2', userMessageText: 'processing turn', status: 'processing', responseMessageTimestamps: ['ts-2a'] }),
    makeTurn({ userMessageTs: 'ts-3', userMessageText: 'third', status: 'superseded', responseMessageTimestamps: ['ts-3a'] }),
  ];

  const data = makeData({ turns });
  const result = buildTranscriptReplay(data);

  assert.ok(result !== null);

  // Turn 1 (completed) → user(1) = seq 1
  // Turn 2 (processing) → skipped entirely
  // Turn 3 (superseded) → user(2) + response(3) = seq 2-3
  assert.equal(result.seqStart, 1);
  assert.equal(result.seqEnd, 3);
  assert.equal(result.items.length, 3);

  // First item is from turn 1
  assert.equal(result.items[0].ref.messageId, 'ts-1');
  assert.equal(result.items[0].seq, 1);
  assert.equal(result.items[0].content.text, '**You:** first');

  // Second item is user message from turn 3
  assert.equal(result.items[1].ref.messageId, 'ts-3');
  assert.equal(result.items[1].seq, 2);
  assert.equal(result.items[1].content.text, '**You:** third');

  // Third item is response from turn 3
  assert.equal(result.items[2].ref.messageId, 'ts-3a');
  assert.equal(result.items[2].seq, 3);
  assert.equal(result.items[2].content.text, '*(response)*');
});

test('buildTranscriptReplay — returns null when turns is empty', () => {
  const data = makeData({ turns: [] });
  const result = buildTranscriptReplay(data);
  assert.equal(result, null);
});

test('buildTranscriptReplay — returns null when all turns are processing', () => {
  const turns: TranscriptTurn[] = [
    makeTurn({ userMessageTs: 'ts-1', userMessageText: 'skip me', status: 'processing' }),
    makeTurn({ userMessageTs: 'ts-2', userMessageText: 'skip me too', status: 'processing' }),
  ];

  const data = makeData({ turns });
  const result = buildTranscriptReplay(data);
  assert.equal(result, null);
});
