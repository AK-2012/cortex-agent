// input:  mode-manager, agent-lifecycle, orch/channel-queue, orch/busy-tracker, orch/active-agents
// output: AgentRunner — wraps executeDefaultAgent + launchDefaultAgent lifecycle [S8]
// pos:    orch/ — sole default-agent execution path
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import type { PlatformAdapter, MessageRef, DownloadedFile, IncomingMessage, PlatformFileRef, VirtualMessage } from '@platform/index.js';
import type { AgentResult } from '@core/types/agent-types.js';
import type { ThreadRunResult } from '@domain/threads/runner.js';
import { channelQueues, enqueue } from './channel-queue.js';
import { trackPendingTask } from './busy-tracker.js';
import { getSessionAsync } from '@domain/sessions/session.js';
import { sessionRegistryRepo } from '@store/session-registry-repo.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import { getActiveProfile, getDefaultAgent, resolveBackendForChannel } from '@domain/agents/index.js';
import { handleAgentSuccess, handleAgentError, initTurnTracking } from './lifecycle.js';
import { buildSessionTag, buildUserProcessingMessage, makeFallbackNotifier, makeStreamingMessageCallback, computeElapsed, writeStatus, sealStatus, buildStatusActionBlocks, buildSealedStatusActionBlocks, initStatusBlocks } from './status-helpers.js';
import { readFileSync } from 'fs';
import { createLogger } from '@core/log.js';
import { getOutboundQueue } from '@store/outbound-queue.js';
import { buildDurableHooks } from './durable-helpers.js';

const log = createLogger('agent-runner');
import { createToolTrace } from '@platform/index.js';
import { setStreamingCallback, clearStreamingCallback, publishPlanSubmitted, publishAskUserRequested } from './routing/hook-bridge.js';
import { maybeNotifyCodexLowUsage } from '@domain/costs/codex-usage-monitor.js';
import { detectProject } from '@domain/costs/cost-tracker.js';
import { getAgent, createDefaultThread } from '@domain/threads/index.js';
import { runThread } from '@domain/threads/runner.js';
import { downloadFiles as downloadPlatformFiles } from './routing/file-handler.js';
import { WORKSPACE_DIR } from '@core/utils.js';

const TEMP_DIR = WORKSPACE_DIR;

type Enqueuer = (channel: string, fn: () => Promise<void>) => boolean;
type Tracker = (delta: number) => void;
type Executor = (ctx: AgentRunnerCtx) => Promise<void>;

interface AgentConfig {
  effectiveMessage: string;
  profileForRun: string;
  defaultAgentName: string | null;
  claudeAgent: string | null;
  systemPrompt: string | null;
  outputStyle: string | null;
  tools: string | null;
  pluginDirs: string[] | null;
}

interface AgentCallbacks {
  onFallback: (...args: any[]) => Promise<void>;
  onAssistantMsg: ((text: string) => void) & { vm?: VirtualMessage };
  onProgress: (progress: any) => void;
  onToolUse: ((name: string, input: any) => void) | null;
}

export interface AgentRunnerCtx {
  message: IncomingMessage;
  channel: string;
  adapter: PlatformAdapter;
  threadTs: string | null;
  hasFiles: boolean;
  userMessage: string;
  agentMessage: string;
}

export class AgentRunner {
  readonly _enqueue: Enqueuer;
  readonly _track: Tracker;
  /** Injectable for unit tests — allows verification of track(-1)-in-finally without spawning Claude. */
  readonly _execute: Executor;

  constructor(opts: { enqueue?: Enqueuer; track?: Tracker; execute?: Executor } = {}) {
    this._enqueue = opts.enqueue ?? enqueue;
    this._track = opts.track ?? trackPendingTask;
    this._execute = opts.execute ?? ((ctx) => this._executeReal(ctx));
  }

  async route(ctx: AgentRunnerCtx): Promise<void> {
    const { message, channel, adapter } = ctx;
    if (channelQueues.has(channel)) {
      await adapter.addReaction({ channel, messageId: message.ref.messageId }, 'hourglass').catch(() => {});
    }
    this._track(+1);

    this._enqueue(channel, async () => {
      try {
        await this._execute(ctx);
      } finally {
        this._track(-1);
      }
    });
  }

