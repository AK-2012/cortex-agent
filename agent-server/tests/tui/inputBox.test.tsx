// input:  src/tui/components/InputBox.js
// output: InputBox tests — send when idle, blocked (text preserved) while awaiting response
// pos:    Verifies the "type but cannot send while waiting" requirement

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { InputBox } from '../../src/tui/components/InputBox.js';

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

test('InputBox submits typed text when not awaiting', async (t) => {
  const submitted: string[] = [];
  const app = React.createElement(InputBox, {
    onSubmit: (txt: string) => submitted.push(txt),
    awaitingResponse: false,
    focus: true,
  });
  const instance = render(app);
  await delay(150);

  instance.stdin.write('hello');
  await delay(100);
  instance.stdin.write('\r'); // Enter
  await delay(150);

  assert.deepEqual(submitted, ['hello'], `expected one submit, got ${JSON.stringify(submitted)}`);

  instance.unmount();
  instance.cleanup();
});

test('InputBox does NOT submit while awaiting a response', async (t) => {
  const submitted: string[] = [];
  const app = React.createElement(InputBox, {
    onSubmit: (txt: string) => submitted.push(txt),
    awaitingResponse: true,
    focus: true,
  });
  const instance = render(app);
  await delay(150);

  instance.stdin.write('hello');
  await delay(100);
  instance.stdin.write('\r'); // Enter — should be ignored
  await delay(150);

  assert.equal(submitted.length, 0, `expected no submit while awaiting, got ${JSON.stringify(submitted)}`);
  // Text is preserved (still visible in the frame)
  assert.match(instance.lastFrame() ?? '', /hello/);

  instance.unmount();
  instance.cleanup();
});
