import type { Destination, PlatformAdapter } from '@platform/index.js';

export async function handleOrientCmd(channel: string, adapter: PlatformAdapter): Promise<void> {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  await adapter.postMessage(dest, { text: '`!orient` command not yet implemented.' });
}
