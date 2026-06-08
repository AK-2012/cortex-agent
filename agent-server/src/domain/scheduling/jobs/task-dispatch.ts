// input:  task-store, execution-registry, pending-task-tracker
// output: taskDispatchRunner job runner — registers as 'task-dispatch'
// pos:    programmatic task dispatch; provides cancelDispatchedTask for app.ts

import * as os from 'node:os';
import { register, ctx } from '../job-registry.js';
import { createLogger } from '@core/log.js';
import { Icons } from '../../../core/icons.js';
import * as executionRegistry from '../../executions/registry.js';

const log = createLogger('task-dispatch');
import * as pendingTaskTracker from '../../tasks/pending-tracker.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { getActiveProfile, getActiveBackend } from '../../agents/index.js';
import { allConfigsRateLimited } from '@domain/agents/facade.js';
import { selectAndClaimTask, computeNextInterval, updateScheduleInterval } from '../../tasks/dispatcher.js';
import { taskStore } from '../../tasks/store.js';
import { taskMutator } from '../../tasks/mutator.js';
import { createThread } from '../../threads/index.js';
import { runThread as runThreadExec } from '../../threads/runner.js';
import { buildUserProcessingMessage, computeElapsed, buildSessionTag } from '@core/status-format.js';
import { finalizeThreadSuccess } from './_shared.js';
import type { PlatformAdapter, MessageRef } from '@platform/index.js';
import { getOutboundQueue, durableUpdate, durablePost } from '@store/outbound-queue.js';

// --- Dispatch-failure quarantine ---

const DISPATCH_FAILURE_QUARANTINE_THRESHOLD = 3;
const dispatchFailureCounts = new Map<string, { count: number; lastError: string }>();

