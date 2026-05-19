// input:  OutboundQueue (store), DurableHooks (platform/types)
// output: buildDurableHooks() + re-exports of durablePost/durableUpdate
// pos:    orch layer bridge — connects store/outbound-queue and platform/types.DurableHooks
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { DurableHooks, RichBlock } from '@platform/types.js';
import type { OutboundQueue } from '@store/outbound-queue.js';

export { durablePost, durableUpdate } from '@store/outbound-queue.js';

export function buildDurableHooks(queue: OutboundQueue): DurableHooks {
  return {
    async beforePost(channel: string, text: string, opts?: { threadId?: string; richBlocks?: RichBlock[] }): Promise<string> {
      const walId = await queue.enqueue({
        type: 'post',
        channel,
        text,
        threadId: opts?.threadId,
        richBlocks: opts?.richBlocks,
      });
      queue.claim(walId);
      return walId;
    },
    async beforeUpdate(channel: string, messageId: string, text: string, opts?: { richBlocks?: RichBlock[] }): Promise<string> {
      const walId = await queue.enqueue({
        type: 'update',
        channel,
        messageId,
        text,
        richBlocks: opts?.richBlocks,
      });
      queue.claim(walId);
      return walId;
    },
    async afterSent(walId: string, slackTs?: string): Promise<void> {
      try {
        await queue.markSent(walId, slackTs);
      } finally {
        queue.release(walId);
      }
    },
    onSendFailed(walId: string): void {
      queue.release(walId);
    },
  };
}
