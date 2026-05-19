// input:  plan content, PlatformAdapter, VirtualMessage
// output: sendPlanToSlack
// pos:    Plan mode display — plan content delivery to Slack
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import type { PlatformAdapter } from '@platform/index.js';
import { VirtualMessage } from '@platform/index.js';


async function sendPlanToSlack(
  planContent: string | null,
  channel: string,
  adapter: PlatformAdapter,
  { machine, threadTs }: { machine?: string; threadTs?: string | null } = {},
): Promise<void> {
  if (!planContent) {
    const label = machine ? `**[PLAN: ${machine}]**` : '**[PLAN]**';
    await VirtualMessage.postOnce(adapter, channel, `:memo: ${label} Plan generated but no content found.`, { threadId: threadTs });
    return;
  }

  const label = '**[PLAN]**';
  const prompt = 'Generated plan — use the buttons below to approve or provide feedback:';

  await VirtualMessage.postOnce(adapter, channel, `:memo: ${label} ${prompt}\n${planContent}`, { threadId: threadTs });
}
export { sendPlanToSlack };
