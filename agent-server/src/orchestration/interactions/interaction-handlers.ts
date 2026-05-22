// input:  orch/busy-tracker(trackPendingTask), orch/channel-queue, orch/interactions/plan-approvals, ask-user-question, hook-bridge, adapter
// output: registerInteractionHandlers(adapter)
// pos:    AskUserQuestion + ExitPlanMode interaction handler registration
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter, ActionContext, ModalSubmitContext, ModalFieldValue, QuestionGroup } from '@platform/index.js';
import { buildPlanFeedbackModal } from '@platform/index.js';

import type { EventBus } from '@events/index.js';
import { trackPendingTask } from '../busy-tracker.js';
import { enqueue } from '../channel-queue.js';
import * as askUserQuestion from './ask-user-question.js';
import { resolveRequest as resolveHookRequest, getStreamingCallback } from '../routing/hook-bridge.js';
import { resumeAskUserQuestionGroup } from '../lifecycle.js';
import { planApprovals } from './plan-approvals.js';
import { runningExecutions } from '../../core/running-executions.js';
import { channelQueues } from '../channel-queue.js';
import { setSessionAsync, deleteSessionAsync } from '@domain/sessions/session.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import { closeSession, getActiveBackend, getActiveProfile, setActiveProfile, resolveBackendForChannel } from '@domain/agents/index.js';
import { fireAndForgetPreCloseHook } from '@domain/sessions/session-hooks.js';
import * as sessionBackup from '@domain/sessions/session-backup.js';
import { cancelThread as cancelThreadById } from '@domain/threads/index.js';
import type { PendingPlan } from './plan-approvals.js';
import { createLogger } from '@core/log.js';

let _adapter: PlatformAdapter | null = null;
let _bus: EventBus | null = null;

const log = createLogger('cancel-button');

/** Called once from app.ts during startup, after EventBus is constructed. */
export function initInteractionHandlers(bus: EventBus): void {
  _bus = bus;
}

export function registerInteractionHandlers(adapter: PlatformAdapter): void {
  _adapter = adapter;
  registerAskUserQuestionHandlers(adapter);
  registerExitPlanModeHandlers(adapter);
  registerStatusActionHandlers(adapter);
}

function registerAskUserQuestionHandlers(adapter: PlatformAdapter): void {
  adapter.onAction('ask_user_question_open_modal', handleOpenModal);
  adapter.onModalSubmit('ask_user_question_modal_submit', handleModalSubmit);
}

async function handleOpenModal(ctx: ActionContext): Promise<void> {
  if (!_adapter) return;
  const group = askUserQuestion.getGroup(ctx.value);
  if (!group || askUserQuestion.isExpired(group)) {
    if (group && askUserQuestion.isExpired(group)) askUserQuestion.deleteGroup(group.groupId);
    const msg = group ? 'This AskUserQuestion prompt has expired. Please ask again if you still need it.' : 'This AskUserQuestion prompt is no longer active.';
    if (ctx.channelId && ctx.userId) {
      await _adapter.postEphemeral(ctx.channelId, ctx.userId, msg).catch(() => {});
    }
    return;
  }
  await _adapter.openModal(ctx.triggerId, askUserQuestion.buildQuestionModalDefinition(group));
}

async function handleModalSubmit(ctx: ModalSubmitContext): Promise<void> {
  if (!_adapter) return;
  const { groupId } = JSON.parse(ctx.privateMetadata);
  const group = askUserQuestion.getGroup(groupId);
  if (!group) { await ctx.ack(); return; }

  const answers = collectModalAnswers(group, ctx.values);
  if (answers.errors) { await ctx.ack({ errors: answers.errors }); return; }
  await ctx.ack();

  for (const [pendingId, answer] of answers.collected!) group.answers.set(pendingId, answer);
  await updateQuestionMessage(group);

  if (group.answers.size === group.questions.length) {
    const g = group as unknown as { channel: string; sessionId: string; hookRequestId?: string };
    _bus?.publish({ type: 'ask-user.answered', channel: g.channel, requestId: g.hookRequestId, sessionId: g.sessionId, answer: askUserQuestion.formatGroupResponse(group) });
    const resolved = askUserQuestion.tryResolveHook(group);
    if (resolved) return;
    dispatchAskUserQuestionResume(group);
  }
}

