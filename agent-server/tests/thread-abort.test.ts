// input:  Node test runner + thread-manager abort + summary
// output: detectAbortMarker + abortThread state tests
// pos:    Verify agent-initiated abort infrastructure
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DATA_DIR } from '../src/core/utils.js';
import { threadStore } from '../src/store/thread-repo.js';
import {
  abortThread,
  buildStepPrompt,
  cancelThread,
  cleanupWorkspace,
  createThread,
  detectAbortMarker,
  listAgents,
  loadConfig,
  resolveAgentSlotConfig,
  THREAD_PROTOCOL_PREAMBLE,
} from '../src/domain/threads/index.js';
import { buildThreadSummary, finalizeAbortedThread } from '../src/domain/threads/runner.js';
import type { ThreadRecord } from '../src/core/types/thread-types.js';

const THREADS_FILE = path.join(DATA_DIR, 'threads.json');
let threadsBackup: string | null = null;
let threadsBackupExisted = false;
const createdThreadIds = new Set<string>();

before(() => {
  try {
    threadsBackup = fs.readFileSync(THREADS_FILE, 'utf8');
    threadsBackupExisted = true;
  } catch {
    threadsBackup = null;
    threadsBackupExisted = false;
  }
  loadConfig();
});

after(async () => {
  for (const id of createdThreadIds) {
    try { cleanupWorkspace(id); } catch {}
    await threadStore.delete(id);
  }
  if (threadsBackupExisted && threadsBackup != null) {
    fs.writeFileSync(THREADS_FILE, threadsBackup);
  } else {
    try { fs.unlinkSync(THREADS_FILE); } catch {}
  }
  await threadStore.flush();
});

process.on('exit', () => {
  if (threadsBackupExisted && threadsBackup != null) {
    try { fs.writeFileSync(THREADS_FILE, threadsBackup); } catch {}
  }
});

function trackThreadId(id: string): string {
  createdThreadIds.add(id);
  return id;
}

function makeAdHocThreadWithArtifact(artifactBody: string): ThreadRecord {
  const anyAgent = listAgents()[0];
  assert.ok(anyAgent, 'loadConfig should populate at least one agent');
  const thread = createThread(`C-abort-${Math.random().toString(36).slice(2, 8)}`, {
    agentName: anyAgent.name,
    userMessage: 'x',
    userMessageTs: 'ts',
  });
  trackThreadId(thread.id);
  fs.writeFileSync(thread.artifactPath, artifactBody);
  return thread;
}

// --- detectAbortMarker ---

test('detectAbortMarker returns aborted=false when artifact has no marker', () => {
  const thread = makeAdHocThreadWithArtifact('normal output without any abort signal.\n');
  const result = detectAbortMarker(thread.id);
  assert.equal(result.aborted, false);
  assert.equal(result.reason, null);
});

test('detectAbortMarker returns aborted=false for missing / unknown thread id', () => {
  const result = detectAbortMarker('thr_does-not-exist-' + Date.now());
  assert.equal(result.aborted, false);
  assert.equal(result.reason, null);
});

test('detectAbortMarker returns aborted=false when artifact is empty', () => {
  const thread = makeAdHocThreadWithArtifact('');
  const result = detectAbortMarker(thread.id);
  assert.equal(result.aborted, false);
  assert.equal(result.reason, null);
});

test('detectAbortMarker recognises bare [ABORT] with no reason', () => {
  const thread = makeAdHocThreadWithArtifact('some output\n[ABORT]\n');
  const result = detectAbortMarker(thread.id);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, null);
});

test('detectAbortMarker extracts trimmed reason from [ABORT: <reason>]', () => {
  const thread = makeAdHocThreadWithArtifact('progress...\n\n[ABORT:   stuck on unresolvable dep  ]\n');
  const result = detectAbortMarker(thread.id);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, 'stuck on unresolvable dep');
});

test('detectAbortMarker returns reason=null when reason body is only whitespace', () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT:   ]\n');
  const result = detectAbortMarker(thread.id);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, null);
});

test('detectAbortMarker matches marker inline (not only at line start)', () => {
  const thread = makeAdHocThreadWithArtifact('mid-line finale: [ABORT: blocker] trailing.\n');
  const result = detectAbortMarker(thread.id);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, 'blocker');
});

test('detectAbortMarker stops at the closing bracket — reason does not span newline', () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT: first reason\ncontinued unrelated content]');
  const result = detectAbortMarker(thread.id);
  // Regex character class is [^\]\n], so the literal newline ends matching before any ']' is found.
  // Therefore no closing bracket is captured — the whole construct is not a marker.
  assert.equal(result.aborted, false);
});

test('detectAbortMarker picks the first marker when multiple present', () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT: first] more text [ABORT: second]\n');
  const result = detectAbortMarker(thread.id);
  assert.equal(result.aborted, true);
  assert.equal(result.reason, 'first');
});

