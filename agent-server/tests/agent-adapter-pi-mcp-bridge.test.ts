// input:  _test exports from mcp-bridge + MCP SDK
// output: mapMcpContent unit + listTools/cost_query integration
// pos:    PI mcp-bridge content mapping and integration test
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { _test } from '../src/agent-adapter/pi/mcp-bridge.js';

const { mapMcpContent } = _test;

// The CORE_SERVER_PATH / EXT_SERVER_PATH exported from mcp-bridge resolves relative to its own
// location: when loaded via tsx from src/ those siblings don't exist; when running compiled from
// dist/ they do. For the integration tests below we always target the compiled dist/ files so the
// test verifies the deployed (npm install) behavior — `npm run build` must have run first.
const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(TESTS_DIR, '../dist');
const CORE_SERVER_PATH = resolve(DIST_DIR, 'domain/mcp/core-server.js');
const EXT_SERVER_PATH = resolve(DIST_DIR, 'domain/mcp/server.js');

const CORE_TOOLS = [
  'remote_bash', 'remote_read', 'remote_write',
  'remote_edit', 'remote_glob', 'remote_grep',
];

const EXT_TOOLS = [
  'slack_send_file', 'cost_query', 'query_executions',
  'cortex_context',
  'cortex_schedule_add', 'cortex_schedule_list', 'cortex_schedule_get',
  'cortex_schedule_remove', 'cortex_schedule_pause', 'cortex_schedule_resume',
];

// --- Test C: mapMcpContent pure unit tests ---

test('mapMcpContent: text item passes through', () => {
  assert.deepEqual(mapMcpContent({ type: 'text', text: 'hello' }), { type: 'text', text: 'hello' });
});

test('mapMcpContent: image item produces base64-length description', () => {
  const r = mapMcpContent({ type: 'image', data: 'abc', mimeType: 'image/png' });
  assert.equal(r.type, 'text');
  assert.ok(r.text.includes('image/png'), 'includes mimeType');
  assert.ok(r.text.includes('3'), 'includes data length');
});

test('mapMcpContent: resource with text passthrough', () => {
  const r = mapMcpContent({ type: 'resource', resource: { uri: 'f://x', text: 'content' } });
  assert.deepEqual(r, { type: 'text', text: 'content' });
});

test('mapMcpContent: resource with blob produces binary description', () => {
  const r = mapMcpContent({ type: 'resource', resource: { uri: 'f://x', blob: 'b64', mimeType: 'application/pdf' } });
  assert.equal(r.type, 'text');
  assert.ok(r.text.includes('f://x'), 'includes uri');
  assert.ok(r.text.includes('application/pdf'), 'includes mimeType');
});

test('mapMcpContent: unknown type falls back to JSON', () => {
  const item = { type: 'exotic', foo: 42 };
  const r = mapMcpContent(item);
  assert.equal(r.type, 'text');
  assert.equal(r.text, JSON.stringify(item));
});

// --- Path constants sanity ---

test('compiled core-server.js exists at expected dist location', () => {
  assert.ok(existsSync(CORE_SERVER_PATH), `expected ${CORE_SERVER_PATH} on disk — run \`npm run build\` first`);
});

test('compiled server.js exists at expected dist location', () => {
  assert.ok(existsSync(EXT_SERVER_PATH), `expected ${EXT_SERVER_PATH} on disk — run \`npm run build\` first`);
});

// --- Test A: listTools integration (real MCP subprocesses) ---

test('core-server exposes 6 remote_* tools via StdioClientTransport', { timeout: 15000 }, async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [CORE_SERVER_PATH],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test-core-server', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of CORE_TOOLS) {
      assert.ok(names.includes(expected), `expected tool '${expected}' in core-server listTools`);
    }
    assert.equal(names.length, CORE_TOOLS.length, `expected exactly ${CORE_TOOLS.length} tools in core-server`);
  } finally {
    await transport.close();
  }
});

test('ext-server exposes 10 non-remote tools via StdioClientTransport', { timeout: 15000 }, async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [EXT_SERVER_PATH],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test-ext-server', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXT_TOOLS) {
      assert.ok(names.includes(expected), `expected tool '${expected}' in ext-server listTools`);
    }
    assert.equal(names.length, EXT_TOOLS.length, `expected exactly ${EXT_TOOLS.length} tools in ext-server`);
  } finally {
    await transport.close();
  }
});

// --- Test B: cost_query returns text content (via ext-server) ---

test('cost_query tool returns text content when called', { timeout: 15000 }, async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [EXT_SERVER_PATH],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test-ext-server-cost', version: '1.0.0' });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'cost_query', arguments: {} });
    const mapped = (result.content as any[]).map(mapMcpContent);
    assert.ok(mapped.length > 0, 'cost_query should return at least one content item');
    assert.ok(mapped.every((c: any) => c.type === 'text'), 'all mapped content items should be text');
  } finally {
    await transport.close();
  }
});
