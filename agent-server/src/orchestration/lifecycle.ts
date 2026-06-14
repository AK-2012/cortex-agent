// input:  orch/busy-tracker(trackPendingTask), orch/channel-queue, orch/superseded-edits, orch/active-agents, orch/interactions/plan-approvals, status-helpers
// output: handleAgentSuccess/Error, reprocessMessage
// pos:    Agent runtime lifecycle handling (success/failure/approval/resume)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import { createLogger } from '@core/log.js';
import { Icons } from '../core/icons.js';
import { t } from '../core/i18n.js';
import type { Destination, PlatformAdapter, MessageRef } from '@platform/index.js';
import type { AgentResult } from '@core/types/agent-types.js';
import type { ExecutionRecord } from '@domain/executions/registry.js';
import { trackPendingTask } from './busy-tracker.js';
import { enqueue } from './conduit-queue.js';
import { supersededEdits } from './superseded-edits.js';
import { runningExecutions } from '../core/running-executions.js';

import { finalizeLocalExecution, buildSessionTag, buildUserProcessingMessage, makeFallbackNotifier, makeStreamingMessageCallback, computeElapsed, formatMetricsSuffix, writeStatus, sealStatus, buildStatusActionBlocks, buildSealedStatusActionBlocks, initStatusBlocks } from './status-helpers.js';
import { getSessionAsync, setSessionAsync } from '@domain/sessions/session.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import * as sessionBackup from '@domain/sessions/session-backup.js';
import { isOnMessageEndHookConfigured, runMessageEndSessionHook } from '@domain/sessions/session-hooks.js';
import * as executionRegistry from '@domain/executions/registry.js';
import * as askUserQuestion from './interactions/ask-user-question.js';
import { runAgent, getClaudeMode, getActiveProfile, resolveBackendForChannel } from '@domain/agents/index.js';
import { projectStore } from '@domain/projects/index.js';

import { setStreamingCallback, clearStreamingCallback } from './routing/hook-bridge.js';
import { maybeNotifyCodexLowUsage } from '@domain/costs/codex-usage-monitor.js';
import { normalizeSkillCommandPrefix } from '@domain/memory/skill-scanner.js';
import { getOutboundQueue } from '@store/outbound-queue.js';
import { buildDurableHooks, durablePost } from './durable-helpers.js';
import type { OutputStream } from '@platform/index.js';

const log = createLogger('lifecycle');

// --- Agent success handler ---

export async function handleAgentSuccess({ result, channel, adapter, statusMsg, startTime, userMessage, executionId, trigger = 'user', sessionName = null, threadAnchorId = null, userMessageTs = null, onAssistantMessage = null }: { result: AgentResult; channel: string; adapter: PlatformAdapter; statusMsg: MessageRef; startTime: number; userMessage: string; executionId: string | null; trigger?: string; sessionName?: string | null; threadAnchorId?: string | null; userMessageTs?: string | null; onAssistantMessage?: ((text: string) => void) | null }): Promise<void> {
  if (result?.sessionId) await setSessionAsync(channel, result.sessionId, resolveBackendForChannel(channel));

  await registerOrUpdateSession(result, sessionName, channel, trigger, projectStore.resolveFromMessage(userMessage)?.id ?? 'general');
  await backfillLedgerSessionId(result, channel);

  const { elapsedStr, elapsedS } = computeElapsed(startTime);
  finalizeLocalExecution({ executionId, status: 'completed', result, durationS: elapsedS });
  const metrics = formatMetricsSuffix({ costUsd: result?.total_cost_usd ?? null, numTurns: result?.num_turns ?? null });
  const sessionTag = buildSessionTag(sessionName, result?.sessionId);
  const stream = (onAssistantMessage as any)?.stream ?? null;
  const askCount = await askUserQuestion.sendMessages(result, channel, adapter, statusMsg.messageId, threadAnchorId, stream);
  const statusText = askCount > 0
    ? `${Icons.waiting} ${sessionTag}${t('status.waitingForUserInput')} (${elapsedStr}${metrics})`
    : `${Icons.ok} ${t('status.done')} | ${sessionTag}(${elapsedStr}${metrics})`;
  await sealStatus(adapter, statusMsg, statusText, buildSealedStatusActionBlocks(statusText, { channel, sessionName, isDm: true }));

  if (userMessageTs) {
    await conversationLedger.completeTurn(channel, userMessageTs, { executionId });
  }

  // Plan delivery is owned by the ExitPlanMode PreToolUse hook (hooks/exit-plan-mode-hook.mjs),
  // which forwards the plan through webhook /hook/exit-plan-mode → sendPlanToSlack.
  // Re-sending here would duplicate the plan message (and historically could
  // desync when the hook's mtime-based lookup picked a stale file).

  // onMessageEnd hook: extends the assistant turn's OutputStream so hook lines
  // (status/preview/error) and any injected agent turn share one continuous Slack
  // thread with the reply we just finished — no top-level leak, no detached stream.
  if (isOnMessageEndHookConfigured() && result?.sessionId) {
    const hookStream = (onAssistantMessage as any)?.stream as OutputStream | undefined;
    if (hookStream) {
      try {
        const conv = await conversationLedger.getConversation(channel);
        const profileName = conv?.profileName ?? null;
        await runMessageEndSessionHook({
          channel,
          sessionId: result.sessionId,
          sessionName: sessionName ?? '',
          executionId: executionId ?? '',
          profile: profileName,
          stream: hookStream,
        });
      } catch (err) {
        log.error('onMessageEnd hook failed:', (err as any)?.message || err);
      }
    } else {
      log.warn('onMessageEnd hook skipped: assistant stream unavailable on onAssistantMessage');
    }
  }
}

