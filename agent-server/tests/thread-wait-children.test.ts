// input:  Node test runner + state-machine wait/split markers + thread-repo startup semantics
// output: detectWaitMarker / tryEnterWaiting / detectSplitMarker / markRunningAsFailedOnStartup tests
// pos:    Verify parent-thread suspend/re-entry infrastructure (DR-0014 Phase 1/2)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { threadStore } from '../src/store/thread-repo.js';
import {
  detectWaitMarker,
  tryEnterWaiting,
  detectSplitMarker,
} from '../src/domain/threads/index.js';
import type { ThreadRecord, ThreadMetadata, ThreadStatus, AgentStep } from '../src/core/types/thread-types.js';

const createdThreadIds = new Set<string>();
const tmpDirs: string[] = [];
let seq = 0;

after(async () => {
  for (const id of createdThreadIds) await threadStore.delete(id);
  await threadStore.flush();
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function makeThread(over: Partial<ThreadRecord> = {}): ThreadRecord {
  const id = over.id ?? `thr_wait${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const rec: ThreadRecord = {
    id,
    templateName: null,
    status: 'running' as ThreadStatus,
    channel: 'C-wait-test',
    projectId: 'general',
    platformThreadId: null,
    userMessage: 'x',
    userMessageTs: 'ts',
    workspacePath: '',
    artifactPath: '',
    agents: {},
    activeAgent: 'main',
    activeStage: null,
    currentStepIndex: 0,
    steps: [],
    iterationCounts: {},
    totalCostUsd: 0,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    error: null,
    abortReason: null,
    metadata: null,
    ...over,
  };
  threadStore.set(rec);
  createdThreadIds.add(id);
  return rec;
}

function makeThreadWithArtifact(artifactBody: string, over: Partial<ThreadRecord> = {}): ThreadRecord {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thr-wait-'));
  tmpDirs.push(dir);
  const artifactPath = path.join(dir, 'artifact.md');
  fs.writeFileSync(artifactPath, artifactBody);
  return makeThread({ workspacePath: dir, artifactPath, ...over });
}

function step(output: string | null): AgentStep {
  return {
    stepIndex: 0, agentSlotId: 'main', stage: null, executionId: null,
    sessionId: null, sessionName: null, input: '', output,
    costUsd: 0, numTurns: 1, durationS: 1, startedAt: null, endedAt: null,
  };
}

// --- detectWaitMarker ---

test('detectWaitMarker returns false when neither artifact nor last step contains the marker', () => {
  const t = makeThreadWithArtifact('normal progress.\n', { steps: [step('done with step')] });
  assert.equal(detectWaitMarker(t.id), false);
});

test('detectWaitMarker returns false for unknown thread id', () => {
  assert.equal(detectWaitMarker('thr_nope_' + Date.now()), false);
});

test('detectWaitMarker detects [WAIT_CHILDREN] in the artifact', () => {
  const t = makeThreadWithArtifact('spawned two children\n[WAIT_CHILDREN]\n');
  assert.equal(detectWaitMarker(t.id), true);
});

test('detectWaitMarker detects [WAIT_CHILDREN] in the last step output when artifact lacks it', () => {
  const t = makeThreadWithArtifact('clean artifact\n', {
    steps: [step('spawned children, suspending now [WAIT_CHILDREN]')],
  });
  assert.equal(detectWaitMarker(t.id), true);
});

// --- tryEnterWaiting ---

test('tryEnterWaiting returns false when waitingOn is empty or missing', async () => {
  const t1 = makeThread();
  assert.equal(await tryEnterWaiting(t1.id), false);
  const t2 = makeThread({ metadata: { waitingOn: [] } as ThreadMetadata });
  assert.equal(await tryEnterWaiting(t2.id), false);
  assert.equal(threadStore.get(t2.id)!.status, 'running');
});

test('tryEnterWaiting enters waiting when a child is still active', async () => {
  const child = makeThread({ status: 'running' });
  const parent = makeThread({ metadata: { waitingOn: [child.id], childThreadIds: [child.id] } });
  assert.equal(await tryEnterWaiting(parent.id), true);
  const updated = threadStore.get(parent.id)!;
  assert.equal(updated.status, 'waiting');
  assert.deepEqual(updated.metadata!.waitingOn, [child.id]);
});

test('tryEnterWaiting filters out terminal and missing children before deciding', async () => {
  const done = makeThread({ status: 'completed' });
  const live = makeThread({ status: 'running' });
  const missingId = 'thr_purged_' + Date.now();
  const parent = makeThread({ metadata: { waitingOn: [done.id, live.id, missingId] } });
  assert.equal(await tryEnterWaiting(parent.id), true);
  const updated = threadStore.get(parent.id)!;
  assert.equal(updated.status, 'waiting');
  assert.deepEqual(updated.metadata!.waitingOn, [live.id]);
});

test('tryEnterWaiting returns false (and stays running) when all children are already terminal', async () => {
  const done = makeThread({ status: 'completed' });
  const failed = makeThread({ status: 'failed' });
  const parent = makeThread({ metadata: { waitingOn: [done.id, failed.id] } });
  assert.equal(await tryEnterWaiting(parent.id), false);
  const updated = threadStore.get(parent.id)!;
  assert.equal(updated.status, 'running');
  assert.deepEqual(updated.metadata!.waitingOn, []);
});

test('tryEnterWaiting returns false for unknown thread id', async () => {
  assert.equal(await tryEnterWaiting('thr_nope_' + Date.now()), false);
});

// --- detectSplitMarker ---

test('detectSplitMarker returns split=false when no marker present', () => {
  const t = makeThreadWithArtifact('just regular work\n');
  const r = detectSplitMarker(t.id);
  assert.equal(r.split, false);
  assert.equal(r.subtasks, null);
  assert.equal(r.error, null);
});

test('detectSplitMarker parses subtasks JSON from fenced block after the marker', () => {
  const body = [
    'analysis: this task is actually three independent units.',
    '[SPLIT]',
    '```json',
    JSON.stringify({ subtasks: [
      { key: 'a', text: 'do part A', 'done-when': 'A exists' },
      { key: 'b', text: 'do part B', depends_on: ['a'] },
    ] }),
    '```',
  ].join('\n');
  const t = makeThreadWithArtifact(body);
  const r = detectSplitMarker(t.id);
  assert.equal(r.split, true);
  assert.equal(r.error, null);
  assert.equal(r.subtasks!.length, 2);
  assert.equal(r.subtasks![0].text, 'do part A');
});