function sanitizeBlockReason(s: string): string {
  return String(s).replace(/[\r\n\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// --- Guards ---

// Max concurrent task dispatches. Resolution order:
//   1. TASK_DISPATCH_MAX_CONCURRENT env var (explicit override — used as-is if a positive int)
//   2. auto: max(4, os.cpus().length - 2) — scale to all-but-2 cores, floored at 4
function resolveMaxConcurrent(): number {
  const raw = process.env.TASK_DISPATCH_MAX_CONCURRENT;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      log.info(`Max concurrent dispatch = ${n} (from TASK_DISPATCH_MAX_CONCURRENT env)`);
      return n;
    }
    log.warn(`Invalid TASK_DISPATCH_MAX_CONCURRENT="${raw}" — falling back to auto`);
  }
  const cpus = os.cpus().length;
  const auto = Math.max(4, cpus - 2);
  log.info(`Max concurrent dispatch = ${auto} (auto: max(4, ${cpus} cpus - 2))`);
  return auto;
}

const TASK_DISPATCH_MAX_CONCURRENT = resolveMaxConcurrent();

function passDispatchGuards(): boolean {
  const runningExecutions = executionRegistry.getRunningExecutions();
  const runningDispatches = runningExecutions.filter(r => r.kind === 'dispatch').length;
  if (runningDispatches >= TASK_DISPATCH_MAX_CONCURRENT) {
    log.info(`Skipping — at concurrency limit (${runningDispatches}/${TASK_DISPATCH_MAX_CONCURRENT})`);
    return false;
  }
  return true;
}

// --- Public entry point (non-async fire-and-forget) ---

export function taskDispatchRunner({ channel, scheduleTaskId, profileName }: { channel: string; scheduleTaskId: string; profileName: string }): void {
  if (!passDispatchGuards()) return;

  ctx.bus!.publish({ type: 'llm.active-count-delta', delta: 1 });
  runDispatchAsync({ channel, scheduleTaskId, profileName }).finally(() => {
    ctx.bus!.publish({ type: 'llm.active-count-delta', delta: -1 });
  });
}

// --- Async implementation ---

async function runDispatchAsync({ channel, scheduleTaskId, profileName }: { channel: string; scheduleTaskId: string; profileName: string }): Promise<void> {
  const startTime = Date.now();
  let selectedTask: Record<string, any> | null = null;
  let outcome: { success: boolean; skipped: boolean; note: string } = { success: false, skipped: false, note: '' };

  try {
    // Step 1: Dry run — check there is a dispatchable task without claiming
    const preview = await selectAndClaimTask({ scheduleTaskId, dryRun: true });
    if (!preview) {
      outcome = { success: false, skipped: true, note: 'No dispatchable tasks available' };
      return;
    }

    // Step 2: Check rate limits using the scheduler-resolved profile
    if (allConfigsRateLimited(profileName)) {
      outcome = { success: false, skipped: true, note: `All configs rate-limited for ${profileName}` };
      return;
    }

    // Step 3: Real claim + execute
    const selected = await selectAndClaimTask({ scheduleTaskId });
    if (!selected) {
      outcome = { success: false, skipped: true, note: 'No dispatchable tasks available' };
      return;
    }
    selectedTask = selected.task;
    ctx.bus!.publish({ type: 'task.claimed', taskId: selectedTask.id, by: 'task-dispatcher' });
    ctx.bus!.publish({ type: 'task.dispatched', taskId: selectedTask.id, machine: 'local' });
    outcome = await executeDispatchTask({ selected, selectedTask: selectedTask!, channel, scheduleTaskId, profileName, startTime });
  } catch (error) {
    outcome = await handleDispatchError(error as Error, selectedTask, channel);
  } finally {
    if (ctx.schedulerRef) {
      try { await updateScheduleInterval(ctx.schedulerRef, scheduleTaskId, computeNextInterval(outcome)); } catch {}
    }
    log.info(`Cycle complete: ${outcome.note}`);
  }
}

async function executeDispatchTask({ selected, selectedTask, channel, scheduleTaskId, profileName, startTime }: {
  selected: Record<string, any>; selectedTask: Record<string, any>; channel: string; scheduleTaskId: string; profileName: string; startTime: number;
}): Promise<{ success: boolean; skipped: boolean; note: string }> {
  const adapter = ctx.adapter!;
  const sessionName = await sessionStore.generateSessionName();
  const effectiveProfile = profileName;

  let statusMsg: MessageRef | null = null;
  try {
    statusMsg = await adapter.postMessage({ type: 'project-report', projectId: selectedTask.project || channel, trigger: 'task-dispatch', sessionId: '' }, {
      text: `${Icons.satellite} Dispatching: [${selectedTask.project}] ${selectedTask.text.substring(0, 80)}... | ${sessionName} | ${effectiveProfile}`,
    });
  } catch {}

  if (!selected.template) {
    log.error(`Task [${selectedTask.project}] ${selectedTask.text.substring(0, 60)} missing required [template:] tag — skipping`);
    await taskMutator.unclaim(selectedTask.id);
    return { success: false, skipped: true, note: 'Task missing required [template:] tag' };
  }
  const thread = createThread(channel, {
    templateName: selected.template, userMessage: selected.prompt, userMessageTs: `dispatch_${Date.now()}`,
    platformThreadId: statusMsg?.messageId ?? null,
    projectId: selectedTask.project,
    metadata: { scheduleTaskId, trigger: 'task-dispatch', profileOverride: effectiveProfile },
  });

  const icb = ctx.buildInteractiveCallbacks?.(channel, null);
  const threadResult = await runThreadExec(thread.id, {
    adapter, channel: channel, threadAnchorId: statusMsg?.messageId || null, statusMsg, startTime,
    destination: { type: 'project-report', projectId: selectedTask.project || channel, trigger: 'task-dispatch', sessionId: '' },
    onToolUse: icb?.onToolUse ?? null, onPlanWritten: icb?.onPlanWritten ?? null, onAskUserQuestion: icb?.onAskUserQuestion ?? null,
    extraHooks: {
      onEnd: {
        command: 'node hooks/task-status-check.mjs',
        args: [selectedTask.project, selectedTask.id],
        timeout: 10000,
      },
    },
  });
  const result = threadResult.lastAgentResult as any;

  if (result?.rateLimited) {
    const { elapsedStr } = computeElapsed(startTime);
    await taskMutator.unclaim(selectedTask.id);
    if (statusMsg) {
      const text = `${Icons.warning} [${selectedTask.project}] ${selectedTask.text.substring(0, 80)} | ${buildSessionTag(sessionName, result?.sessionId)}Rate limited — all fallbacks exhausted (${elapsedStr})`;
      const queue = getOutboundQueue();
      if (queue) { await durableUpdate(queue, adapter, statusMsg, { text }); }
      else { await adapter.updateMessage(statusMsg, { text }); }
    }
    return { success: false, skipped: false, note: 'Rate limited — all fallbacks exhausted' };
  }
  await finalizeThreadSuccess(adapter, channel, statusMsg, {
    startTime, sessionName, result, threadResult, project: selectedTask.project, trigger: 'task-dispatch',
    label: selectedTask.text?.substring(0, 60) || null, sessionKind: 'scheduled' as 'scheduled' | 'local',
    statusPrefix: `Done: [${selectedTask.project}] ${selectedTask.text.substring(0, 80)}`,
  });
  if (selectedTask.id) {
    dispatchFailureCounts.delete(selectedTask.id);
    ctx.bus!.publish({ type: 'task.completed', taskId: selectedTask.id });
  }
  return { success: true, skipped: false, note: `Completed [${selectedTask.project}] ${selectedTask.text.substring(0, 60)}` };
}

async function handleDispatchError(error: Error, selectedTask: Record<string, any> | null, channel: string): Promise<{ success: boolean; skipped: boolean; note: string }> {
  const adapter = ctx.adapter!;
  log.error(`Error: ${error.message}`);
  if (selectedTask) {
    try { await taskMutator.unclaim(selectedTask.id); } catch (e) { log.error(`Failed to unclaim task: ${(e as Error).message}`); }
  }
  const errChannel = channel;
  let blocked = false;
  let blockReason: string | null = null;
  if (selectedTask?.task_hash) {
    const taskHash: string = selectedTask.id;
    const prev = dispatchFailureCounts.get(taskHash) || { count: 0, lastError: '' };
    const next = { count: prev.count + 1, lastError: error.message };
    dispatchFailureCounts.set(taskHash, next);
    if (next.count >= DISPATCH_FAILURE_QUARANTINE_THRESHOLD) {
      blockReason = sanitizeBlockReason(`dispatch-failed-${next.count}x: ${error.message}`);
      try {
        await taskMutator.block(taskHash, blockReason);
        blocked = true;
        dispatchFailureCounts.delete(taskHash);
      } catch (e) {
        log.error(`Failed to auto-block task ${taskHash}: ${(e as Error).message}`);
      }
    }
  }
  try {
    const queue = getOutboundQueue();
    if (blocked && selectedTask) {
      const text = `${Icons.blocked} Auto-blocked after ${DISPATCH_FAILURE_QUARANTINE_THRESHOLD} consecutive dispatch failures. Reason recorded in TASKS.yaml. Task: [${selectedTask.project}] ${String(selectedTask.text).substring(0, 80)}. Last error: ${error.message}. Unblock with \`cortex-task unblock --task-id ${selectedTask.id}\`.`;
      const projDest = { type: 'project-report' as const, projectId: selectedTask.project || errChannel, trigger: 'task-dispatch', sessionId: '' };
      if (queue) { await durablePost(queue, adapter, projDest, { text }); }
      else { await adapter.postMessage(projDest, { text }); }
    } else {
      const text = `${Icons.error} Task dispatch error: ${error.message}`;
      const projDest = { type: 'project-report' as const, projectId: selectedTask?.project || errChannel, trigger: 'task-dispatch', sessionId: '' };
      if (queue) { await durablePost(queue, adapter, projDest, { text }); }
      else { await adapter.postMessage(projDest, { text }); }
    }
  } catch {}
  const noteSuffix = blocked ? ' (blocked)' : '';
  return { success: false, skipped: false, note: `Error: ${error.message}${noteSuffix}` };
}

// --- Cancel dispatched task ---

export async function cancelDispatchedTask({ taskId, channel }: { taskId: string; channel: string }): Promise<{ ok: boolean; message: string }> {
  try {
    executionRegistry.cancelExecutionByTaskId(taskId);
    pendingTaskTracker.clearTask(taskId);
    return { ok: true, message: `${Icons.stopped} Cancelled task [${taskId}].` };
  } catch (error) {
    return { ok: false, message: `Failed to cancel \`${taskId}\`: ${(error as Error).message}` };
  }
}

// Self-register
register('task-dispatch', async (payload: unknown) => {
  const p = payload as { channel: string; scheduleTaskId: string; profileName: string };
  taskDispatchRunner(p);
});
