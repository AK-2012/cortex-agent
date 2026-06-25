// input:  src/tui/logic.js (pure helpers)
// output: Unit tests for TUI pure logic — focus zone, response-frame detection,
//         stream text collection, visible-window computation
// pos:    Guards the behavioral fixes for input/focus/scroll defects

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFocusZone,
  isAgentResponseFrame,
  collectStreamText,
  computeVisibleWindow,
  computeFocusWindow,
  estimateLines,
  computeLineWindow,
  historyPrev,
  historyNext,
  pushHistory,
  matchResumeTarget,
  isMouseSequence,
  parseWheelEvents,
  wrapToWidth,
  flattenMessageLines,
  flattenTranscript,
} from '../../src/tui/logic.js';

// ── estimateLines ──

test('estimateLines: wraps by width and counts newlines', () => {
  assert.equal(estimateLines('', 80), 0);
  assert.equal(estimateLines('short', 80), 1);
  assert.equal(estimateLines('a'.repeat(81), 80), 2);
  assert.equal(estimateLines('line1\nline2', 80), 2);
  assert.equal(estimateLines('a'.repeat(160) + '\nx', 80), 3);
});

// ── computeLineWindow ──

test('computeLineWindow: fits as many bottom rows as the budget allows', () => {
  // five rows, 2 lines each = 10 lines; budget 5 → last 2 rows (4 lines), 3rd would overflow
  const counts = [2, 2, 2, 2, 2];
  const w = computeLineWindow(counts, 5, 0);
  assert.equal(w.end, 5);
  assert.equal(w.start, 3); // rows 3,4 fit (4 lines); row 2 would make 6 > 5
});

test('computeLineWindow: always includes at least the last row even if taller than budget', () => {
  const w = computeLineWindow([3, 20], 5, 0);
  assert.deepEqual(w, { start: 1, end: 2 });
});

test('computeLineWindow: scrollOffset hides rows from the bottom', () => {
  const counts = [1, 1, 1, 1, 1];
  const w = computeLineWindow(counts, 2, 2); // offset 2 → end=3
  assert.equal(w.end, 3);
  assert.equal(w.start, 1);
});

test('computeLineWindow: empty list', () => {
  assert.deepEqual(computeLineWindow([], 10, 0), { start: 0, end: 0 });
});

// ── computeFocusWindow ──

test('computeFocusWindow: short list renders fully, nothing hidden', () => {
  const w = computeFocusWindow(3, 0, 8);
  assert.deepEqual(w, { start: 0, end: 3, hiddenAbove: 0, hiddenBelow: 0 });
});

test('computeFocusWindow: empty list is a no-op', () => {
  assert.deepEqual(computeFocusWindow(0, 0, 8), { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 });
});

test('computeFocusWindow: long list caps the slice and reports hidden counts', () => {
  const w = computeFocusWindow(20, 0, 6);
  assert.equal(w.end - w.start, 6, 'window is capped at maxVisible');
  assert.equal(w.start, 0);
  assert.equal(w.hiddenAbove, 0);
  assert.equal(w.hiddenBelow, 14);
});

test('computeFocusWindow: focused row stays inside the window when scrolled down', () => {
  const w = computeFocusWindow(20, 15, 6);
  assert.ok(15 >= w.start && 15 < w.end, 'focused index is visible');
  assert.equal(w.end - w.start, 6);
});

test('computeFocusWindow: window clamps to the end (no overscroll past last row)', () => {
  const w = computeFocusWindow(20, 19, 6);
  assert.equal(w.end, 20);
  assert.equal(w.start, 14);
  assert.equal(w.hiddenBelow, 0);
  assert.equal(w.hiddenAbove, 14);
});

// ── computeFocusZone ──

test('computeFocusZone: modal wins over everything', () => {
  assert.equal(computeFocusZone({ modalOpen: true, sidePanelVisible: true }), 'modal');
  assert.equal(computeFocusZone({ modalOpen: true, sidePanelVisible: false }), 'modal');
});

test('computeFocusZone: dashboard when side panel visible and no modal', () => {
  assert.equal(computeFocusZone({ modalOpen: false, sidePanelVisible: true }), 'dashboard');
});

test('computeFocusZone: input by default', () => {
  assert.equal(computeFocusZone({ modalOpen: false, sidePanelVisible: false }), 'input');
});

// ── isAgentResponseFrame ──

