// input:  node:test, MockAdapter, VirtualMessage
// output: tool-trace mutable-tail merge and env toggle regression
// pos:    tool-trace.ts compact Slack rendering regression test
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualMessage } from '../src/platform/virtual-message.js';
import { MockAdapter } from '../src/platform/testing.js';
import { ToolTrace, isToolTraceEnabled, createToolTrace, _test } from '../src/platform/tool-trace.js';

async function settle(vm: VirtualMessage) {
  // Drain both the VM's queue and any chained tool-trace updates.
  await vm.flush();
  // Give the tool-trace's internal queue a microtask tick to run handlers scheduled
  // after postStandalone resolved.
  await new Promise(resolve => setImmediate(resolve));
  await vm.flush();
}

test('isToolTraceEnabled: gated by CORTEX_SHOW_TOOL_CALLS', () => {
  const prev = process.env.CORTEX_SHOW_TOOL_CALLS;
  try {
    delete process.env.CORTEX_SHOW_TOOL_CALLS;
    assert.equal(isToolTraceEnabled(), false);
    process.env.CORTEX_SHOW_TOOL_CALLS = '0';
    assert.equal(isToolTraceEnabled(), false);
    process.env.CORTEX_SHOW_TOOL_CALLS = '1';
    assert.equal(isToolTraceEnabled(), true);
    process.env.CORTEX_SHOW_TOOL_CALLS = 'true';
    assert.equal(isToolTraceEnabled(), true);
    process.env.CORTEX_SHOW_TOOL_CALLS = 'yes';
    assert.equal(isToolTraceEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.CORTEX_SHOW_TOOL_CALLS;
    else process.env.CORTEX_SHOW_TOOL_CALLS = prev;
  }
});

test('createToolTrace returns null when disabled or vm missing', () => {
  const prev = process.env.CORTEX_SHOW_TOOL_CALLS;
  try {
    const adapter = new MockAdapter();
    const vm = new VirtualMessage(adapter, 'C1');
    delete process.env.CORTEX_SHOW_TOOL_CALLS;
    assert.equal(createToolTrace(vm), null);
    process.env.CORTEX_SHOW_TOOL_CALLS = '1';
    assert.equal(createToolTrace(null), null);
    const trace = createToolTrace(vm);
    assert.ok(trace instanceof ToolTrace);
  } finally {
    if (prev === undefined) delete process.env.CORTEX_SHOW_TOOL_CALLS;
    else process.env.CORTEX_SHOW_TOOL_CALLS = prev;
  }
});

test('ToolTrace: consecutive same tool — 1 post + N-1 updates on main VM msg', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C1');
  const trace = new ToolTrace(vm);

  trace.onToolUse('Read', { file_path: '/repo/src/a.ts' });
  trace.onToolUse('Read', { file_path: '/repo/src/b.ts' });
  trace.onToolUse('Read', { file_path: '/repo/src/c.ts' });
  await settle(vm);

  assert.equal(adapter.posted.length, 1, 'a single message is posted (the main VM msg)');
  assert.equal(adapter.updated.length, 2, 'two in-place updates after the initial post');
  const final = adapter.updated[1].content.text;
  assert.match(final as string, /Read .*\u00d73/);
  assert.match(final as string, /a\.ts/);
  assert.match(final as string, /b\.ts/);
  assert.match(final as string, /c\.ts/);
});

test('ToolTrace: different tool → tail is sealed and new tail opens (still 1 Slack msg)', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C1');
  const trace = new ToolTrace(vm);

  trace.onToolUse('Read', { file_path: 'a.ts' });
  trace.onToolUse('Bash', { command: 'ls' });
  trace.onToolUse('Read', { file_path: 'b.ts' });
  await settle(vm);

  assert.equal(adapter.posted.length, 1, 'one Slack post total');
  assert.ok(adapter.updated.length >= 2, 'tail rewritten for each new group');
  const final = adapter.updated[adapter.updated.length - 1].content.text as string;
  assert.match(final, /Read .*\u00d71.*a\.ts/s, 'sealed Read a');
  assert.match(final, /Bash .*\u00d71/s, 'sealed Bash ls');
  assert.match(final, /Read .*\u00d71.*b\.ts/s, 'open Read b tail');
});

