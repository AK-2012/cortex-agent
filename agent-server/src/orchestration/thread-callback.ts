// input:  terminal thread record (threadStore), interactive runner, outbound queue, live adapter
// output: fireThreadCallback — wakes / notifies the agent that spawned an MCP thread
// pos:    completion callback for MCP thread_start; closes the loop when a spawned thread finishes
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { threadStore } from '@store/thread-repo.js';
import { agentRunner } from './agent-runner.js';
import { getOutboundQueue, durablePost } from '@store/outbound-queue.js';
import { ctx as jobCtx } from '@domain/scheduling/job-registry.js';
import { createLogger } from '@core/log.js';
import type { IncomingMessage, Destination } from '@platform/index.js';

const log = createLogger('thread-callback');

// Single-fire guard: never deliver a completion callback twice for the same thread.
const fired = new Set<string>();

/** Compose a short, agent-actionable completion notice from the final thread record. */
function buildNotice(threadId: string): string {
  const t = threadStore.get(threadId)!;
  const cost = `$${(t.totalCostUsd || 0).toFixed(4)}`;
  const last = t.steps.length ? t.steps[t.steps.length - 1].output : null;
  const tail = t.abortReason || t.error || last || '(无输出)';
  const summary = tail.length > 200 ? tail.slice(0, 200) + '…' : tail;
  const label = t.templateName || t.activeAgent || 'thread';
  return `[后台线程完成] 你启动的线程 ${threadId} (${label}) 状态=${t.status} | ${cost}\n摘要: ${summary}\n调用 thread_result("${threadId}") 查看完整产出。`;
}

/**
 * Fire the completion callback for an MCP-spawned thread once it is terminal.
 *  - Interactive parent (no parentThreadId): wake the parent by routing a synthetic turn onto its
 *    channel via agentRunner.route — this resolves+persists the channel session, posts output, and
 *    serializes per channel.
 *  - Thread-agent parent (parentThreadId set) or missing interactive identity: post a durable notice
 *    to the thread's project-report channel (no out-of-band pipeline resume).
 * Threads not spawned via thread_start (no parentSessionId) are ignored.
 */
export async function fireThreadCallback(threadId: string): Promise<void> {
  if (fired.has(threadId)) return;
  const t = threadStore.get(threadId);
  if (!t) return;
  const m = t.metadata;
  if (!m?.parentSessionId) return; // not agent-spawned → nobody to notify
  fired.add(threadId);

  const notice = buildNotice(threadId);
  const adapter = jobCtx.adapter;

  // Interactive parent → wake its session.
  if (!m.parentThreadId && m.parentChannel) {
    if (!adapter) { log.error(`no adapter; cannot wake parent for ${threadId}`); return; }
    const channel = m.parentChannel;
    const message: IncomingMessage = {
      ref: { conduit: channel, messageId: `cb_${threadId}_${Date.now()}` },
      text: notice,
      senderId: 'cortex-thread-callback',
      isBot: false,
      kind: 'user',
      raw: { source: 'thread-callback', threadId },
    };
    log.info(`waking parent session on ${channel} for thread ${threadId}`);
    await agentRunner.route({
      message,
      channel,
      adapter,
      threadAnchorId: null,
      hasFiles: false,
      userMessage: notice,
      agentMessage: notice,
    });
    return;
  }

  // Thread-agent parent (or no channel) → durable notice to the project-report channel.
  if (!adapter) { log.error(`no adapter; cannot notify parent for ${threadId}`); return; }
  const dest: Destination = { type: 'project-report', projectId: t.projectId, trigger: 'mcp-thread', sessionId: '' };
  const queue = getOutboundQueue();
  log.info(`posting completion notice to project ${t.projectId} for thread ${threadId}`);
  if (queue) {
    await durablePost(queue, adapter, dest, { text: notice });
  } else {
    await adapter.postMessage(dest, { text: notice });
  }
}
