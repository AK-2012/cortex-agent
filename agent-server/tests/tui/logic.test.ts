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
} from '../../src/tui/logic.js';

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
