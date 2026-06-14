import type { Destination, PlatformAdapter } from '@platform/index.js';
import { t } from '../../../core/i18n.js';

export async function handleOrientCmd(channel: string, adapter: PlatformAdapter): Promise<void> {
  const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: '' };
  await adapter.postMessage(dest, { text: t('cmd.orient.notImplemented') });
}