test('detectSplitMarker reports error when marker present but no JSON fence follows', () => {
  const t = makeThreadWithArtifact('[SPLIT]\nno json here\n');
  const r = detectSplitMarker(t.id);
  assert.equal(r.split, true);
  assert.equal(r.subtasks, null);
  assert.ok(r.error);
});

test('detectSplitMarker reports error on malformed JSON', () => {
  const t = makeThreadWithArtifact('[SPLIT]\n```json\n{ not valid json\n```\n');
  const r = detectSplitMarker(t.id);
  assert.equal(r.split, true);
  assert.equal(r.subtasks, null);
  assert.ok(r.error);
});

test('detectSplitMarker reports error when JSON lacks a subtasks array', () => {
  const t = makeThreadWithArtifact('[SPLIT]\n```json\n{"foo": 1}\n```\n');
  const r = detectSplitMarker(t.id);
  assert.equal(r.split, true);
  assert.equal(r.subtasks, null);
  assert.ok(r.error);
});

// --- markRunningAsFailedOnStartup: waiting-on-children survives restart ---

test('markRunningAsFailedOnStartup fails running threads but preserves waiting-on-children parents', async () => {
  const running = makeThread({ status: 'running' });
  const child = makeThread({ status: 'running' });
  const waitingParent = makeThread({ status: 'waiting', metadata: { waitingOn: [child.id] } });
  const plainWaiting = makeThread({ status: 'waiting', metadata: null });

  await threadStore.markRunningAsFailedOnStartup();

  assert.equal(threadStore.get(running.id)!.status, 'failed');
  assert.equal(threadStore.get(child.id)!.status, 'failed', 'in-flight children are interrupted by restart');
  assert.equal(threadStore.get(waitingParent.id)!.status, 'waiting', 'suspended parent must survive restart');
  assert.equal(threadStore.get(plainWaiting.id)!.status, 'failed', 'legacy waiting (no children) keeps old semantics');
});

// --- cleanup: stale waiting parents are failed as a leak safety net ---

test('cleanup marks over-age waiting threads as failed instead of leaking them forever', async () => {
  const child = makeThread({ status: 'running' });
  const stale = makeThread({ status: 'waiting', metadata: { waitingOn: [child.id] } });
  const fresh = makeThread({ status: 'waiting', metadata: { waitingOn: [child.id] } });
  // Backdate via the live record reference (set() would refresh updatedAt).
  threadStore.get(stale.id)!.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  await threadStore.cleanup();

  assert.equal(threadStore.get(stale.id)!.status, 'failed');
  assert.ok(/stale/i.test(threadStore.get(stale.id)!.error || ''));
  assert.equal(threadStore.get(fresh.id)!.status, 'waiting', 'recent waiting parent untouched');
});
