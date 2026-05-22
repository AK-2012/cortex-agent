// input:  EventBus, PlatformAdapter, PlanApprovals
// output: registerHookBridgeSubscribers(bus, adapter, planApprovals) — extracts
//         ask-user.requested / plan.submitted handler bodies from entry/app.ts into orch/
// pos:    orch/routing/ — hook-bridge event subscribers (S13 composition-root extraction)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { EventBus, CortexEvent } from '@events/index.js';
import type { Destination, PlatformAdapter, VirtualMessage } from '@platform/index.js';
import { buildPlanApprovalContent } from '@platform/index.js';
import * as askUserQuestion from '@orch/interactions/ask-user-question.js';
import { sendPlanToSlack } from '@orch/interactions/plan-handler.js';
import type { PlanApprovals } from '@orch/interactions/plan-approvals.js';
import { resolveRequest as resolveHookRequest, getStreamingCallback } from './hook-bridge.js';

const log = createLogger('hook-bridge');

export function registerHookBridgeSubscribers(
  bus: EventBus,
  adapter: PlatformAdapter,
  planApprovals: PlanApprovals,
): void {
  bus.subscribe('ask-user.requested', async (e) => {
    const ev = e as Extract<CortexEvent, { type: 'ask-user.requested' }>;
    if (ev.dryRun) return; // smoke-test: event is journalled, skip Slack post
    try {
      const group = askUserQuestion.createHookGroup(ev.requestId, ev.channel, ev.sessionId, ev.questions, ev.extensionUiId, ev.threadId ?? null);
      askUserQuestion.registerHookResolver(ev.requestId, (data) => resolveHookRequest(ev.requestId, data));
      // streamingCb is fetched only to extract the vm reference — not invoked directly for AskUser
      const streamingCb = getStreamingCallback(ev.channel);
      const vm = (streamingCb as any)?.vm as VirtualMessage | undefined;
      const text = `Questions (${group.questions.length})`;
      const richBlocks = askUserQuestion.buildQuestionGroupBlocks(group);
      // Route through vm when available so standalone post flushes pending appends
      // and resets vm state — without this, messages emitted after the form would
      // be merged back into the message that preceded it.
      const askDest: Destination = { type: 'interactive-reply', conduit: ev.channel, sessionId: ev.sessionId ?? '' };
      if (vm) {
        const ref = await vm.postStandalone(text, { richBlocks });
        group.responseMessageTs = ref?.messageId || null;
      } else {
        const ref = await adapter.postMessage(askDest, { text, richBlocks });
        group.responseMessageTs = ref.messageId;
      }
    } catch (e) {
      log.error(`Failed to post AskUserQuestion: ${(e as Error).message}`);
      resolveHookRequest(ev.requestId, { error: 'post_failed', answers: {} });
    }
  });

  bus.subscribe('plan.submitted', async (e) => {
    const ev = e as Extract<CortexEvent, { type: 'plan.submitted' }>;
    if (ev.dryRun) return; // smoke-test: event is journalled, skip Slack post + approval registration
    try {
      const streamingCb = getStreamingCallback(ev.channel);
      const vm = (streamingCb as any)?.vm as VirtualMessage | undefined;
      const planDest: Destination = { type: 'interactive-reply', conduit: ev.channel, sessionId: ev.sessionId ?? '' };
      if (streamingCb && ev.planContent) {
        streamingCb(ev.planContent);
      } else {
        await sendPlanToSlack(ev.planContent || null, ev.channel, adapter);
      }
      planApprovals.register(ev.requestId, { channel: ev.channel, extensionUiId: ev.extensionUiId ?? null, threadId: ev.threadId ?? null });
      const planApproval = buildPlanApprovalContent(ev.requestId);
      // Route approval form through vm so it enqueues behind the plan content append,
      // ensuring Slack ordering (plan text first, then button card) and resetting vm
      // state so subsequent assistant output starts a fresh message instead of
      // merging back into the message that preceded the form.
      if (vm) {
        await vm.postStandalone('Plan approval', {
          richBlocks: planApproval.richBlocks,
          actions: planApproval.actions,
        });
      } else {
        await adapter.postInteractive(planDest, {
          text: 'Plan approval',
          ...planApproval,
        });
      }
    } catch (e) {
      log.error(`Failed to post plan: ${(e as Error).message}`);
      resolveHookRequest(ev.requestId, { error: 'post_failed', approved: true, reason: '' });
    }
  });
}
