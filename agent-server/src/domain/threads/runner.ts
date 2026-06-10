// input:  domain/threads, mode-manager, hook-runner, handles
// output: runThread / continueThread / resumeThread / buildThreadSummary
// pos:    runtime execution engine for the Thread system
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { threadStore } from '@store/thread-repo.js';
import {
  resolveNextStep,
  buildStepPrompt,
  recordStepResult,
  evaluateTransitions,
  completeThread,
  failThread,
  abortThread,
  detectAbortMarker,
  detectWaitMarker,
  tryEnterWaiting,
  isAdHocThread,
  getSessionKey,
  getTemplate,
  readArtifact,
  resolveSystemVars,
} from './index.js';
import { runAgent, getClaudeMode, getActiveBackend, getActiveProfile } from '../agents/index.js';
import { Icons } from '../../core/icons.js';
import { closeSessionsByPrefix } from '../agents/index.js';
import * as executionRegistry from '../executions/registry.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { formatDurationCompact } from '@core/utils.js';
import type { OutputStream } from '@platform/index.js';
import { runningExecutions } from '../../core/running-executions.js';
import type { RunningExecution } from '../../core/running-executions.js';
import { executeLifecycleHook } from './hook-runner.js';
import { createToolTrace } from '@platform/index.js';
import type {
  ThreadRecord,
  AgentSlotId,
  AgentSlotConfig,
  ThreadTemplate,
  RunThreadOptions,
} from '@core/types/thread-types.js';

// --- Result types ---

interface ThreadRunResult {
  thread: ThreadRecord;
  /** Final output from the last completed step (for Slack display) */
  finalOutput: string | null;
  /** Aggregated cost across all steps */
  totalCostUsd: number;
  /** Total number of turns across all steps */
  totalNumTurns: number;
  /** The result object from the last agent call (for backward compat with handleAgentSuccess) */
  lastAgentResult: any;
  /** The execution ID from the last completed step — used by handleAgentSuccess in the wrapper. */
  executionId: string | null;
}

// --- Internal context types ---

/** Outer-scope state shared across the whole runThread() lifecycle. */
interface ThreadContext {
  thread: ThreadRecord;
  template: ThreadTemplate | null;
  meta: ThreadRecord['metadata'];
  stream: OutputStream;
  lastAgentResult: any;
  totalNumTurns: number;
}

/** Per-step config built once by buildStepConfig — fully populated, no placeholders. */
interface StepContext {
  agentSlotId: AgentSlotId;
  agentConfig: AgentSlotConfig;
  isFirstStep: boolean;
  multiAgent: boolean;
  /** Stage this step runs. Null for single-stage agents (no `stages` map declared). */
  stage: string | null;
  prompt: string;
  sessionId: string | null;
  sessionKey: string | null;
  sessionName: string;
  profileName: string;
  execution: { id: string; [k: string]: any };
  /** Always set in buildStepConfig — never an empty placeholder. */
  stepStartTime: string;
}

/** Per-step callbacks resolved from opts/vm by setupStepCallbacks. */
interface StepCallbacks {
  onAssistantMessage: ((text: string) => void) | null | undefined;
  onProgress: ((progress: any) => void) | null;
  onToolUse: ((name: string, input: any) => void) | null;
}

type StepInfo = Pick<StepContext, 'agentSlotId' | 'agentConfig' | 'isFirstStep' | 'multiAgent' | 'stage'>;

/** Render `agent` or `agent:stage` for log/status display — matches the transition endpoint syntax
 *  used in thread-templates.json transitions. Falls back to bare agent name when stage is null. */
function formatAgentStageLabel(agentSlotId: AgentSlotId, stage: string | null): string {
  return stage ? `${agentSlotId}:${stage}` : agentSlotId;
}