// --- abortThread ---

test('abortThread transitions running thread to aborted + records reason + sets endedAt', async () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT: test case 1]\n');
  const ok = await abortThread(thread.id, 'test case 1');
  assert.equal(ok, true);

  const updated = threadStore.get(thread.id)!;
  assert.equal(updated.status, 'aborted');
  assert.equal(updated.abortReason, 'test case 1');
  assert.ok(updated.endedAt, 'endedAt should be set');
  assert.equal(updated.error, null, 'error should remain null — abort is not a failure');
});

test('abortThread with null reason leaves abortReason as null', async () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT]\n');
  const ok = await abortThread(thread.id, null);
  assert.equal(ok, true);

  const updated = threadStore.get(thread.id)!;
  assert.equal(updated.status, 'aborted');
  assert.equal(updated.abortReason, null);
});

test('abortThread is idempotent — second call returns false and does not mutate', async () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT: once]\n');
  assert.equal(await abortThread(thread.id, 'once'), true);
  const firstEndedAt = threadStore.get(thread.id)!.endedAt;

  // Second call on an already-aborted thread returns false.
  assert.equal(await abortThread(thread.id, 'twice'), false);
  const updated = threadStore.get(thread.id)!;
  assert.equal(updated.abortReason, 'once', 'abortReason should not be overwritten');
  assert.equal(updated.endedAt, firstEndedAt, 'endedAt should not be overwritten');
});

test('abortThread returns false for unknown thread id', async () => {
  assert.equal(await abortThread('thr_nope-' + Date.now(), 'x'), false);
});

test('abortThread returns false after cancelThread has terminated the thread (cancelled wins)', async () => {
  const thread = makeAdHocThreadWithArtifact('(nothing yet)\n');
  assert.equal(await cancelThread(thread.id), true);
  assert.equal(threadStore.get(thread.id)!.status, 'cancelled');
  // First-to-terminate wins: abort attempted afterwards is a no-op.
  assert.equal(await abortThread(thread.id, 'late abort'), false);
  assert.equal(threadStore.get(thread.id)!.status, 'cancelled');
  assert.equal(threadStore.get(thread.id)!.abortReason, null);
});

test('cancelThread returns false after abortThread has terminated the thread (aborted wins)', async () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT: first]\n');
  assert.equal(await abortThread(thread.id, 'first'), true);
  assert.equal(await cancelThread(thread.id), false);
  assert.equal(threadStore.get(thread.id)!.status, 'aborted');
});

// --- finalizeAbortedThread: block owning task BEFORE onEnd (DR-0015 problem 2) ---

test('finalizeAbortedThread aborts the thread then invokes onAbort with the owning task + reason', async () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT: too-big]\n');
  const calls: Array<{ taskId: string; project: string | null; reason: string | null }> = [];
  await finalizeAbortedThread(
    thread.id,
    { taskId: 'abcd', taskProject: 'proj' } as any,
    'too-big',
    { onAbort: async (info) => { calls.push(info); } } as any,
  );
  assert.equal(threadStore.get(thread.id)!.status, 'aborted');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { taskId: 'abcd', project: 'proj', reason: 'too-big' });
});

test('finalizeAbortedThread skips onAbort when metadata has no taskId (non-dispatch thread)', async () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT]\n');
  const calls: unknown[] = [];
  await finalizeAbortedThread(
    thread.id,
    { taskId: null, taskProject: null } as any,
    null,
    { onAbort: async (info) => { calls.push(info); } } as any,
  );
  assert.equal(threadStore.get(thread.id)!.status, 'aborted');
  assert.equal(calls.length, 0);
});

test('finalizeAbortedThread tolerates a missing onAbort callback', async () => {
  const thread = makeAdHocThreadWithArtifact('[ABORT: x]\n');
  await finalizeAbortedThread(thread.id, { taskId: 'efgh', taskProject: 'p' } as any, 'x', {} as any);
  assert.equal(threadStore.get(thread.id)!.status, 'aborted');
});

// --- buildThreadSummary rendering for aborted status ---

function minimalAbortedThread(reason: string | null, endedAt: string | null): ThreadRecord {
  return {
    id: 'thr_fake', templateName: null, status: 'aborted',
    channel: 'C1', projectId: 'general', platformThreadId: null,
    userMessage: '', userMessageTs: 'ts',
    workspacePath: '', artifactPath: '',
    agents: { main: { slotId: 'main', profile: '__active__', sessionId: null, sessionName: null, status: 'completed', lastOutput: null, persistSession: false } },
    activeAgent: 'main', activeStage: null, currentStepIndex: 1,
    steps: [{ stepIndex: 0, agentSlotId: 'main', stage: null, executionId: null, sessionId: null, sessionName: null, input: '', output: 'x', costUsd: 0, numTurns: 1, durationS: 1, startedAt: null, endedAt: null }],
    iterationCounts: {}, totalCostUsd: 0,
    createdAt: '2026-04-16T10:00:00Z', updatedAt: '2026-04-16T10:00:01Z',
    endedAt, error: null, abortReason: reason, metadata: null,
  };
}