function collectModalAnswers(group: QuestionGroup, values: Record<string, Record<string, ModalFieldValue>>): { errors?: Record<string, string>; collected?: Map<string, { header: string; value: string | string[] }> } {
  const errors: Record<string, string> = {};
  const collected = new Map<string, { header: string; value: string | string[] }>();
  for (const [qIdx, q] of group.questions.entries()) {
    const selection = values[`q_${qIdx}`]?.selection;
    const otherText = values[`q_${qIdx}_other`]?.other_text?.value?.trim();
    let answer: string | string[] | undefined;
    if (otherText) {
      answer = otherText;
    } else if (q.multiSelect) {
      const selected = (selection?.selectedOptions || []).map((o) => q.options[parseInt(o.value)]?.label).filter(Boolean);
      if (selected.length > 0) answer = selected;
    } else {
      const idx = selection?.selectedOption?.value;
      if (idx != null) answer = q.options[parseInt(idx)]?.label;
    }
    if (!answer || (Array.isArray(answer) && answer.length === 0)) {
      errors[`q_${qIdx}`] = 'Please select an option or type a custom answer.';
    } else {
      collected.set(q.pendingId, { header: q.header, value: answer });
    }
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { collected };
}

async function updateQuestionMessage(group: QuestionGroup & { responseMessageTs?: string; channel: string }): Promise<void> {
  if (!group.responseMessageTs || !_adapter) return;
  await _adapter.updateMessage(
    { channel: group.channel, messageId: group.responseMessageTs },
    {
      text: `Questions (${group.answers.size}/${group.questions.length} answered)`,
      richBlocks: askUserQuestion.buildQuestionGroupBlocks(group),
    },
  ).catch(() => {});
}

function dispatchAskUserQuestionResume(group: QuestionGroup & { channel: string; sessionId: string; threadId?: string | null }): void {
  if (!_adapter) return;
  const adapter = _adapter;
  const responseText = askUserQuestion.formatGroupResponse(group);
  trackPendingTask(+1);
  enqueue(group.channel, async () => {
    try {
      await resumeAskUserQuestionGroup({ adapter, group, responseText });
    } finally {
      trackPendingTask(-1);
    }
  });
}

/**
 * Send extension_ui_response for PI plan approval/rejection.
 * PI's exit_plan_mode shim uses ctx.ui.input() which expects { value: string } or { cancelled: true }.
 * Returns true if the response was sent (PI path), false otherwise (Claude path).
 */
function tryResolvePIPlan(pending: PendingPlan, value: string | null): boolean {
  if (!pending.extensionUiId) return false;
  const exec = runningExecutions.getByKey(pending.channel);
  if (!exec?.agentProcess) return false;
  const proc = exec.agentProcess as any;
  if (typeof proc.sendExtensionUiResponse !== 'function') return false;
  if (value === null) {
    proc.sendExtensionUiResponse(pending.extensionUiId, { cancelled: true });
  } else {
    proc.sendExtensionUiResponse(pending.extensionUiId, { value });
  }
  return true;
}

function registerExitPlanModeHandlers(adapter: PlatformAdapter): void {
  adapter.onAction('hook_plan_approve', async (ctx: ActionContext) => {
    const requestId = ctx.value;
    const pending = planApprovals.resolve(requestId);
    if (!pending) return;
    // PI path: send extension_ui_response directly; Claude path: resolve pending HTTP request
    if (!tryResolvePIPlan(pending, '__APPROVED__')) {
      resolveHookRequest(requestId, { approved: true, reason: '' });
    }
    if (ctx.messageRef) {
      await adapter.updateMessage(
        ctx.messageRef,
        {
          text: ':white_check_mark: Plan approved \u2014 Cortex will proceed.',
          richBlocks: [{ type: 'section', text: ':white_check_mark: *Plan approved* \u2014 Cortex will proceed.' }],
        },
      ).catch(() => {});
    }
  });

  adapter.onAction('hook_plan_feedback', async (ctx: ActionContext) => {
    const requestId = ctx.value;
    if (!requestId || !planApprovals.has(requestId)) return;
    await adapter.openModal(ctx.triggerId, buildPlanFeedbackModal(requestId));
  });

  adapter.onModalSubmit('hook_plan_feedback_submit', async (ctx: ModalSubmitContext) => {
    await ctx.ack();
    const { requestId } = JSON.parse(ctx.privateMetadata);
    const pending = planApprovals.reject(requestId);
    if (!pending) return;
    const feedback = ctx.values?.feedback?.text?.value || 'No specific feedback';
    // PI path: send extension_ui_response directly; Claude path: resolve pending HTTP request
    if (!tryResolvePIPlan(pending, feedback)) {
      resolveHookRequest(requestId, { approved: false, reason: feedback });
    }
    const feedbackText = `:pencil2: Plan feedback sent \u2014 Cortex will revise.\n> ${feedback}`;
    const streamingCb = getStreamingCallback(pending.channel);
    if (streamingCb) {
      streamingCb(feedbackText);
    } else {
      await adapter.postMessage(pending.channel, { text: feedbackText }).catch(() => {});
    }
  });
}

// --- Status action button handlers ---

function registerStatusActionHandlers(adapter: PlatformAdapter): void {
  adapter.onAction('status_cancel', handleStatusCancel);
  adapter.onAction('status_resume', handleStatusResume);
  adapter.onAction('status_new', handleStatusNew);
}

async function handleStatusCancel(ctx: ActionContext): Promise<void> {
  if (!_adapter) return;
  let channel: string;
  let threadId: string | null;
  try {
    const parsed = JSON.parse(ctx.value);
    channel = parsed.channel;
    threadId = parsed.threadId ?? null;
  } catch {
    return;
  }
  if (!threadId) {
    log.warn('Cancel button clicked but threadId missing in value', { channel });
    return;
  }
  const exec = runningExecutions.getByThreadId(threadId);
  if (!exec) {
    log.warn('Cancel button clicked but no running execution for threadId', { channel, threadId });
    return;
  }
  await cancelThreadById(threadId).catch(() => {});
  if (exec.sessionId) await setSessionAsync(exec.channel ?? channel, exec.sessionId, getActiveBackend()).catch(() => {});
  runningExecutions.killByThreadId(threadId);
  channelQueues.delete(exec.channel ?? channel);
  if (ctx.messageRef) {
    await _adapter.updateMessage(ctx.messageRef, {
      text: ':octagonal_sign: Cancelled. Session preserved — next message will resume.',
    }).catch(() => {});
  }
}

async function handleStatusResume(ctx: ActionContext): Promise<void> {
  if (!_adapter) return;
  const sessionName = ctx.value;
  const record = await sessionStore.lookupSession(sessionName);
  if (!record) return;
  if (record.profileName) setActiveProfile(record.profileName, ctx.channelId);
  await setSessionAsync(ctx.channelId, record.sessionId, record.backend);
  await conversationLedger.switchSession(ctx.channelId, {
    sessionId: record.sessionId, sessionName, backend: record.backend, profileName: record.profileName,
  });
  const profileNote = record.profileName ? ` (profile: ${record.profileName})` : '';
  await _adapter.postMessage(ctx.channelId, {
    text: `:arrows_counterclockwise: Session \`${sessionName}\` active — send your message below.${profileNote}`,
  }).catch(() => {});
}

async function handleStatusNew(ctx: ActionContext): Promise<void> {
  if (!_adapter) return;
  const channel = ctx.value;
  // Status message IS the thread parent (no thread_ts on it) — use its messageId
  // as the thread context so hook messages land in the session's thread.
  const threadTs = ctx.messageRef?.threadId || ctx.messageRef?.messageId;

  // Fire-and-forget: hook starts, session closes immediately without waiting
  void fireAndForgetPreCloseHook(channel, _adapter, threadTs);

  closeSession(channel);
  const conv = await conversationLedger.getConversation(channel);
  const profileName = getActiveProfile(channel) || 'default';
  if (conv) {
    sessionBackup.cleanupAllBackups(conv.sessionId);
    await conversationLedger.clearConversation(channel);
  }
  await deleteSessionAsync(channel, resolveBackendForChannel(channel));
  planApprovals.clearByChannel(channel);
  await _adapter.postMessage(ctx.channelId, {
    text: `--- new conversation --- (profile: ${profileName})`,
  }).catch(() => {});
}
