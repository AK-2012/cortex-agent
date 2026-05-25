// input:  plan content, PlatformAdapter, postOnce
// output: sendPlanToSlack
// pos:    Plan mode display — plan content delivery to Slack
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import type { PlatformAdapter } from '@platform/index.js';
import { postOnce } from '@platform/index.js';


async function sendPlanToSlack(
  planContent: string | null,
  channel: string,
  adapter: PlatformAdapter,
  { machine, threadAnchorId }: { machine?: string; threadAnchorId?: string | null } = {},
): Promise<void> {
  if (!planContent) {
    const label = machine ? `**[PLAN: ${machine}]**` : '**[PLAN]**';
    await postOnce(adapter, { type: 'interactive-reply', conduit: channel, sessionId: '' }, `:memo: ${label} Plan generated but no content found.`, { threadId: threadAnchorId });
    return;
  }

  const label = '**[PLAN]**';
  const prompt = 'Generated plan — use the buttons below to approve or provide feedback:';

  await postOnce(adapter, { type: 'interactive-reply', conduit: channel, sessionId: '' }, `:memo: ${label} ${prompt}\n${planContent}`, { threadId: threadAnchorId });
}
export { sendPlanToSlack };
