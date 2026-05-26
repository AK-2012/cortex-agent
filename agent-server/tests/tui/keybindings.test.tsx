// input:  src/tui/hooks/useKeybindings.js
// output: Keybinding tests — verify handler invocation via ink useInput
// pos:    Verifies Ctrl+C, Ctrl+L, arrow key handlers via stdin simulation

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useKeybindings } from '../../src/tui/hooks/useKeybindings.js';

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Test component ──

function TestApp({ onEvent }: { onEvent: (name: string) => void }) {
  useKeybindings({
    onSubmit: () => onEvent('submit'),
    onCancel: () => onEvent('cancel'),
    onScrollUp: (page?: boolean) => onEvent(page ? 'pageUp' : 'scrollUp'),
    onScrollDown: (page?: boolean) => onEvent(page ? 'pageDown' : 'scrollDown'),
    onClearView: () => onEvent('clearView'),
    onExit: () => onEvent('exit'),
  });
  return React.createElement(Text, null, 'test app');
}

test('useKeybindings calls onClearView on Ctrl+L', async (t) => {
  const events: string[] = [];

  const app = React.createElement(TestApp, { onEvent: (name: string) => events.push(name) });
  const instance = render(app);

  // Wait for React effects to mount
  await delay(200);

  // Ctrl+L: raw byte \x0c (form feed) → parseKeypress gives { name: 'l', ctrl: true }
  instance.stdin.write('\x0c');

  await delay(200);

  assert.ok(events.includes('clearView'), `expected clearView in events: ${JSON.stringify(events)}`);

  instance.unmount();
  instance.cleanup();
});

test('useKeybindings calls onCancel on Escape', async (t) => {
  const events: string[] = [];

  const app = React.createElement(TestApp, { onEvent: (name: string) => events.push(name) });
  const instance = render(app);

  // Wait for React effects to mount
  await delay(200);

  // Escape: raw byte \x1b → parseKeypress gives { name: 'escape' }
  instance.stdin.write('\x1b');

  await delay(200);

  assert.ok(events.includes('cancel'), `expected cancel in events: ${JSON.stringify(events)}`);

  instance.unmount();
  instance.cleanup();
});
