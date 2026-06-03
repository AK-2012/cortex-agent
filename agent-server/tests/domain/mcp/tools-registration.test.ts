// input:  TOOL_NAMES from domain/mcp/server + domain/mcp/core-server
// output: every MCP tool name is registered at module evaluation time
// pos:    regression guard — split may change tool registration shape
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';

test('ext-server (server.ts) registers 10 non-remote tool names', async () => {
  const mod = await import('../../../src/domain/mcp/server.js');
  const names: readonly string[] = mod.TOOL_NAMES;

  const expected = [
    'slack_send_file',
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
  assert.equal(names.length, 10);
  assert.equal(new Set(names).size, 10, 'no duplicate tool names');
});

test('core-server (core-server.ts) registers 6 remote_* tools plus current_time', async () => {
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
  ];

  assert.deepEqual([...names].sort(), [...expected].sort());
  assert.equal(names.length, 7);
  assert.equal(new Set(names).size, 7, 'no duplicate tool names');
});