test('ToolTrace: flush() then same tool — tool-trace restarts group but VM tail auto-seals', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C1');
  const trace = new ToolTrace(vm);

  trace.onToolUse('Read', { file_path: 'a.ts' });
  await settle(vm);
  trace.flush();
  trace.onToolUse('Read', { file_path: 'b.ts' });
  await settle(vm);

  // Both tool lines live in the same Slack message (appended tail → edited tail).
  assert.equal(adapter.posted.length, 1);
  const final = adapter.updated[adapter.updated.length - 1].content.text as string;
  assert.match(final, /a\.ts/);
  assert.match(final, /b\.ts/);
});

test('ToolTrace: tool line is merged into main VM message via updates, not as a new post', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C1');
  const trace = new ToolTrace(vm);

  vm.append('hello');
  trace.onToolUse('Read', { file_path: 'a.ts' });
  await settle(vm);

  // Only the first `hello` creates a Slack message; the tool line is an update.
  assert.equal(adapter.posted.length, 1);
  assert.ok(adapter.updated.length >= 1);
  const last = adapter.updated[adapter.updated.length - 1].content.text as string;
  assert.match(last, /hello/);
  assert.match(last, /Read .*×1/);
});

test('ToolTrace: assistant text after tool seals the tail, subsequent tool appends new tail', async () => {
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C1');
  const trace = new ToolTrace(vm);

  trace.onToolUse('Read', { file_path: 'a.ts' });
  // Tool-trace callers wrap onAssistantMessage with: trace.flush(); vm.append(text).
  trace.flush();
  vm.append('ok');
  trace.onToolUse('Bash', { command: 'ls' });
  await settle(vm);

  assert.equal(adapter.posted.length, 1, 'everything accumulates into one Slack message');
  const final = adapter.updated[adapter.updated.length - 1].content.text as string;
  assert.match(final, /Read .*×1.*a\.ts/s, 'Read group sealed as prefix');
  assert.match(final, /ok/, 'assistant text in middle');
  assert.match(final, /Bash .*×1.*ls/s, 'Bash group opened as new tail');
});

test('renderToolLine: strips MCP prefix and truncates', () => {
  const short = _test.renderToolLine('mcp__cortex__remote_read', ['lab:/etc/hostname']);
  assert.match(short, /remote_read/);
  assert.doesNotMatch(short, /mcp__/);

  const many = Array.from({ length: 50 }, (_, i) => `file_${i}.ts`);
  const line = _test.renderToolLine('Read', many);
  assert.ok(line.length <= 130, `line length ${line.length} under truncation cap`);
  assert.match(line, /\+\d+\u2026$/, 'ends with "+N…" tail when truncated');
});

test('summarizeToolInput: Bash takes first line of command', () => {
  const s = _test.summarizeToolInput('Bash', { command: 'echo hi\necho bye' });
  assert.equal(s, 'echo hi');
});

test('ToolTrace: tool_use before text in same tick preserves Slack order', async () => {
  // Regression for the ordering bug: within one assistant event with
  // content = [tool_use, text], the tool line must appear BEFORE the text
  // in the final Slack message content (model emitted the tool first).
  const adapter = new MockAdapter();
  const vm = new VirtualMessage(adapter, 'C1');
  const trace = new ToolTrace(vm);

  // Simulate claude-bridge's sync block iteration for [tool_use Read a, text "hi"]:
  trace.onToolUse('Read', { file_path: 'a.ts' });
  vm.append('hi');
  await settle(vm);

  assert.equal(adapter.posted.length, 1, 'single merged Slack message');
  const final = adapter.updated.length > 0
    ? (adapter.updated[adapter.updated.length - 1].content.text as string)
    : (adapter.posted[0].content.text as string);
  const toolIdx = final.search(/Read/);
  const textIdx = final.indexOf('hi');
  assert.ok(toolIdx >= 0 && textIdx > toolIdx, `tool line must precede text — got: ${JSON.stringify(final)}`);
});