async function registerOrUpdateSession(result: AgentResult | null, sessionName: string | null, channel: string, trigger: string, projectId = 'general'): Promise<void> {
  if (!result?.sessionId || !sessionName) return;
  const existing = await sessionStore.lookupBySessionId(result.sessionId);
  if (!existing) {
    await sessionStore.registerSession(sessionName, {
      sessionId: result.sessionId, channel,
      backend: resolveBackendForChannel(channel),
      kind: trigger === 'scheduled' ? 'scheduled' : 'local',
      label: null,
      profileName: getActiveProfile(channel),
      projectId,
    });
  } else {
    await sessionStore.updateSession(existing, { lastUsedAt: new Date().toISOString() });
  }
}

async function backfillLedgerSessionId(result: { sessionId?: string | null }, channel: string): Promise<void> {
  if (!result?.sessionId) return;
  const conv = await conversationLedger.getConversation(channel);
  if (conv && !conv.sessionId) {
    await conversationLedger.updateSessionId(channel, result.sessionId);
  }
}

// --- Agent error handler ---

export async function handleAgentError({ error, channel, adapter, statusMsg, startTime, executionId, sessionName = null, sessionId = null, effectiveSessionId = null, threadAnchorId = null, userMessageTs = null }: { error: { message: string; cancelled?: boolean }; channel: string; adapter: PlatformAdapter; statusMsg: MessageRef; startTime: number; executionId: string | null; sessionName?: string | null; sessionId?: string | null; effectiveSessionId?: string | null; threadAnchorId?: string | null; userMessageTs?: string | null }): Promise<void> {
  if (executionId) runningExecutions.fail(executionId, error.message);
  const resolvedSessionId = effectiveSessionId || sessionId;
  const sessionTag = buildSessionTag(sessionName, resolvedSessionId);
  const { elapsedStr, elapsedS } = computeElapsed(startTime);

  if (error?.cancelled && supersededEdits.check(channel)) {
    supersededEdits.clear(channel);
    finalizeLocalExecution({ executionId, status: 'cancelled', error, durationS: elapsedS });
    const supersededText = `${Icons.superseded} ${sessionTag}${t('status.supersededByEdit')} (${elapsedStr})`;
    await sealStatus(adapter, statusMsg, supersededText, buildSealedStatusActionBlocks(supersededText, { channel, sessionName, isDm: true }));
    return;
  }

  await persistErrorSession(resolvedSessionId, sessionName, channel, adapter);
  if (userMessageTs) await conversationLedger.completeTurn(channel, userMessageTs, { executionId });

  if (error?.cancelled) {
    finalizeLocalExecution({ executionId, status: 'failed', error, durationS: elapsedS });
    const cancelledText = `${Icons.stopped} ${sessionTag}${t('status.cancelled')} (${elapsedStr})`;
    await sealStatus(adapter, statusMsg, cancelledText, buildSealedStatusActionBlocks(cancelledText, { channel, sessionName, isDm: true }));
    return;
  }

  log.error('Agent error:', error.message);
  finalizeLocalExecution({ executionId, status: 'failed', error, durationS: elapsedS });
  const errorText = `${Icons.error} ${sessionTag}${t('status.error')} (${elapsedStr})`;
  await sealStatus(adapter, statusMsg, errorText, buildSealedStatusActionBlocks(errorText, { channel, sessionName, isDm: true }));
  const errorDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: resolvedSessionId ?? '' };
  const queue = getOutboundQueue();
  if (queue) {
    await durablePost(queue, adapter, errorDest, { text: t('status.errorBody', { message: error.message }) }, threadAnchorId ? { threadId: threadAnchorId } : undefined);
  } else {
    await adapter.postMessage(errorDest, { text: t('status.errorBody', { message: error.message }) }, threadAnchorId ? { threadId: threadAnchorId } : undefined);
  }
}

