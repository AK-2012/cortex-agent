// input:  node:test, prompt-builder (buildConversationPrompt vs buildStepPrompt), threadStore
// output: golden-prompt fidelity tests for the thread-free conversation path
// pos:    regression guard that runConversation's prompt equals the legacy default-thread prompt
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
//
// Plain user messages no longer run as a `templateName:'default'` thread; they run via
// runConversation, which assembles its prompt with buildConversationPrompt. This test pins that
// prompt to be byte-identical to what the legacy path produced — buildStepPrompt on a default
// thread with isUserInitiated=true — so the migration does not silently change every chat turn.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buildStepPrompt, buildConversationPrompt, THREAD_PROTOCOL_PREAMBLE } from '../src/domain/threads/prompt-builder.js';
import { threadStore } from '../src/store/thread-repo.js';
import type { ThreadRecord, AgentSlotConfig } from '../src/core/types/thread-types.js';

const testThreadIds = new Set<string>();
after(async () => {
  for (const id of testThreadIds) await threadStore.delete(id);
  await threadStore.flush();
});

function makeAgentConfig(overrides: Partial<AgentSlotConfig> = {}): AgentSlotConfig {
  return {
    slotId: 'main',
    profile: '__active__',
    persistSession: false,
    directive: '',
    systemPrompt: 'SYSTEM',
    promptTemplate: '{{input}}',
    claudeAgent: null,
    outputStyle: null,
    tools: 'Read',
    pluginDirs: null,
    stages: undefined,
    entryStage: undefined,
    ...overrides,
  } as AgentSlotConfig;
}

/** Build the legacy default thread (templateName='default', artifact present) and register it. */
function makeDefaultThread(userMessage: string): string {
  const id = `thr_conv-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const record: ThreadRecord = {
    id, templateName: 'default', status: 'running', channel: 'C1', projectId: 'general',
    platformThreadId: null, userMessage, userMessageTs: '111.000',
    workspacePath: `/tmp/${id}`, artifactPath: `/tmp/${id}/artifact.md`,
    agents: { main: { slotId: 'main', profile: '__active__', sessionId: null, sessionName: null, status: 'idle', lastOutput: null, persistSession: false } },
    activeAgent: 'main', activeStage: null, currentStepIndex: 0, steps: [], iterationCounts: {},
    totalCostUsd: 0, createdAt: now, updatedAt: now, endedAt: null, error: null, abortReason: null, metadata: null,
  };
  testThreadIds.add(id);
  threadStore.set(record);
  return id;
}

test('buildConversationPrompt matches legacy default-thread prompt (empty directive)', () => {
  const agentConfig = makeAgentConfig({ directive: '' });
  const input = 'hello world';
  const threadId = makeDefaultThread(input);

  // Legacy path: default thread, isUserInitiated=true (preamble suppressed).
  const legacy = buildStepPrompt(threadId, agentConfig, null, true);
  const conversation = buildConversationPrompt(agentConfig, input);

  assert.equal(conversation, legacy);
  assert.equal(conversation, 'hello world');
  assert.ok(!conversation.includes(THREAD_PROTOCOL_PREAMBLE), 'conversation prompt must not contain the thread protocol preamble');
});

test('buildConversationPrompt matches legacy default-thread prompt (non-empty directive)', () => {
  const agentConfig = makeAgentConfig({ directive: 'You are the direct agent.' });
  const input = 'what is 2+2?';
  const threadId = makeDefaultThread(input);

  const legacy = buildStepPrompt(threadId, agentConfig, null, true);
  const conversation = buildConversationPrompt(agentConfig, input);

  assert.equal(conversation, legacy);
  assert.ok(conversation.startsWith('You are the direct agent.'));
  assert.ok(conversation.includes('what is 2+2?'));
  assert.ok(!conversation.includes(THREAD_PROTOCOL_PREAMBLE));
});

test('buildConversationPrompt applies a custom promptTemplate the same way', () => {
  const agentConfig = makeAgentConfig({ directive: '', promptTemplate: 'User asked: {{input}}' });
  const input = 'status?';
  const threadId = makeDefaultThread(input);

  const legacy = buildStepPrompt(threadId, agentConfig, null, true);
  const conversation = buildConversationPrompt(agentConfig, input);

  assert.equal(conversation, legacy);
  assert.equal(conversation, 'User asked: status?');
});