test('isAgentResponseFrame: true for agent reply / stream frames', () => {
  for (const type of [
    'chat.post', 'chat.update', 'interactive.post',
    'stream.text', 'stream.mutableOpen', 'stream.mutableUpdate', 'transcript.replay',
  ]) {
    assert.equal(isAgentResponseFrame({ type } as any), true, `expected true for ${type}`);
  }
});

test('isAgentResponseFrame: false for non-response frames', () => {
  for (const type of [
    'notification', 'ui.event', 'ui.queryResult', 'chat.markQueued',
    'pong', 'session.switched', 'handshake.ack', 'msg.user', 'error',
  ]) {
    assert.equal(isAgentResponseFrame({ type } as any), false, `expected false for ${type}`);
  }
});

// ── collectStreamText ──

test('collectStreamText: concatenates segments and mutable regions in order', () => {
  const streams = new Map<string, { segments: string[]; mutable: Map<string, string> }>();
  streams.set('s1', { segments: ['Hello, ', 'world'], mutable: new Map([['r1', '!']]) });
  assert.equal(collectStreamText(streams), 'Hello, world!');
});

test('collectStreamText: empty streams → empty string', () => {
  assert.equal(collectStreamText(new Map()), '');
});

test('collectStreamText: multiple streams concatenated in insertion order', () => {
  const streams = new Map<string, { segments: string[]; mutable: Map<string, string> }>();
  streams.set('s1', { segments: ['a', 'b'], mutable: new Map() });
  streams.set('s2', { segments: ['c'], mutable: new Map() });
  assert.equal(collectStreamText(streams), 'abc');
});

// ── computeVisibleWindow ──

test('computeVisibleWindow: empty list', () => {
  assert.deepEqual(computeVisibleWindow(0, 10, 0), { start: 0, end: 0 });
});

test('computeVisibleWindow: list shorter than viewport shows all', () => {
  assert.deepEqual(computeVisibleWindow(5, 10, 0), { start: 0, end: 5 });
});

test('computeVisibleWindow: anchored to bottom when offset 0', () => {
  assert.deepEqual(computeVisibleWindow(5, 3, 0), { start: 2, end: 5 });
});

test('computeVisibleWindow: scroll up reveals earlier messages', () => {
  assert.deepEqual(computeVisibleWindow(5, 3, 2), { start: 0, end: 3 });
});

test('computeVisibleWindow: offset clamped so window never goes past top', () => {
  assert.deepEqual(computeVisibleWindow(5, 3, 99), { start: 0, end: 1 });
});

// ── input history navigation ──

test('historyPrev: empty history is a no-op', () => {
  const r = historyPrev([], { index: null, draft: '' }, 'typing');
  assert.deepEqual(r, { value: 'typing', state: { index: null, draft: '' } });
});

test('historyPrev: first Up shows newest entry and saves the live draft', () => {
  const r = historyPrev(['a', 'b', 'c'], { index: null, draft: '' }, 'half-typed');
  assert.equal(r.value, 'c');
  assert.deepEqual(r.state, { index: 2, draft: 'half-typed' });
});

test('historyPrev: successive Up steps to older entries and stops at the oldest', () => {
  const hist = ['a', 'b', 'c'];
  let s = historyPrev(hist, { index: null, draft: '' }, 'd');
  assert.equal(s.value, 'c');
  s = historyPrev(hist, s.state, s.value);
  assert.equal(s.value, 'b');
  s = historyPrev(hist, s.state, s.value);
  assert.equal(s.value, 'a');
  s = historyPrev(hist, s.state, s.value); // clamps at oldest
  assert.equal(s.value, 'a');
  assert.equal(s.state.index, 0);
  assert.equal(s.state.draft, 'd'); // draft preserved through navigation
});

test('historyNext: not navigating is a no-op', () => {
  const r = historyNext(['a', 'b'], { index: null, draft: '' }, 'typing');
  assert.deepEqual(r, { value: 'typing', state: { index: null, draft: '' } });
});

test('historyNext: Down steps to newer entries then restores the draft past the newest', () => {
  const hist = ['a', 'b', 'c'];
  // navigate up to 'a' (index 0) with draft 'd'
  let s = { value: 'a', state: { index: 0, draft: 'd' } as { index: number | null; draft: string } };
  s = historyNext(hist, s.state, s.value);
  assert.equal(s.value, 'b');
  s = historyNext(hist, s.state, s.value);
  assert.equal(s.value, 'c');
  s = historyNext(hist, s.state, s.value); // past newest → restore draft, exit nav
  assert.equal(s.value, 'd');
  assert.equal(s.state.index, null);
  assert.equal(s.state.draft, '');
});