async function persistErrorSession(resolvedSessionId: string | null, sessionName: string | null, channel: string, adapter: PlatformAdapter): Promise<void> {
  if (!resolvedSessionId) return;
  const backend = resolveBackendForChannel(channel);
  await setSessionAsync(channel, resolvedSessionId, backend);
  await backfillLedgerSessionId({ sessionId: resolvedSessionId }, channel);
  if (!sessionName) return;
  const existing = await sessionStore.lookupBySessionId(resolvedSessionId);
  if (!existing) {
    await sessionStore.registerSession(sessionName, { sessionId: resolvedSessionId, channel, backend, kind: 'local', profileName: getActiveProfile(channel), projectId: (await adapter.resolveInboundProject(channel)) ?? 'general' });
  }
}

// --- AskUserQuestion resume ---

export async function resumeAskUserQuestionGroup({ adapter, group, responseText }: { adapter: PlatformAdapter; group: { channel: string; sessionId: string; groupId: string; threadId?: string | null }; responseText: string }): Promise<void> {
  const askDest: Destination = { type: 'interactive-reply', conduit: group.channel, sessionId: group.sessionId };
  const statusMsg = await adapter.postMessage(askDest, { text: `${Icons.processing} ${t('status.processingAskResponse')}` });
  const startTime = Date.now();
  let executionId = null;
  let handle;
  try {
    const askBackend = resolveBackendForChannel(group.channel);
    const execution = executionRegistry.startLocalExecution({
      kind: 'local', channel: group.channel,
      project: projectStore.resolveFromMessage(responseText)?.id ?? 'general',
      trigger: 'ask-user-question',
      backend: askBackend, billingMode: getClaudeMode(),
      sessionId: group.sessionId, label: responseText,
    });
    executionId = execution.id;
    const askQueue = getOutboundQueue();
    const askDurable = askQueue ? buildDurableHooks(askQueue) : null;
    const onAssistantMsg = makeStreamingMessageCallback(adapter, askDest, null, null, askDurable);
    handle = runAgent(responseText, { channel: group.channel, sessionId: group.sessionId, files: [], project: projectStore.resolveFromMessage(responseText)?.id ?? 'general', trigger: 'ask-user-question', onAssistantMessage: onAssistantMsg });
    runningExecutions.register({ threadId: group.threadId ?? null, channel: group.channel, agentSlotId: null, executionId, kill: () => handle.kill(), backend: askBackend });
    const result = await handle.promise;
    runningExecutions.complete(executionId, result?.total_cost_usd ?? 0);
    await maybeNotifyCodexLowUsage({ adapter, result });
    await handleAgentSuccess({ result, channel: group.channel, adapter, statusMsg, startTime, userMessage: responseText, executionId, trigger: 'ask-user-question', onAssistantMessage: onAssistantMsg });
  } catch (error) {
    await handleAgentError({ error: error as { message: string; cancelled?: boolean }, channel: group.channel, adapter, statusMsg, startTime, executionId, effectiveSessionId: handle?.sessionId });
  } finally {
    askUserQuestion.deleteGroup(group.groupId);
  }
}

// --- Edit retry (reprocessMessage) ---