test('buildThreadSummary renders stopped emoji for aborted status', () => {
  const thread = minimalAbortedThread('blocked on upstream', '2026-04-16T10:00:05Z');
  const summary = buildThreadSummary({ thread, finalOutput: null, totalCostUsd: 0, totalNumTurns: 0, lastAgentResult: null, executionId: null });
  assert.match(summary, /^🛑/);
  assert.match(summary, /Aborted: blocked on upstream/);
});

test('buildThreadSummary renders "Aborted (no reason given)" when abortReason is null', () => {
  const thread = minimalAbortedThread(null, '2026-04-16T10:00:05Z');
  const summary = buildThreadSummary({ thread, finalOutput: null, totalCostUsd: 0, totalNumTurns: 0, lastAgentResult: null, executionId: null });
  assert.match(summary, /Aborted \(no reason given\)/);
});

// --- THREAD_PROTOCOL_PREAMBLE injection into buildStepPrompt ---

test('THREAD_PROTOCOL_PREAMBLE mentions the [ABORT:] marker so agents can learn the convention from the injected text', () => {
  // Guards against accidental edits that drop the actual instruction.
  assert.match(THREAD_PROTOCOL_PREAMBLE, /\[ABORT: <reason>\]/);
  assert.match(THREAD_PROTOCOL_PREAMBLE, /Cortex Thread Protocol/);
});

test('THREAD_PROTOCOL_PREAMBLE teaches the [WAIT_CHILDREN] suspend protocol and acceptance discipline (DR-0014)', () => {
  assert.match(THREAD_PROTOCOL_PREAMBLE, /\[WAIT_CHILDREN\]/);
  assert.match(THREAD_PROTOCOL_PREAMBLE, /thread_start/);
  // Acceptance-before-trust: child results must be verified against the contract.
  assert.match(THREAD_PROTOCOL_PREAMBLE, /verif/i);
});

test('buildStepPrompt injects THREAD_PROTOCOL_PREAMBLE for ad-hoc thread with workspace artifact', () => {
  const anyAgent = listAgents()[0];
  const agentConfig = resolveAgentSlotConfig(anyAgent.name)!;
  const thread = createThread(`C-preamble-${Math.random().toString(36).slice(2, 8)}`, {
    agentName: anyAgent.name,
    userMessage: 'hello world',
    userMessageTs: 'ts',
  });
  trackThreadId(thread.id);

  const prompt = buildStepPrompt(thread.id, agentConfig);
  assert.ok(prompt.includes(THREAD_PROTOCOL_PREAMBLE), 'preamble should be auto-injected for artifact-owning thread');
});

test('buildStepPrompt does NOT inject preamble for a thread with no artifact path', () => {
  const anyAgent = listAgents()[0];
  const agentConfig = resolveAgentSlotConfig(anyAgent.name)!;
  const thread = createThread(`C-noart-${Math.random().toString(36).slice(2, 8)}`, {
    agentName: anyAgent.name,
    userMessage: 'hello',
    userMessageTs: 'ts',
  });
  trackThreadId(thread.id);

  // Clear the artifact path to simulate a thread without a workspace artifact.
  thread.artifactPath = '';
  threadStore.set(thread);

  assert.equal(threadStore.get(thread.id)!.artifactPath, '', 'thread should have no artifact path');
  const prompt = buildStepPrompt(thread.id, agentConfig);
  assert.equal(prompt.includes(THREAD_PROTOCOL_PREAMBLE), false, 'preamble should not fire without artifact');
});

test('buildStepPrompt skips preamble when resuming a persistent session (slot.sessionId set)', () => {
  const anyAgent = listAgents()[0];
  const agentConfig = { ...resolveAgentSlotConfig(anyAgent.name)!, persistSession: true };
  const thread = createThread(`C-resume-${Math.random().toString(36).slice(2, 8)}`, {
    agentName: anyAgent.name,
    userMessage: 'hi',
    userMessageTs: 'ts',
  });
  trackThreadId(thread.id);

  // First invocation (fresh session) injects the preamble.
  const firstPrompt = buildStepPrompt(thread.id, agentConfig);
  assert.ok(firstPrompt.includes(THREAD_PROTOCOL_PREAMBLE), 'first trigger should include preamble');

  // Simulate a running persistent session by setting slot.sessionId; subsequent calls should skip.
  const record = threadStore.get(thread.id)!;
  record.agents[agentConfig.slotId].sessionId = 'fake-session-uuid';
  threadStore.set(record);

  const resumedPrompt = buildStepPrompt(thread.id, agentConfig);
  assert.equal(resumedPrompt.includes(THREAD_PROTOCOL_PREAMBLE), false, 'resume should skip preamble (already delivered)');
});