/** Validate thread, load template/metadata, init the aggregating OutputStream. */
function initThreadContext(threadId: string, opts: RunThreadOptions): ThreadContext {
  const thread = threadStore.get(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  const template = thread.templateName ? (getTemplate(thread.templateName) || null) : null;
  // Aggregate agent output into an OutputStream. The caller supplies the Destination
  // (interactive-reply or project-report).
  // Pass the full statusMsg as anchorRef so CompositeAdapter can resolve a per-platform
  // thread anchor for each sub-stream (a Slack ts must not be used as a Feishu message_id).
  const stream = opts.adapter.openOutputStream(opts.destination, { threadId: opts.threadAnchorId, anchorRef: opts.statusMsg });
  return { thread, template, meta: thread.metadata, stream, lastAgentResult: null, totalNumTurns: 0 };
}

/** Resolve next step, post boundary notifications, update the status message.
 *  Returns null if the loop should break (cancelled, no next step). */
async function resolveAndNotifyStep(
  threadId: string,
  ctx: ThreadContext,
  opts: RunThreadOptions,
): Promise<StepInfo | null> {
  // Check if thread was cancelled externally
  const current = threadStore.get(threadId);
  if (!current || current.status === 'cancelled') return null;

  // Resolve the next step
  const nextStep = resolveNextStep(threadId);
  if (!nextStep) {
    await completeThread(threadId);
    return null;
  }

  const { agentSlotId, agentConfig, isFirstStep, stage } = nextStep;
  const threadRecord = threadStore.get(threadId)!;
  const multiAgent = Object.keys(threadRecord.agents).length > 1;
  const label = formatAgentStageLabel(agentSlotId, stage);

  // Post step boundary notification for multi-agent threads via OutputStream
  if (ctx.stream && multiAgent && !isFirstStep) {
    const prevStep = threadRecord.steps[threadRecord.steps.length - 1];
    const prevLabel = prevStep ? formatAgentStageLabel(prevStep.agentSlotId, prevStep.stage) : '?';
    ctx.stream.emitText(`${Icons.arrowRight} Step ${threadRecord.currentStepIndex + 1}: *${label}* starting (prev: ${prevLabel})`);
  }

  // Update status message (multi-agent thread format; skip if caller provides onProgress)
  if (ctx.stream && multiAgent && !opts.onProgress) {
    const elapsed = (Date.now() - opts.startTime) / 1000;
    const statusText = `${Icons.processing} Thread ${threadRecord.id.substring(0, 12)} | Step ${threadRecord.currentStepIndex + 1}: *${label}* | ${Icons.stopwatch} ${formatDurationCompact(elapsed)}`;
    try {
      if (opts.statusMsg) {
        await opts.adapter.updateMessage(opts.statusMsg, { text: statusText });
      }
    } catch {}
  }

  return { agentSlotId, agentConfig, isFirstStep, multiAgent, stage };
}

/** Build prompt, resolve session config, profile, register execution, generate session name + start time.
 *  Returns a fully-populated StepContext — no placeholder fields. */
async function buildStepConfig(
  threadId: string,
  stepInfo: StepInfo,
  ctx: ThreadContext,
  opts: RunThreadOptions,
): Promise<StepContext> {
  const { agentSlotId, agentConfig, isFirstStep, multiAgent, stage } = stepInfo;
  const slot = threadStore.get(threadId)!.agents[agentSlotId];

  // Build prompt for this step — pass the stage so stage-aware agents send their stage-specific
  // prompt (and, in incremental mode on session resume, skip directive + preamble + auto previousOutput).
  const prompt = buildStepPrompt(threadId, agentConfig, stage);

  // Determine session configuration — thread steps use a thread-scoped session key.
  const sessionKey = getSessionKey(threadId, agentSlotId);
  const sessionId = slot.persistSession ? slot.sessionId : null;

  // Resolve profile: agents with a hardcoded profile always use their own declaration.
  // metadata.profileOverride only applies to __active__ agents (default/main/scheduler-main),
  // letting scheduler/dispatch inject a concrete profile without overriding research-pipeline agents.
  const profileName = agentConfig.profile === '__active__'
    ? (ctx.meta?.profileOverride || getActiveProfile(opts.channel))
    : agentConfig.profile;

  // Register execution
  const executionKind = ctx.meta?.trigger === 'task-dispatch' ? 'dispatch'
    : ctx.meta?.trigger === 'scheduled' ? 'scheduled'
    : 'local';
  const executionTrigger = ctx.meta?.trigger || 'thread-step';
  const label = formatAgentStageLabel(agentSlotId, stage);
  const execution = executionRegistry.startLocalExecution({
    kind: executionKind,
    channel: opts.channel,
    project: threadStore.get(threadId)?.projectId ?? 'general',
    trigger: executionTrigger,
    backend: getActiveBackend(),
    billingMode: getClaudeMode(),
    sessionId,
    label: `[${label}] ${prompt.substring(0, 40)}`,
    scheduleTaskId: ctx.meta?.scheduleTaskId || null,
    threadId,
    agentSlotId,
  });

  return {
    agentSlotId, agentConfig, isFirstStep, multiAgent, stage,
    prompt, sessionId, sessionKey,
    sessionName: await sessionStore.generateSessionName(),
    profileName, execution,
    stepStartTime: new Date().toISOString(),
  };
}

/** Resolve onAssistantMessage/onProgress callbacks and mark slot as running.
 *  Returns the callbacks instead of mutating the StepContext. */
function setupStepCallbacks(
  threadId: string,
  stepCtx: StepContext,
  ctx: ThreadContext,
  opts: RunThreadOptions,
): StepCallbacks {
  const { agentSlotId, multiAgent, stage } = stepCtx;
  const threadRecord = threadStore.get(threadId)!;
  const slot = threadRecord.agents[agentSlotId];
  const stream = ctx.stream;
  const label = formatAgentStageLabel(agentSlotId, stage);

  // Aggregate assistant output into the thread-runner's OutputStream; prefix only for multi-agent.
  const slotPrefix = multiAgent ? `*[${label}]*` : null;
  const baseAssistantMessage = (text: string) => { stream.emitText(slotPrefix ? `${slotPrefix} ${text}` : text); };

  // Tool trace (env-gated): caller-supplied onToolUse takes precedence. Otherwise build one bound
  // to the runner's own stream.
  const callerOnToolUse = opts.onToolUse ?? null;
  const toolTrace = callerOnToolUse ? null : createToolTrace(stream, { slotPrefix });
  const onAssistantMessage = toolTrace
    ? (text: string) => { toolTrace.flush(); baseAssistantMessage(text); }
    : baseAssistantMessage;
  const onToolUse = callerOnToolUse
    ?? (toolTrace ? (name: string, input: any) => toolTrace.onToolUse(name, input) : null);

  // onProgress: caller override (e.g. scheduler's buildUserProcessingMessage) takes precedence;
  // fallback to thread-specific status format for multi-agent pipelines
  const onProgress = opts.onProgress
    || (multiAgent
      ? (progress: any) => {
          const elapsed = (Date.now() - opts.startTime) / 1000;
          if (opts.statusMsg) {
            opts.adapter.updateMessage(opts.statusMsg, {
              text: `${Icons.processing} Thread ${threadRecord.id.substring(0, 12)} | Step ${threadRecord.currentStepIndex + 1}: *${label}* (${progress?.num_turns || '?'} turns) | ${Icons.stopwatch} ${formatDurationCompact(elapsed)}`,
            }).catch(() => {});
          }
        }
      : null);

  // Mark agent slot as running
  slot.status = 'running';
  threadStore.set(threadRecord);

  return { onAssistantMessage, onProgress, onToolUse };
}

/** Run the agent, manage handle, await result; fail execution + rethrow on error.
 *  Returns the agent result. */
async function executeAndAwaitAgent(
  threadId: string,
  stepCtx: StepContext,
  callbacks: StepCallbacks,
  ctx: ThreadContext,
  opts: RunThreadOptions,
): Promise<any> {
  const { agentConfig, isFirstStep, prompt, sessionId, sessionKey, profileName, execution, stepStartTime } = stepCtx;
  const meta = ctx.meta;

  const handle = runAgent(prompt, {
    channel: opts.channel,
    executionId: execution.id,
    sessionId,
    sessionKey,
    files: isFirstStep ? (opts.files || []) : [],
    profileName,
    project: threadStore.get(threadId)?.projectId,
    trigger: meta?.trigger || undefined,
    threadId,
    threadDepth: meta?.depth ?? 0,
    useCoreMcp: true,
    sessionName: stepCtx.sessionName,
    claudeAgent: agentConfig.claudeAgent || null,
    systemPrompt: agentConfig.systemPrompt ? resolveSystemVars(agentConfig.systemPrompt) : null,
    outputStyle: agentConfig.outputStyle || null,
    tools: agentConfig.tools || null,
    pluginDirs: agentConfig.pluginDirs || null,
    onFallback: null,
    isUserInitiated: false,
    onAssistantMessage: callbacks.onAssistantMessage,
    onProgress: callbacks.onProgress,
    onToolUse: callbacks.onToolUse,
    onPlanWritten: opts.onPlanWritten ?? null,
    onAskUserQuestion: opts.onAskUserQuestion ?? null,
  });

  // Track handle for cancellation
  runningExecutions.register({
    threadId,
    channel: opts.channel,
    agentSlotId: stepCtx.agentSlotId,
    executionId: stepCtx.execution.id,
    kind: stepCtx.execution.kind,
    kill: () => handle.kill(),
    backend: getActiveBackend(),
    agentProcess: handle.agentProcess,
    sessionId: handle.sessionId,
  });

  try {
    // On success the registry entry stays live until recordStepOutcome tears it down
    // (so the agent.completed event fires there). On error we tear down here.
    return await handle.promise;
  } catch (agentError: any) {
    // Finalize execution as failed (persistent record + registry + agent.failed event)
    // so it doesn't stay stuck in 'running' and the dashboards see a balanced lifecycle.
    const failDurationS = (Date.now() - new Date(stepStartTime).getTime()) / 1000;
    executionRegistry.teardownExecution({
      executionId: execution.id,
      status: 'failed',
      durationS: failDurationS,
      error: { message: agentError?.message || 'Agent process error' },
    });
    throw agentError;
  }
}

/** Record step result, register session, finalize execution; update aggregate counters. */
async function recordStepOutcome(
  threadId: string,
  stepCtx: StepContext,
  result: any,
  ctx: ThreadContext,
  opts: RunThreadOptions,
): Promise<void> {
  const { agentSlotId, prompt, sessionName, execution, stepStartTime, stage } = stepCtx;
  ctx.lastAgentResult = result;

  // Record the step result
  const stepEndTime = new Date().toISOString();
  const stepDurationS = (new Date(stepEndTime).getTime() - new Date(stepStartTime).getTime()) / 1000;

  await recordStepResult(threadId, agentSlotId, {
    sessionId: result?.sessionId || null,
    sessionName,
    executionId: execution.id,
    input: prompt,
    startedAt: stepStartTime,
    output: result?.finalOutput || null,
    costUsd: result?.total_cost_usd || null,
    numTurns: result?.num_turns || null,
    durationS: stepDurationS,
    stage,
  });

  ctx.totalNumTurns += result?.num_turns || 0;

  // Register session
  const currentThread = threadStore.get(threadId);
  if (result?.sessionId && sessionName && currentThread) {
    await sessionStore.registerSession(sessionName, {
      sessionId: result.sessionId,
      channel: opts.channel,
      backend: getActiveBackend(),
      kind: 'local',
      label: `[${threadId}:${agentSlotId}]`,
      profileName: getActiveProfile(opts.channel),
      projectId: currentThread.projectId,
    });
  }

  // Finalize execution: persistent record + registry teardown + balanced agent.* event.
  if (result?.rateLimited) {
    executionRegistry.teardownExecution({
      executionId: execution.id, status: 'failed', durationS: stepDurationS,
      error: { message: 'Rate limited' },
    });
  } else {
    executionRegistry.teardownExecution({
      executionId: execution.id, status: 'completed', durationS: stepDurationS, result,
    });
  }
}

/** Decide whether the loop continues; run onTransition hook when transitioning.
 *  Returns false to break the loop. */
async function evaluateAndTransition(
  threadId: string,
  stepCtx: StepContext,
  ctx: ThreadContext,
  opts: RunThreadOptions,
): Promise<boolean> {
  // Ad-hoc threads: run one agent per invocation, then stop
  if (isAdHocThread(threadId)) return false;

  // Evaluate transitions for template-based multi-agent
  const transition = evaluateTransitions(threadId);
  if (!transition.shouldTransition) return false;
  // transition.nextAgent / nextStage are already set on the thread by evaluateTransitions

  // --- onTransition hook (between steps) ---
  // Template hook first, then per-call extraHooks. executeLifecycleHook is a no-op for undefined
  // config so the second call costs nothing when the caller didn't inject an extra hook.
  const prevAgent = stepCtx.agentSlotId;
  const fromLabel = formatAgentStageLabel(prevAgent, stepCtx.stage);
  const toLabel = formatAgentStageLabel(transition.nextAgent!, transition.nextStage ?? null);
  const transitionLogSuffix = `(${fromLabel} → ${toLabel})`;
  await executeLifecycleHook(
    threadId,
    'transition',
    ctx.template?.hooks?.onTransition,
    opts,
    prevAgent,
    transitionLogSuffix,
  );
  await executeLifecycleHook(
    threadId,
    'transition',
    opts.extraHooks?.onTransition,
    opts,
    prevAgent,
    transitionLogSuffix,
  );
  return true;
}

/** Read final artifact, flush VM, build the run result. */
async function finalizeThread(threadId: string, ctx: ThreadContext): Promise<ThreadRunResult> {
  const finalThread = threadStore.get(threadId)!;

  // Final output comes from the artifact file
  const artifactContent = readArtifact(threadId);
  const finalOutput = artifactContent || ctx.lastAgentResult?.finalOutput || null;

  if (ctx.stream && finalOutput) {
    ctx.stream.emitText(finalOutput);
    await ctx.stream.flush();
  }

  return {
    thread: finalThread,
    finalOutput,
    totalCostUsd: finalThread.totalCostUsd,
    totalNumTurns: ctx.totalNumTurns,
    lastAgentResult: ctx.lastAgentResult,
    executionId: finalThread.steps[finalThread.steps.length - 1]?.executionId ?? null,
  };
}

async function runThread(threadId: string, opts: RunThreadOptions): Promise<ThreadRunResult> {
  const ctx = initThreadContext(threadId, opts);
  let enteredWaiting = false;

  try {
    // --- onStart hook (before first step) ---
    // Template hook first, then per-call extraHooks (see note at onTransition).
    await executeLifecycleHook(threadId, 'start', ctx.template?.hooks?.onStart, opts);
    await executeLifecycleHook(threadId, 'start', opts.extraHooks?.onStart, opts);

    while (true) {
      const stepInfo = await resolveAndNotifyStep(threadId, ctx, opts);
      if (!stepInfo) break;

      const stepCtx = await buildStepConfig(threadId, stepInfo, ctx, opts);
      const callbacks = setupStepCallbacks(threadId, stepCtx, ctx, opts);
      const result = await executeAndAwaitAgent(threadId, stepCtx, callbacks, ctx, opts);
      await recordStepOutcome(threadId, stepCtx, result, ctx, opts);

      // Agent-initiated abort: [ABORT] / [ABORT: <reason>] marker in artifact.
      // Global check, higher precedence than transitions. Loop exits → onEnd hook still fires.
      const abortCheck = detectAbortMarker(threadId);
      if (abortCheck.aborted) {
        await abortThread(threadId, abortCheck.reason);
        if (ctx.stream) {
          const reasonStr = abortCheck.reason ? `: ${abortCheck.reason}` : '';
          const abortLabel = formatAgentStageLabel(stepCtx.agentSlotId, stepCtx.stage);
          ctx.stream.emitText(`${Icons.stopped} Thread aborted by *${abortLabel}*${reasonStr}`);
        }
        break;
      }

      // Parent suspension (DR-0014): [WAIT_CHILDREN] marker in last step output / artifact.
      // Checked after abort, before transitions. Three outcomes:
      //  - live awaited children remain → thread enters 'waiting' (resumed by thread-callback
      //    when the last child turns terminal); skip onEnd — it fires once, at true termination.
      //  - all awaited children already terminal (callback won the race) and their results sit
      //    in pendingMessages → re-enter the loop immediately so the same agent processes them.
      //  - marker but nothing to wait on or process → fall through to normal transitions.
      if (detectWaitMarker(threadId)) {
        if (await tryEnterWaiting(threadId)) {
          enteredWaiting = true;
          const n = threadStore.get(threadId)?.metadata?.waitingOn?.length ?? 0;
          if (ctx.stream) ctx.stream.emitText(`${Icons.processing} Thread suspended — waiting on ${n} child thread(s)`);
          break;
        }
        const t = threadStore.get(threadId);
        if (t?.metadata?.pendingMessages?.length) continue;
      }

      if (!await evaluateAndTransition(threadId, stepCtx, ctx, opts)) break;
    }

    // --- onEnd hook (after main loop) ---
    // Template hook first, then per-call extraHooks (see note at onTransition).
    // Skipped on suspension: onEnd semantics are "thread truly finished" (e.g. the dispatch
    // task-status-check hook must not nag while children are still working). The re-entry
    // path re-runs runThread, so onEnd still fires exactly once at final termination.
    if (!enteredWaiting) {
      const threadForEnd = threadStore.get(threadId)!;
      const lastStep = threadForEnd.steps[threadForEnd.steps.length - 1];
      await executeLifecycleHook(threadId, 'end', ctx.template?.hooks?.onEnd, opts, lastStep?.agentSlotId);
      await executeLifecycleHook(threadId, 'end', opts.extraHooks?.onEnd, opts, lastStep?.agentSlotId);
    }

    // Only complete if not already in a terminal state (e.g. cancelled during loop)
    const threadBeforeComplete = threadStore.get(threadId);
    if (threadBeforeComplete && threadBeforeComplete.status === 'running') {
      await completeThread(threadId);
    }

  } catch (error: any) {
    const t = threadStore.get(threadId);
    if (t && t.status === 'running') {
      await failThread(threadId, error.message || 'Unknown error');
    }
    throw error;
  } finally {
    // Defensive: the per-step path finalizes each execution on success (recordStepOutcome) and on
    // error (executeAndAwaitAgent). If the loop threw AFTER an agent result but BEFORE the step was
    // finalized, the step's execution can still be registered and its persistent record still
    // 'running' — finalize it as failed across both ledgers so it neither leaks a 'running' record
    // nor poisons a dispatch slot. Scope to THIS thread's entries so a concurrent run on the same
    // channel is never touched.
    for (const e of runningExecutions.getByChannel(opts.channel)) {
      if (e.threadId !== threadId) continue;
      if (e.executionId) {
        executionRegistry.teardownExecution({ executionId: e.executionId, status: 'failed', durationS: 0, error: { message: 'thread ended before step finalized' } });
      } else {
        runningExecutions.remove(e.registryKey);
      }
    }
    // Cleanup thread-specific sessions. Intentionally also runs on suspension (DR-0014):
    // a waiting parent holds no live session — the artifact is its durable memory, and
    // persistSession slots keep their sessionId so re-entry resumes via --resume.
    closeSessionsByPrefix(`thr:${threadId}:`);
  }

  return finalizeThread(threadId, ctx);
}

// --- Continue an existing thread with new user input ---

async function continueThread(threadId: string, userMessage: string, opts: RunThreadOptions): Promise<ThreadRunResult> {
  const thread = threadStore.get(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  if (thread.status !== 'running' && thread.status !== 'waiting') {
    throw new Error(`Thread ${threadId} is ${thread.status}, cannot continue`);
  }

  // Update the thread's user message for the new input
  await threadStore.mutate(threadId, (t) => {
    t.userMessage = userMessage;
    t.status = 'running';
  });

  return runThread(threadId, opts);
}

// --- Resume a suspended parent thread (DR-0014) ---

/** Re-enter a parent thread that was suspended via [WAIT_CHILDREN]. Unlike continueThread,
 *  the userMessage is NOT overwritten — the original contract stays in {{input}}; the child
 *  results arrive through metadata.pendingMessages (injected by the prompt builder). */
async function resumeThread(threadId: string, opts: RunThreadOptions): Promise<ThreadRunResult> {
  const thread = threadStore.get(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  if (thread.status !== 'waiting') {
    throw new Error(`Thread ${threadId} is ${thread.status}, cannot resume`);
  }
  await threadStore.mutate(threadId, (t) => {
    t.status = 'running';
  });
  return runThread(threadId, opts);
}

// --- Thread summary for Slack ---

function buildThreadSummary(result: ThreadRunResult): string {
  const { thread, totalCostUsd, totalNumTurns } = result;
  const steps = thread.steps;
  const elapsed = thread.endedAt && thread.createdAt
    ? (new Date(thread.endedAt).getTime() - new Date(thread.createdAt).getTime()) / 1000
    : 0;

  const statusEmoji = thread.status === 'completed' ? Icons.ok
    : thread.status === 'cancelled' ? Icons.blocked
    : thread.status === 'aborted' ? Icons.stopped
    : thread.status === 'waiting' ? Icons.processing
    : Icons.error;

  const headline = thread.status === 'waiting'
    ? `${statusEmoji} Thread suspended — waiting on ${thread.metadata?.waitingOn?.length ?? 0} child thread(s) | ${steps.length} steps | $${totalCostUsd.toFixed(4)}`
    : `${statusEmoji} Thread complete | ${steps.length} steps | $${totalCostUsd.toFixed(4)} | ${formatDurationCompact(elapsed)}`;
  const lines = [headline];

  if (steps.length > 1) {
    for (const step of steps) {
      const costStr = step.costUsd != null ? `$${step.costUsd.toFixed(4)}` : '?';
      const turnsStr = step.numTurns != null ? `${step.numTurns} turns` : '?';
      const durStr = step.durationS != null ? formatDurationCompact(step.durationS) : '?';
      const label = formatAgentStageLabel(step.agentSlotId, step.stage);
      lines.push(`  ${label}: ${turnsStr} · ${costStr} · ${durStr}`);
    }
  }

  if (thread.abortReason) {
    lines.push(`Aborted: ${thread.abortReason}`);
  } else if (thread.status === 'aborted') {
    lines.push(`Aborted (no reason given)`);
  }
  if (thread.error) {
    lines.push(`Error: ${thread.error}`);
  }

  return lines.join('\n');
}

// Proxy functions to support existing callers that import cancelActiveThread / getActiveHandle from runner.ts.
// These delegate to the unified RunningExecutions singleton.
function cancelActiveThread(channel: string): boolean {
  return runningExecutions.killByChannel(channel) > 0;
}
function getActiveHandle(channel: string): RunningExecution | null {
  return runningExecutions.getByChannel(channel)[0] ?? null;
}

export {
  runThread,
  continueThread,
  resumeThread,
  buildThreadSummary,
  cancelActiveThread,
  getActiveHandle,
  // Internal helpers — exported to support focused unit tests from agent-server/tests/thread-runner.test.ts.
  // Not part of the public API; callers outside the test harness should continue to use runThread().
  initThreadContext,
  resolveAndNotifyStep,
  buildStepConfig,
  setupStepCallbacks,
  executeAndAwaitAgent,
  recordStepOutcome,
  evaluateAndTransition,
  finalizeThread,
};
export type { ThreadRunResult, ThreadContext, StepContext, StepCallbacks, StepInfo };
