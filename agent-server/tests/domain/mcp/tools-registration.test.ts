// input:  TOOL_NAMES from domain/mcp/server + domain/mcp/core-server
// output: every MCP tool name is registered at module evaluation time
// pos:    regression guard — split may change tool registration shape
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';

test('ext-server (server.ts) registers 9 non-remote tool names (excluding platform-specific slack_send_file)', async () => {
  const mod = await import('../../../src/domain/mcp/server.js');
  const names: readonly string[] = mod.TOOL_NAMES;

  const expected = [
    'cost_query',
    'query_executions',
    'cortex_context',
    'cortex_schedule_add',
    'cortex_schedule_list',
    'cortex_schedule_get',
    'cortex_schedule_remove',
    'cortex_schedule_pause',
    'cortex_schedule_resume',
  ];

  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.equal(names.length, 9);
  assert.equal(new Set(names).size, 9, 'no duplicate tool names');
});

test('slack-server (slack-server.ts) registers 1 platform-specific tool name', async () => {
  const mod = await import('../../../src/domain/mcp/slack-server.js');
  const names: readonly string[] = mod.TOOL_NAMES;

  const expected = ['slack_send_file'];

  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.equal(names.length, 1);
  assert.equal(new Set(names).size, 1, 'no duplicate tool names');
});

test('core-server (core-server.ts) registers 6 remote_* tools, current_time, and 6 thread_* tools', async () => {
  const mod = await import('../../../src/domain/mcp/core-server.js');
  const names: readonly string[] = mod.TOOL_NAMES;

  const expected = [
    'remote_bash',
    'remote_read',
    'remote_write',
    'remote_edit',
    'remote_glob',
    'remote_grep',
    'current_time',
    'thread_start',
    'thread_status',
    'thread_result',
    'thread_list',
    'thread_list_templates',
    'thread_cancel',
  ];

  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.equal(names.length, 13);
  assert.equal(new Set(names).size, 13, 'no duplicate tool names');
});