  private async _executeReal(ctx: AgentRunnerCtx): Promise<void> {
    const { message, channel, adapter, threadTs, hasFiles, userMessage, agentMessage } = ctx;
    const downloadedFiles = await downloadFiles(message.files, hasFiles, adapter);
    const startTime = Date.now();
    const sessionId = await getSessionAsync(channel, resolveBackendForChannel(channel));
    const sessionName = await resolveSessionName(sessionId, channel, userMessage);

    // 1. Orchestration side effects (keep — ledger, status, hook-bridge)
    const statusText = buildUserProcessingMessage({ startTime, profileName: getActiveProfile(channel), sessionName, sessionId });
    const blocksTemplate = { channel, sessionName, isDm: true };
    // Post status message WITHOUT Cancel button initially — Cancel is added after
    // createDefaultThread gives us a threadId (A3: execution-scoped Cancel).
    const statusMsg = await adapter.postMessage(channel, {
      text: statusText,
      richBlocks: buildSealedStatusActionBlocks(statusText, blocksTemplate),
    }, threadTs ? { threadId: threadTs } : undefined);
    const messageTs = message.ref.messageId;
    await initTurnTracking(channel, sessionId, sessionName, messageTs, userMessage || '', statusMsg.messageId);
    const onMessagePosted = (ref: MessageRef) => void conversationLedger.addResponseTs(channel, messageTs, ref.messageId).catch((e) => log.error(e));
    // 2. Resolve agent config and create default thread (BEFORE execution, replaces createAutoThread)
    const agentConfig = resolveDefaultAgent(agentMessage, channel);
    const thread = createDefaultThread(channel, {
      agentName: agentConfig.defaultAgentName || 'main',
      userMessage: agentMessage,
      userMessageTs: messageTs,
      platformThreadId: threadTs || statusMsg.messageId,
    });

    // 3. Update status message with Cancel button now that we have thread.id
    const blocksTemplateWithThread = { ...blocksTemplate, threadId: thread.id };
    await adapter.updateMessage(statusMsg, {
      text: statusText,
      richBlocks: buildStatusActionBlocks(statusText, blocksTemplateWithThread),
    }).catch(() => {});
    initStatusBlocks(statusMsg, blocksTemplateWithThread);

    // 4. Build agent callbacks (streaming, fallback, progress — passed to runThread)
    const callbacks = buildAgentCallbacks(adapter, channel, statusMsg, threadTs, startTime, sessionName, sessionId, onMessagePosted);

    // 5. Build PI interactive-event callbacks (plan approval / ask-user-question routing)
    const interactiveCallbacks = buildInteractiveCallbacks(channel, sessionId, thread.id);

    // 6. Call runThread instead of runAgent
    let result: AgentResult | undefined;
    try {
      const threadResult: ThreadRunResult = await runThread(thread.id, {
        adapter, channel,
        threadTs: threadTs || statusMsg.messageId,
        statusMsg, startTime,
        existingSessionId: sessionId,
        sessionName,
        files: downloadedFiles,
        onAssistantMessage: callbacks.onAssistantMsg,
        onProgress: callbacks.onProgress,
        onFallback: callbacks.onFallback,
        onToolUse: composeToolUse(callbacks.onToolUse, interactiveCallbacks.onToolUse),
        onPlanWritten: interactiveCallbacks.onPlanWritten,
        onAskUserQuestion: interactiveCallbacks.onAskUserQuestion,
        isUserInitiated: true,
      });
      result = threadResult.lastAgentResult;
      clearStreamingCallback(channel);
      await maybeNotifyCodexLowUsage({ adapter, channel, result });
      await handleDefaultAgentResult({
        result, channel, adapter, statusMsg, startTime, userMessage,
        executionId: threadResult.executionId,
        sessionName, sessionId, threadTs, messageTs, callbacks,
      });
    } catch (error) {
      clearStreamingCallback(channel);
      await handleAgentError({
        error: error as { message: string; cancelled?: boolean },
        channel, adapter, statusMsg, startTime,
        executionId: null,
        sessionName, sessionId, threadTs, userMessageTs: messageTs,
      });
    }
  }
}

export const agentRunner = new AgentRunner();

// --- Helpers ---

