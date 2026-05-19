// input:  config-generator module
// output: verify MCP config builder functions produce correct structure
// pos:    Validate config-generator pure logic (builders only, no filesystem)

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFullConfig, buildCoreConfig, buildTuiConfig } from '../../src/core/config-generator.js';

// ─── buildFullConfig ────────────────────────────────────────────

test('buildFullConfig returns cortex-core and cortex-ext servers', () => {
  const config = buildFullConfig('/test/server') as any;
  assert.ok(config.mcpServers);
  const keys = Object.keys(config.mcpServers);
  assert.equal(keys.length, 2);
  assert.ok(keys.includes('cortex-core'));
  assert.ok(keys.includes('cortex-ext'));
});

test('buildFullConfig uses provided serverRoot as cwd', () => {
  const config = buildFullConfig('/my/server/root') as any;
  assert.equal(config.mcpServers['cortex-core'].cwd, '/my/server/root');
  assert.equal(config.mcpServers['cortex-ext'].cwd, '/my/server/root');
});

test('buildFullConfig cortex-core points to core-server.js (absolute path)', () => {
  const config = buildFullConfig('/test') as any;
  assert.equal(config.mcpServers['cortex-core'].command, 'node');
  assert.deepEqual(config.mcpServers['cortex-core'].args, ['/test/dist/domain/mcp/core-server.js']);
});

test('buildFullConfig cortex-ext points to server.js (absolute path)', () => {
  const config = buildFullConfig('/test') as any;
  assert.equal(config.mcpServers['cortex-ext'].command, 'node');
  assert.deepEqual(config.mcpServers['cortex-ext'].args, ['/test/dist/domain/mcp/server.js']);
});

// ─── buildCoreConfig ────────────────────────────────────────────

test('buildCoreConfig returns only cortex-core server', () => {
  const config = buildCoreConfig('/test/server') as any;
  assert.ok(config.mcpServers);
  const keys = Object.keys(config.mcpServers);
  assert.equal(keys.length, 1);
  assert.ok(keys.includes('cortex-core'));
});

test('buildCoreConfig uses provided serverRoot as cwd', () => {
  const config = buildCoreConfig('/my/server/root') as any;
  assert.equal(config.mcpServers['cortex-core'].cwd, '/my/server/root');
});

// ─── buildTuiConfig (DR-0012) ───────────────────────────────────

test('buildTuiConfig returns only cortex-tui-bridge server', () => {
  const config = buildTuiConfig('/test/server') as any;
  assert.ok(config.mcpServers);
  const keys = Object.keys(config.mcpServers);
  assert.equal(keys.length, 1, 'TUI config must isolate to a single bridge server');
  assert.ok(keys.includes('cortex-tui-bridge'));
  // Must NOT leak core/ext servers
  assert.ok(!keys.includes('cortex-core'), 'TUI config must not include cortex-core');
  assert.ok(!keys.includes('cortex-ext'), 'TUI config must not include cortex-ext');
});

test('buildTuiConfig points to tui-server.js (absolute path)', () => {
  const config = buildTuiConfig('/test') as any;
  assert.equal(config.mcpServers['cortex-tui-bridge'].command, 'node');
  assert.deepEqual(config.mcpServers['cortex-tui-bridge'].args, ['/test/dist/domain/mcp/tui-server.js']);
  assert.equal(config.mcpServers['cortex-tui-bridge'].cwd, '/test');
});
