// input:  thread-store, profile-manager, core/types/thread-types
// output: handleDispatchCmd — set profileOverride on running dispatch threads
// pos:    !dispatch <threadId> [--profile <name>]

import type { Destination, PlatformAdapter } from '@platform/index.js';
import { threadStore } from '@store/thread-repo.js';
import { resolveProfile } from '@domain/agents/profile-manager.js';
import { Icons } from '../../../core/icons.js';

const USAGE = 'Usage: `!dispatch <threadId> [--profile <name>]`';

export async function handleDispatchCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  const args = trimmedMessage.split(/\s+/).slice(1);
  if (args.length === 0) {
    await adapter.postMessage(dest, { text: USAGE });
    return;
  }

  const threadId = args[0];
  const thread = threadStore.get(threadId);
  if (!thread) {
    await adapter.postMessage(dest, { text: `${Icons.error} Thread not found: \`${threadId}\`` });
    return;
  }
  if (thread.metadata?.trigger !== 'task-dispatch') {
    await adapter.postMessage(dest, { text: `${Icons.error} Thread \`${threadId}\` is not a dispatch thread.` });
    return;
  }
  if (thread.status === 'completed' || thread.status === 'failed' || thread.status === 'cancelled' || thread.status === 'aborted') {
    await adapter.postMessage(dest, {
      text: `${Icons.warning} Dispatch \`${threadId.substring(0, 12)}\` is \`${thread.status}\`. Profile override will only apply if the thread is continued via \`!thread add\`.${thread.status === 'completed' ? '' : ''}`,
    });
    // Allow the change to go through even for completed threads — it takes effect if continued.
  }

  const profileIdx = args.indexOf('--profile');
  if (profileIdx === -1 || profileIdx + 1 >= args.length) {
    const current = thread.metadata?.profileOverride || '(not set)';
    await adapter.postMessage(dest, { text: `Dispatch \`${threadId.substring(0, 12)}\`: current \`profileOverride\` = \`${current}\`\n${USAGE}` });
    return;
  }

  const profileName = args[profileIdx + 1];
  try {
    resolveProfile(profileName);
  } catch {
    await adapter.postMessage(dest, { text: `${Icons.error} Unknown profile: \`${profileName}\`. Use \`!profile\` to see available profiles.` });
    return;
  }

  await threadStore.mutate(threadId, (t) => {
    t.metadata = { ...t.metadata, profileOverride: profileName };
  });

  await adapter.postMessage(dest, {
    text: `${Icons.ok} Dispatch \`${threadId.substring(0, 12)}\`: \`profileOverride\` set to \`${profileName}\`. Next step will use this profile.`,
  });
}