export function reprocessMessage(channel: string, text: string, adapter: PlatformAdapter, opts: { originalTs: string; isRetry: boolean; sessionId: string | null; sessionName: string | null; supersededStatusTimestamps?: string[] }): void {
  trackPendingTask(+1);
  enqueue(channel, async () => {
    try {
      await executeRetry(channel, text, adapter, opts);
    } finally {
      trackPendingTask(-1);
    }
  });
}

async function executeRetry(channel: string, text: string, adapter: PlatformAdapter, opts: { originalTs: string; isRetry: boolean; sessionId: string | null; sessionName: string | null; supersededStatusTimestamps?: string[] }): Promise<void> {
  const startTime = Date.now();
  const sessionId = opts.sessionId ?? await getSessionAsync(channel, resolveBackendForChannel(channel));
  const sessionName = opts.sessionName || await sessionStore.generateSessionName();
  const userMessageTs = opts.originalTs;
  const retryDest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: sessionId ?? '' };

  const retryPrefix = `${Icons.refresh} ${t('status.retry')} (${t('status.retryEdited')}) | `;
  const retryStatusText = retryPrefix + buildUserProcessingMessage({ startTime, profileName: getActiveProfile(channel), sessionName, sessionId });
  const retryBlocksTemplate = { channel, sessionName, isDm: true };
  const statusMsg = await adapter.postMessage(retryDest, {
    text: retryStatusText,
    richBlocks: buildStatusActionBlocks(retryStatusText, retryBlocksTemplate),
  });
  initStatusBlocks(statusMsg, retryBlocksTemplate);

  updateRetryPermalinks(adapter, channel, userMessageTs, statusMsg, opts.supersededStatusTimestamps, retryPrefix, startTime, sessionName, sessionId);
  await initTurnTracking(channel, sessionId, sessionName, userMessageTs, text, statusMsg.messageId);
  const onMessagePosted = (ref: MessageRef) => void conversationLedger.addResponseTs(channel, userMessageTs, ref.messageId).catch((e) => log.error(e));
  await runRetryAgent({ channel, text, adapter, statusMsg, startTime, sessionId, sessionName, userMessageTs, retryPrefix, onMessagePosted, retryDest });
}

async function runRetryAgent({ channel, text, adapter, statusMsg, startTime, sessionId, sessionName, userMessageTs, retryPrefix, onMessagePosted, retryDest }: { channel: string; text: string; adapter: PlatformAdapter; statusMsg: MessageRef; startTime: number; sessionId: string | null; sessionName: string | null; userMessageTs: string; retryPrefix: string; onMessagePosted: (ref: MessageRef) => void; retryDest: Destination }): Promise<void> {
  const agentMessage = normalizeSkillCommandPrefix(text || '');
  let executionId = null;
  let handle;
  try {
    const retryBackend = resolveBackendForChannel(channel);
    executionId = executionRegistry.startLocalExecution({
      kind: 'local', channel, project: projectStore.resolveFromMessage(text || '')?.id ?? 'general',
      trigger: 'edit-retry', backend: retryBackend, billingMode: getClaudeMode(), sessionId, label: agentMessage,
    }).id;
    const retryQueue = getOutboundQueue();
    const retryDurable = retryQueue ? buildDurableHooks(retryQueue) : null;
    const onAssistantMsg = makeStreamingMessageCallback(adapter, retryDest, null, onMessagePosted, retryDurable);
    setStreamingCallback(channel, onAssistantMsg);
    handle = runAgent(agentMessage, {
      channel, sessionId, files: [], profileName: getActiveProfile(channel),
      project: projectStore.resolveFromMessage(text || '')?.id ?? 'general', trigger: 'edit-retry',
      onFallback: makeFallbackNotifier(channel, statusMsg, adapter),
      isUserInitiated: true, onAssistantMessage: onAssistantMsg,
      onProgress: buildRetryProgressUpdater(adapter, channel, statusMsg, retryPrefix, startTime, sessionName, sessionId),
    });
    runningExecutions.register({ threadId: null /* A5: edit-retry — threadId not yet wired; Cancel button will warn */, channel, agentSlotId: null, executionId, kill: () => handle.kill(), backend: retryBackend });
    const result = await handle.promise;
    runningExecutions.complete(executionId, result?.total_cost_usd ?? 0);
    clearStreamingCallback(channel);
    await maybeNotifyCodexLowUsage({ adapter, result });

    if (result?.rateLimited) {
      const { elapsedStr } = computeElapsed(startTime);
      const rateLimitText = `${Icons.warning} ${buildSessionTag(sessionName, sessionId)}${t('status.rateLimitedExhausted')} (${elapsedStr})`;
      await sealStatus(adapter, statusMsg, rateLimitText, buildSealedStatusActionBlocks(rateLimitText, { channel, sessionName, isDm: true }));
    } else {
      await handleAgentSuccess({ result, channel, adapter, statusMsg, startTime, userMessage: text, executionId, trigger: 'edit-retry', sessionName, userMessageTs, onAssistantMessage: onAssistantMsg });
    }
  } catch (error) {
    clearStreamingCallback(channel);
    await handleAgentError({ error, channel, adapter, statusMsg, startTime, executionId, sessionName, sessionId, effectiveSessionId: handle?.sessionId, userMessageTs });
  }
}

