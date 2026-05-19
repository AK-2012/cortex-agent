import type { PlatformAdapter } from '@platform/index.js';

export async function handleOrientCmd(channel: string, adapter: PlatformAdapter): Promise<void> {
  await adapter.postMessage(channel, { text: '`!orient` command not yet implemented.' });
}
