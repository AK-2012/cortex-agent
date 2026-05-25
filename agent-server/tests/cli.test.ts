// input:  cli module
// output: verify help text, subcommand routing, error handling
// pos:    Validate cortex CLI dispatcher pure logic

import test from 'node:test';
import assert from 'node:assert/strict';
import { getCliHelp, runCli } from '../src/entry/cli.js';

// ─── getCliHelp ─────────────────────────────────────────────────

test('getCliHelp includes all subcommand names', () => {
  const help = getCliHelp();
  assert.match(help, /init/);
  assert.match(help, /start/);
  assert.match(help, /daemon/);
  assert.match(help, /daemon stop/);
  assert.match(help, /task/);
  assert.match(help, /config/);
});

test('getCliHelp includes Cortex CLI title', () => {
  const help = getCliHelp();
  assert.match(help, /Cortex/);
  assert.match(help, /Usage:/);
  assert.match(help, /Commands:/);
});

test('getCliHelp includes --home option description for init', () => {
  const help = getCliHelp();
  assert.match(help, /--home/);
  assert.match(help, /CORTEX_HOME/);
});

// ─── runCli (async) ─────────────────────────────────────────────

test('runCli --help returns help text', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Cortex/);
  assert.equal(result.stderr, '');
});

test('runCli with unknown command returns error', async () => {
  const result = await runCli(['unknown-subcommand']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.length > 0);
});

test('runCli with init --help returns help text', async () => {
  const result = await runCli(['init', '--help']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /CORTEX_HOME/);
  assert.equal(result.stderr, '');
});

test('runCli config returns path info', async () => {
  const result = await runCli(['config']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /INSTALL_ROOT/);
  assert.match(result.stdout, /DATA_DIR/);
  assert.equal(result.stderr, '');
});

test('runCli bare daemon returns error when not main entry', async () => {
  const result = await runCli(['daemon']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /must be run from the main entry/);
});