function buildRetryProgressUpdater(adapter: PlatformAdapter, channel: string, statusMsg: MessageRef, retryPrefix: string, startTime: number, sessionName: string | null, sessionId: string | null) {
  return (progress: { duration_ms?: number | null; num_turns?: number | null } | null) => {
    writeStatus(adapter, statusMsg, retryPrefix + buildUserProcessingMessage({
      startTime, elapsed_s: progress?.duration_ms != null ? progress.duration_ms / 1000 : null,
      num_turns: progress?.num_turns ?? null,
      profileName: getActiveProfile(channel), sessionName, sessionId,
    }));
  };
}

// --- Internal helpers ---

function updateRetryPermalinks(adapter: PlatformAdapter, channel: string, userMessageTs: string, statusMsg: MessageRef, supersededTimestamps: string[] | undefined, retryPrefix: string, startTime: number, sessionName: string | null, sessionId: string | null): void {
  const userPermalinkP = adapter.getPermalink({ conduit: channel, messageId: userMessageTs }).catch(() => null);
  const statusPermalinkP = supersededTimestamps?.length
    ? adapter.getPermalink(statusMsg).catch(() => null)
    : Promise.resolve(null);

  Promise.all([userPermalinkP, statusPermalinkP]).then(([userPermalink, statusPermalink]) => {
    if (userPermalink) {
      writeStatus(adapter, statusMsg, `${Icons.refresh} ${t('status.retry')} (<${userPermalink}|${t('status.retryEdited')}>) | ` + buildUserProcessingMessage({ startTime, profileName: getActiveProfile(channel), sessionName, sessionId }));
    }
    if (statusPermalink && supersededTimestamps?.length) {
      for (const oldTs of supersededTimestamps) {
        adapter.updateMessage(
          { conduit: channel, messageId: oldTs },
          { text: `${Icons.superseded} ${t('status.supersededByEdit')} \u2014 <${statusPermalink}|${t('status.supersededSeeNewReply')}>` },
        ).catch(() => {});
      }
    }
  }).catch(() => {});
}

export async function initTurnTracking(channel: string, sessionId: string | null, sessionName: string | null, userMessageTs: string, userMessageText: string, statusMessageTs: string): Promise<void> {
  // resolveBackendForChannel honors per-channel profile overrides so the conversation
  // ledger records the actual backend used (e.g. 'pi' when channel uses profile=execute),
  // not the global default. This is the primary fix for Bug 2: rollback routing.
  const backend = resolveBackendForChannel(channel);
  const profileName = getActiveProfile(channel);
  const { turnIndex } = await conversationLedger.initAndBeginTurn(channel, {
    sessionId: sessionId || null,
    sessionName,
    backend,
    profileName,
    userMessageTs,
    userMessageText: userMessageText || '',
    statusMessageTs,
  });
  // Create session backup outside the mutex (different file path, safe to run concurrently)
  if (sessionId) {
    let backupPath: string | null = null;
    if (backend === 'pi') {
      const piFile = sessionBackup.findPISessionFile(sessionId);
      if (piFile) {
        backupPath = sessionBackup.backupSessionFile(piFile, turnIndex);
      }
    } else {
      backupPath = sessionBackup.createBackup(sessionId, turnIndex);
    }
    if (backupPath) {
      await conversationLedger.setBackupPath(channel, userMessageTs, backupPath);
    }
  }
}
