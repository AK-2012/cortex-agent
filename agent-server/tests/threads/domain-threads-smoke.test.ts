// Smoke tests for domain/threads/ module structure.
// These tests import directly from the new module paths (not via the thread-manager.ts shim)
// to verify the split is importable and core pure functions work correctly.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultThread,
  isDefaultThread,
  listAgents,
  loadConfig,
  parseTarget,
  resolveStageName,
  resolveSystemVars,
  THREAD_PROTOCOL_PREAMBLE,
} from '../../src/domain/threads/index.js';
import { threadStore } from '../../src/store/thread-repo.js';

const createdThreadIds = new Set<string>();

before(() => {
  loadConfig();
});

after(async () => {
  for (const id of createdThreadIds) await threadStore.delete(id);
  await threadStore.flush();
});

// --- parseTarget ---

test('parseTarget: bare agent name returns null stage', () => {
  const r = parseTarget('coder');
  assert.equal(r.agent, 'coder');
  assert.equal(r.stage, null);
});

test('parseTarget: agent:stage returns both components', () => {
  const r = parseTarget('coder:review');
  assert.equal(r.agent, 'coder');
  assert.equal(r.stage, 'review');
});

test('parseTarget: trailing colon returns null stage', () => {
  const r = parseTarget('coder:');
  assert.equal(r.agent, 'coder');
  assert.equal(r.stage, null);
});

// --- resolveStageName ---

test('resolveStageName: null agentDef returns null', () => {
  assert.equal(resolveStageName(null, null), null);
});

test('resolveStageName: agentDef with no stages map returns null', () => {
  assert.equal(resolveStageName({ profile: 'default' } as any, null), null);
});

test('resolveStageName: explicit stage present in stages map', () => {
  const def = { stages: { draft: {}, review: {} }, profile: 'default' } as any;
  assert.equal(resolveStageName(def, 'review'), 'review');
});

test('resolveStageName: falls back to entryStage when explicit is null', () => {
  const def = { stages: { draft: {}, review: {} }, entryStage: 'review', profile: 'default' } as any;
  assert.equal(resolveStageName(def, null), 'review');
});

test('resolveStageName: falls back to first stage when no entryStage', () => {
  const def = { stages: { alpha: {}, beta: {} }, profile: 'default' } as any;
  assert.equal(resolveStageName(def, null), 'alpha');
});

// --- resolveSystemVars ---

test('resolveSystemVars: replaces {{currentDateTime}} with a timestamp', () => {
  const out = resolveSystemVars('Time: {{currentDateTime}}');
  assert.doesNotMatch(out, /\{\{currentDateTime\}\}/);
  assert.match(out, /\d{4}/);
});

test('resolveSystemVars: leaves unknown placeholders untouched', () => {
  const out = resolveSystemVars('Hello {{unknown}}');
  assert.match(out, /\{\{unknown\}\}/);
});

test('resolveSystemVars: leaves plain text unchanged', () => {
  assert.equal(resolveSystemVars('no vars'), 'no vars');
});

// --- THREAD_PROTOCOL_PREAMBLE ---

test('THREAD_PROTOCOL_PREAMBLE is a non-empty string with [Cortex Thread Protocol]', () => {
  assert.ok(typeof THREAD_PROTOCOL_PREAMBLE === 'string');
  assert.ok(THREAD_PROTOCOL_PREAMBLE.length > 0);
  assert.ok(THREAD_PROTOCOL_PREAMBLE.includes('[Cortex Thread Protocol]'));
});

// --- createDefaultThread + isDefaultThread ---

test('createDefaultThread creates thread with templateName=default and workspace', () => {
  const anyAgent = listAgents()[0];
  const thread = createDefaultThread(`C-def-test-${Math.random().toString(36).slice(2, 8)}`, {
    agentName: anyAgent.name,
    userMessage: 'test input',
    userMessageTs: 'ts',
  });
  createdThreadIds.add(thread.id);
  assert.equal(thread.templateName, 'default');
  assert.ok(thread.workspacePath.length > 0, 'should have workspace');
  assert.ok(thread.artifactPath.length > 0, 'should have artifact path');
});

test('createDefaultThread thread is detected as default by isDefaultThread', () => {
  const anyAgent = listAgents()[0];
  const thread = createDefaultThread(`C-def-check-${Math.random().toString(36).slice(2, 8)}`, {
    agentName: anyAgent.name,
    userMessage: 'test',
    userMessageTs: 'ts',
  });
  createdThreadIds.add(thread.id);
  assert.equal(isDefaultThread(thread.id), true);
});

test('createDefaultThread throws for unknown agent', () => {
  assert.throws(() => {
    createDefaultThread('C-err', {
      agentName: 'non-existent-agent-12345',
      userMessage: 'test',
      userMessageTs: 'ts',
    });
  }, /Unknown agent/);
});