test('pushHistory: appends, skips blanks and consecutive duplicates', () => {
  assert.deepEqual(pushHistory([], 'a'), ['a']);
  assert.deepEqual(pushHistory(['a'], 'a'), ['a']); // dup collapsed
  assert.deepEqual(pushHistory(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(pushHistory(['a'], '   '), ['a']); // blank ignored
  assert.deepEqual(pushHistory(['a', 'b'], 'a'), ['a', 'b', 'a']); // non-consecutive dup kept
});

// ── matchResumeTarget ──

const SESSIONS = [
  { sessionId: 'sid-aaaa1111', name: 'cortex-8cdfbe' },
  { sessionId: 'sid-bbbb2222', name: 'cortex-99ffaa' },
];

test('matchResumeTarget: exact sessionId, exact name, suffix, and bare suffix', () => {
  assert.equal(matchResumeTarget(SESSIONS, 'sid-aaaa1111'), 'sid-aaaa1111');
  assert.equal(matchResumeTarget(SESSIONS, 'cortex-8cdfbe'), 'sid-aaaa1111');
  assert.equal(matchResumeTarget(SESSIONS, '8cdfbe'), 'sid-aaaa1111'); // bare short id
  assert.equal(matchResumeTarget(SESSIONS, 'sid-bbbb'), 'sid-bbbb2222'); // id prefix
});

test('matchResumeTarget: no match and empty target → null', () => {
  assert.equal(matchResumeTarget(SESSIONS, 'nope'), null);
  assert.equal(matchResumeTarget(SESSIONS, '   '), null);
  assert.equal(matchResumeTarget([], 'cortex-8cdfbe'), null);
});

// ── isMouseSequence / parseWheelEvents ──

test('isMouseSequence: detects raw ESC and SGR residue, passes normal text', () => {
  assert.equal(isMouseSequence('\x1b[<64;1;1M'), true);
  assert.equal(isMouseSequence('[<64;30;10M'), true); // ESC already stripped by Ink
  assert.equal(isMouseSequence('hello'), false);
  assert.equal(isMouseSequence(''), false);
});

test('parseWheelEvents: extracts up/down from SGR wheel codes', () => {
  assert.deepEqual(parseWheelEvents('\x1b[<64;10;5M'), ['up']);
  assert.deepEqual(parseWheelEvents('\x1b[<65;10;5M'), ['down']);
  assert.deepEqual(parseWheelEvents('\x1b[<0;10;5M'), []); // plain click, not a wheel
  assert.deepEqual(parseWheelEvents('\x1b[<64;1;1M\x1b[<65;1;1M'), ['up', 'down']);
});

// ── wrapToWidth ──

test('wrapToWidth: word-wraps and hard-splits over-long words', () => {
  assert.deepEqual(wrapToWidth('', 10), ['']);
  assert.deepEqual(wrapToWidth('hello world', 5), ['hello', 'world']);
  assert.deepEqual(wrapToWidth('abcdefghijk', 5), ['abcde', 'fghij', 'k']);
  assert.deepEqual(wrapToWidth('hi there friend', 8), ['hi there', 'friend']);
});

// ── flattenMessageLines / flattenTranscript ──

test('flattenMessageLines: text message wraps into markdown lines (no truncation)', () => {
  const lines = flattenMessageLines({ text: 'a'.repeat(25) }, 10);
  assert.equal(lines.length, 3); // 25 chars / 10 → 3 lines, all kept
  assert.ok(lines.every(l => l.markdown && !l.dim));
  assert.equal(lines.map(l => l.text).join(''), 'a'.repeat(25));
});

test('flattenMessageLines: context rich blocks render dim and non-markdown', () => {
  const lines = flattenMessageLines({ richBlocks: [{ type: 'context', text: '🔧 Bash' }] }, 80);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].dim, true);
  assert.equal(lines[0].markdown, false);
});

test('flattenMessageLines: streamed text is dim, queued marker appended', () => {
  const lines = flattenMessageLines({ streamText: 'reply', queued: true }, 80);
  assert.deepEqual(lines.map(l => l.text), ['reply', '⏳ queued']);
  assert.ok(lines[0].dim);
});

test('flattenTranscript: inserts a blank separator line between messages', () => {
  const lines = flattenTranscript([{ text: 'one' }, { text: 'two' }], 80);
  assert.deepEqual(lines.map(l => l.text), ['one', '', 'two']);
});