/** Exposed for unit testing. */
export function resolveDefaultAgent(agentMessage: string, channel?: string): AgentConfig {
  const defaultAgentName = getDefaultAgent();
  const defaultAgentDef = defaultAgentName ? getAgent(defaultAgentName) : null;
  const profileForRun = (defaultAgentDef && defaultAgentDef.profile !== '__active__')
    ? defaultAgentDef.profile
    : getActiveProfile(channel);
  let effectiveMessage = agentMessage;
  if (defaultAgentDef?.directive) {
    effectiveMessage = defaultAgentDef.directive + '\n\n' + agentMessage;
  }
  return {
    effectiveMessage, profileForRun, defaultAgentName,
    claudeAgent: defaultAgentDef?.claudeAgent || null,
    systemPrompt: defaultAgentDef?.systemPrompt || null,
    outputStyle: defaultAgentDef?.outputStyle || null,
    tools: defaultAgentDef?.tools || null,
    pluginDirs: defaultAgentDef?.pluginDirs || null,
  };
}

async function handleDefaultAgentResult({ result, channel, adapter, statusMsg, startTime, userMessage, executionId, sessionName, sessionId, threadTs, messageTs, callbacks }: {
  result: AgentResult; channel: string; adapter: PlatformAdapter; statusMsg: MessageRef; startTime: number;
  userMessage: string; executionId: string | null; sessionName: string; sessionId: string | null;
  threadTs: string | null; messageTs: string; callbacks: AgentCallbacks;
}): Promise<void> {
  if (result?.rateLimited) {
    const { elapsedStr } = computeElapsed(startTime);
    const fallbackText = `:warning: ${buildSessionTag(sessionName, sessionId)}Rate limited — all fallbacks exhausted (${elapsedStr}s)`;
    await sealStatus(adapter, statusMsg, fallbackText, buildSealedStatusActionBlocks(fallbackText, { channel, sessionName, isDm: true }));
    return;
  }
  await handleAgentSuccess({ result, channel, adapter, statusMsg, startTime, userMessage, executionId, trigger: 'user', sessionName, threadTs, userMessageTs: messageTs, onAssistantMessage: callbacks.onAssistantMsg });
  // NOTE: createAutoThread removed — thread was created pre-execution via createDefaultThread
}

async function resolveSessionName(sessionId: string | null, channel: string, userMessage: string): Promise<string> {
  if (sessionId) {
    const existing = await sessionRegistryRepo.lookupBySessionId(sessionId);
    if (existing) return existing;
    const name = await sessionRegistryRepo.generateSessionName();
    await sessionRegistryRepo.registerSession(name, { sessionId, channel, backend: resolveBackendForChannel(channel), kind: 'local', label: userMessage?.substring(0, 60), profileName: getActiveProfile(channel), projectId: detectProject(userMessage) });
    return name;
  }
  return sessionRegistryRepo.generateSessionName();
}

function buildAgentCallbacks(adapter: PlatformAdapter, channel: string, statusMsg: MessageRef, threadTs: string | null, startTime: number, sessionName: string, sessionId: string | null, onMessagePosted: (ref: MessageRef) => void): AgentCallbacks {
  const onFallback = makeFallbackNotifier(channel, statusMsg, adapter);
  const queue = getOutboundQueue();
  const durable = queue ? buildDurableHooks(queue) : null;
  const baseAssistantMsg = makeStreamingMessageCallback(adapter, channel, threadTs, onMessagePosted, durable);

  // Tool trace: when CORTEX_SHOW_TOOL_CALLS is enabled, emit a compact per-tool Slack line
  // that merges consecutive same-tool calls and splits on different tool / assistant text.
  const toolTrace = createToolTrace(baseAssistantMsg.vm);
  const onAssistantMsg: AgentCallbacks['onAssistantMsg'] = toolTrace
    ? Object.assign((text: string) => { toolTrace.flush(); baseAssistantMsg(text); }, { vm: baseAssistantMsg.vm })
    : baseAssistantMsg;
  const onToolUse = toolTrace ? (name: string, input: any) => toolTrace.onToolUse(name, input) : null;

  setStreamingCallback(channel, onAssistantMsg);
  const onProgress = (progress: any) => {
    writeStatus(adapter, statusMsg, buildUserProcessingMessage({
      startTime,
      elapsed_s: progress?.duration_ms != null ? progress.duration_ms / 1000 : null,
      num_turns: progress?.num_turns ?? null,
      profileName: getActiveProfile(channel), sessionName, sessionId,
    }));
  };
  return { onFallback, onAssistantMsg, onProgress, onToolUse };
}

async function downloadFiles(files: PlatformFileRef[] | undefined, hasFiles: boolean, adapter: PlatformAdapter): Promise<DownloadedFile[]> {
  if (!hasFiles || !files) return [];
  return downloadPlatformFiles(files, adapter, TEMP_DIR);
}

