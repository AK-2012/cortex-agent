// input:  PlatformAdapter, thread-runner, scheduler domain types
// output: runScheduledTask job runner — registers as 'scheduled-task'
// pos:    scheduled task execution (scheduled-task dispatchType), RunnerFn payload
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { register, ctx } from '../job-registry.js';
import { createLogger } from '@core/log.js';
import * as executionRegistry from '../../executions/registry.js';

const log = createLogger('scheduled-task');
import * as pendingTaskTracker from '../../tasks/pending-tracker.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { sessionRepo } from '@store/session-repo.js';
import { threadStore } from '@store/thread-repo.js';
import { getActiveProfile, getActiveBackend, getDefaultAgent } from '../../agents/index.js';
import { detectProject } from '../../costs/cost-tracker.js';
import { normalizeSkillCommandPrefix } from '../../memory/skill-scanner.js';
import { isValidDispatchPrompt, hasRunningExecutionForSchedule } from '../../tasks/dispatcher.js';
import { allConfigsRateLimited } from '../../agents/facade.js';
import { createThread, createDefaultThread } from '../../threads/index.js';
import { runThread as runThreadExec, continueThread } from '../../threads/runner.js';
import { maybeNotifyCodexLowUsage } from '../../costs/codex-usage-monitor.js';
import { buildUserProcessingMessage, computeElapsed, buildSessionTag } from '@core/status-format.js';
import { finalizeThreadSuccess, buildProgressUpdater } from './_shared.js';
import { planScheduledDispatch, type DispatchPlan } from './target-dispatch.js';
import type { PlatformAdapter, MessageRef } from '@platform/index.js';
import type { ScheduleTarget, ScheduleTask } from '@store/schedule-repo.js';
import { getOutboundQueue, durableUpdate, durablePost } from '@store/outbound-queue.js';

// Module-level state
const scheduledTaskActive = new Map<string, boolean>();

// --- Guards ---

function passScheduledGuards(schedKey: string, scheduleTaskId: string): boolean {
  const runningExecutions = executionRegistry.getRunningExecutions();
  if (scheduledTaskActive.has(schedKey) || hasRunningExecutionForSchedule(runningExecutions, scheduleTaskId)) {
    log.info(`Skipping — local agent still running for ${schedKey}`);
    return false;
  }
  const pending = pendingTaskTracker.getPendingTasksForSchedule(scheduleTaskId);
  if (pending.length > 0) {
    log.info(`Skipping — ${pending.length} pending task(s): ${pending.map(t => `${t.machine}:${t.taskId}`).join(', ')}`);
    return false;
  }
  return true;
}

// --- Public entry point (non-async fire-and-forget) ---

interface RunScheduledTaskInput {
  message: string;
  channel: string;
  scheduleTaskId: string;
  profileName: string;
  target?: ScheduleTarget;
  fallback?: ScheduleTask['fallback'];
}

export function runScheduledTask({ message, channel, scheduleTaskId, profileName, target, fallback }: RunScheduledTaskInput): void {
  const schedKey = `sched:${scheduleTaskId || channel}`;
  if (!passScheduledGuards(schedKey, scheduleTaskId)) return;

  const normalizedMessage = normalizeSkillCommandPrefix(message);
  if (normalizedMessage !== message) {
    log.info('Auto-prefixed skill command:', normalizedMessage.substring(0, 80));
  }

  if (!isValidDispatchPrompt(normalizedMessage)) {
    log.warn(`Guard dropped null/empty prompt for schedule ${scheduleTaskId} (channel=${channel}, profile=${profileName}): "${message?.substring(0, 60) || String(message)}"`);
    return;
  }

  if (allConfigsRateLimited(profileName)) {
    log.info(`Skipping schedule ${scheduleTaskId} — all configs rate-limited for profile ${profileName}`);
    return;
  }

  scheduledTaskActive.set(schedKey, true);
  ctx.bus!.publish({ type: 'llm.active-count-delta', delta: 1 });
  runScheduledTaskAsync({ normalizedMessage, message, channel, scheduleTaskId, profileName, target, fallback }).finally(() => {
    scheduledTaskActive.delete(schedKey);
    ctx.bus!.publish({ type: 'llm.active-count-delta', delta: -1 });
  });
}

// --- Plan resolution ---

async function resolveDispatchPlan(channel: string, target: ScheduleTarget | undefined, fallback: ScheduleTask['fallback']): Promise<DispatchPlan> {
  const backend = getActiveBackend();
  return planScheduledDispatch({
    target,
    fallback,
    fallbackChannel: channel,
    lookups: {
      findActiveThread: (ch) => threadStore.findActive(ch),
      getChannelSession: (ch) => sessionRepo.getSessionAsync(ch, backend),
      lookupSession: (name) => sessionStore.lookupSession(name),
      getThread: (id) => threadStore.get(id),
    },
  });
}

// --- Async implementation ---

