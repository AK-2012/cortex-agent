// input:  src/tui/hooks/useTranscript.js (pure state helpers)
// output: Regression: streamed reply must not be dropped on an empty transcript
// pos:    Verifies orphan stream frames create a synthetic message instead of vanishing

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _handleStreamText, _handleStreamMutableOpen,
} from '../../src/tui/hooks/useTranscript.js';

const EMPTY = { messages: new Map(), ids: [] as string[] };

test('stream.text on empty transcript creates a synthetic message keyed by streamId', () => {
  const s = _handleStreamText(EMPTY, { type: 'stream.text' as const, streamId: 's1', text: 'hi', seq: 1 });
  assert.equal(s.ids.length, 1, 'a message must exist to hold the stream');
  const msg = s.messages.get(s.ids[0]);
  assert.ok(msg);
  assert.equal(msg.streams.get('s1')?.segments.join(''), 'hi');
});

test('stream.mutableOpen on empty transcript creates a synthetic message', () => {
  const s = _handleStreamMutableOpen(EMPTY, {
    type: 'stream.mutableOpen' as const, streamId: 's1', regionId: 'r1', text: 'pending', seq: 1,
  });
  assert.equal(s.ids.length, 1);
  const msg = s.messages.get(s.ids[0]);
  assert.ok(msg);
  assert.equal(msg.streams.get('s1')?.mutable.get('r1'), 'pending');
});