/** Compose two optional onToolUse callbacks so both fire on each tool_use event. */
function composeToolUse(
  a: ((name: string, input: any) => void) | null,
  b: ((name: string, input: any) => void) | null,
): ((name: string, input: any) => void) | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return (name, input) => { a(name, input); b(name, input); };
}

/**
 * Build interactive callbacks for plan_written, ask_user_question, and tool_use events.
 * These fire during the turn (not after) and publish bus events so the existing
 * Slack interaction flow handles them.
 *
 * Exported so that all runThread call sites (thread-executor, scheduled-task,
 * task-dispatch) can wire these callbacks — without them, ask_user_question
 * events are silently dropped and the subprocess blocks forever.
 *
 * ORDERING INVARIANT: onToolUse fires synchronously before onAskUserQuestion
 * within the same event-loop tick (guaranteed by the PI adapter's sequential
 * event processing in event-parser.ts). The closure variables pendingAskInput
 * and pendingExitPlanMode rely on this ordering — onToolUse captures state
 * that onAskUserQuestion consumes. If the adapter ever processes events
 * asynchronously or out of order, this contract breaks silently.
 */
export function buildInteractiveCallbacks(channel: string, sessionId: string | null, threadId: string | null = null) {
  let pendingPlanContent: string | null = null;
  let pendingPlanPath: string | null = null;
  // Captured full tool input from tool_use event — used by onAskUserQuestion
  // so the Slack message gets the full Claude-style schema (header, options
  // with descriptions, multiSelect) instead of the degraded extension_ui_request data.
  let pendingAskInput: { questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }> } | null = null;

  const onPlanWritten = (event: { path: string; content: string; toolUseId: string }) => {
    pendingPlanContent = event.content;
    pendingPlanPath = event.path;
  };

  // Track pending exit_plan_mode so the subsequent confirm() ask_user_question
  // is correctly routed as plan approval even when plan_written didn't fire
  // (happens when the LLM skips writing to a known plan directory).
  let pendingExitPlanMode: { plan?: string } | null = null;

  // Capture full tool input when the LLM calls ask_user_question (before the
  // tool shim calls ctx.ui.input which only emits a degraded extension_ui_request).
  const onToolUse = (name: string, input: any) => {
    if (name === 'AskUserQuestion' || name === 'ask_user_question') {
      pendingAskInput = input;
    }
    if (name === 'ExitPlanMode' || name === 'exit_plan_mode') {
      pendingExitPlanMode = input || {};
    }
  };

  const onAskUserQuestion = (event: { toolUseId: string; questions: Array<{ question: string; options?: string[]; multi?: boolean }> }) => {
    const requestId = crypto.randomUUID();
    if (pendingPlanContent !== null || pendingExitPlanMode !== null) {
      // This ask_user_question is the confirm() from exit_plan_mode → treat as plan approval.
      // pendingPlanContent comes from plan_written event (Write to a plan directory);
      // pendingExitPlanMode comes from tool_use event (LLM called exit_plan_mode directly).
      let planContent = pendingPlanContent ?? pendingExitPlanMode?.plan ?? '';
      // When a plan file was written, read it for full content (args.plan is often just a summary).
      if (pendingPlanPath && planContent.length < 200) {
        try { const fc = readFileSync(pendingPlanPath, 'utf8'); if (fc.trim()) planContent = fc; } catch {}
      }
      publishPlanSubmitted(requestId, channel, sessionId ?? '', planContent, event.toolUseId, threadId);
      pendingPlanContent = null;
      pendingPlanPath = null;
      pendingExitPlanMode = null;
    } else {
      // Use captured tool input (Claude-style schema) if available; fall back
      // to the degraded extension_ui_request data for backward compatibility.
      let questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }>;
      if (pendingAskInput?.questions?.length) {
        questions = pendingAskInput.questions;
        pendingAskInput = null;
      } else {
        questions = event.questions.map((q) => ({
          question: q.question,
          options: q.options?.map((o) => ({ label: o, description: '' })) ?? [],
          multiSelect: false,
          header: q.question.substring(0, 12),
        }));
      }
      publishAskUserRequested(requestId, channel, sessionId ?? '', questions, event.toolUseId, threadId);
    }
  };

  return { onPlanWritten, onAskUserQuestion, onToolUse };
}