async function runScheduledTaskAsync({ normalizedMessage, message, channel, scheduleTaskId, profileName, target, fallback }: RunScheduledTaskInput & { normalizedMessage: string }): Promise<void> {
  const startTime = Date.now();
  const effectiveProfile = profileName || getActiveProfile(channel) || 'default';
  const sessionName = await sessionStore.generateSessionName();
  const adapter = ctx.adapter!;

  const plan = await resolveDispatchPlan(channel, target, fallback);

  // Skip plans short-circuit before posting the processing status, so they don't pollute Slack.
  if (plan.kind === 'skip') {
    log.info(`Skipping schedule ${scheduleTaskId}: ${plan.reason}`);
    try { await adapter.postMessage(channel, { text: `:fast_forward: Scheduled task skipped — ${plan.reason}` }); } catch {}
    return;
  }

  let statusMsg: MessageRef | null = null;
  try {
    statusMsg = await adapter.postMessage(plan.channel, { text: buildUserProcessingMessage({ startTime, profileName: effectiveProfile, sessionName }) });
  } catch (e) {
    log.error('Failed to post status message:', (e as Error).message);
  }

  try {
    const threadResult = await dispatchByPlan({ plan, normalizedMessage, message, scheduleTaskId, effectiveProfile, statusMsg, startTime, sessionName });
    const result = threadResult.lastAgentResult as any;
    await maybeNotifyCodexLowUsage({ adapter, channel: plan.channel, result });

    if (result?.rateLimited) {
      const { elapsedStr } = computeElapsed(startTime);
      if (statusMsg) {
        const text = `:warning: ${buildSessionTag(sessionName, result?.sessionId)}Rate limited — all fallbacks exhausted (${elapsedStr}s)`;
        const queue = getOutboundQueue();
        if (queue) { await durableUpdate(queue, adapter, statusMsg, { text }); }
        else { await adapter.updateMessage(statusMsg, { text }); }
      }
    } else {
      await finalizeThreadSuccess(adapter, plan.channel, statusMsg, {
        startTime, sessionName, result, threadResult, project: detectProject(message), trigger: 'scheduled',
        label: message?.substring(0, 60) || null, sessionKind: 'scheduled', statusPrefix: 'Done',
      });
    }
  } catch (error) {
    const { elapsedStr } = computeElapsed(startTime);
    const queue = getOutboundQueue();
    if (statusMsg) {
      const text = `:x: ${buildSessionTag(sessionName, null)}Error (${elapsedStr}s)`;
      if (queue) { await durableUpdate(queue, adapter, statusMsg, { text }); }
      else { await adapter.updateMessage(statusMsg, { text }); }
    }
    try {
      if (queue) { await durablePost(queue, adapter, plan.channel, { text: `Scheduled task error: ${(error as Error).message}` }); }
      else { await adapter.postMessage(plan.channel, { text: `Scheduled task error: ${(error as Error).message}` }); }
    } catch {}
  }
}

// --- Plan execution ---

interface DispatchExecuteInput {
  plan: Exclude<DispatchPlan, { kind: 'skip' }>;
  normalizedMessage: string;
  message: string;
  scheduleTaskId: string;
  effectiveProfile: string;
  statusMsg: MessageRef | null;
  startTime: number;
  sessionName: string;
}

function dispatchByPlan({ plan, normalizedMessage, message, scheduleTaskId, effectiveProfile, statusMsg, startTime, sessionName }: DispatchExecuteInput) {
  const project = detectProject(message);
  const onProgress = statusMsg ? buildProgressUpdater(ctx.adapter!, plan.channel, statusMsg, startTime, effectiveProfile, sessionName) : undefined;
  const icb = ctx.buildInteractiveCallbacks?.(plan.channel, null);
  const baseRunOpts = {
    adapter: ctx.adapter!, channel: plan.channel, threadTs: statusMsg?.messageId || null, statusMsg, startTime, onProgress,
    onToolUse: icb?.onToolUse ?? null, onPlanWritten: icb?.onPlanWritten ?? null, onAskUserQuestion: icb?.onAskUserQuestion ?? null,
  };

  if (plan.kind === 'continue-thread') {
    return continueThread(plan.threadId, normalizedMessage, { ...baseRunOpts, existingSessionId: null });
  }

  if (plan.kind === 'default-thread') {
    const defaultAgent = getDefaultAgent() || 'main';
    const thread = createDefaultThread(plan.channel, {
      agentName: defaultAgent,
      userMessage: normalizedMessage,
      userMessageTs: `sched_${Date.now()}`,
      platformThreadId: statusMsg?.messageId || null,
    });
    // Default-thread metadata is unused by createDefaultThread today, so attach trigger / scheduleTaskId
    // post-creation so executionRegistry rows still carry the schedule association.
    threadStore.set({ ...thread, metadata: { scheduleTaskId, trigger: 'scheduled', project, profileOverride: effectiveProfile } });
    return runThreadExec(thread.id, { ...baseRunOpts, existingSessionId: plan.existingSessionId });
  }

  // plan.kind === 'fresh' — original scheduled-task semantics: scheduler template, fresh session.
  const thread = createThread(plan.channel, {
    templateName: 'scheduler',
    userMessage: normalizedMessage,
    userMessageTs: `sched_${Date.now()}`,
    metadata: { scheduleTaskId, trigger: 'scheduled', project, profileOverride: effectiveProfile },
  });
  return runThreadExec(thread.id, { ...baseRunOpts, existingSessionId: null });
}

// Self-register
register('scheduled-task', async (payload: unknown) => {
  const p = payload as RunScheduledTaskInput;
  runScheduledTask(p);
});
