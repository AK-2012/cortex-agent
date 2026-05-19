import type { PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import { getOnlineDevices } from '@domain/remote/client-manager.js';
import { getMachineRegistry } from '@domain/tasks/dispatch-utils.js';

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildDevicesText(): string {
  const onlineDevices = getOnlineDevices();
  const knownNames = new Set(Object.keys(getMachineRegistry()));
  for (const d of onlineDevices) knownNames.add(d.device);

  const now = Date.now();
  const lines: string[] = ['*Devices*'];

  for (const name of [...knownNames].sort()) {
    const online = onlineDevices.find(d => d.device === name);
    if (online) {
      const connAgo = formatTimeAgo(now - online.connectedAt.getTime());
      const hbAgo = formatTimeAgo(now - online.lastHeartbeat.getTime());
      lines.push(`:white_check_mark: \`${name}\`  ${online.platform}  connected ${connAgo}  heartbeat ${hbAgo}`);
    } else {
      lines.push(`:x: \`${name}\`  offline`);
    }
  }

  if (knownNames.size === 0) {
    lines.push('No devices registered or online.');
  }

  return lines.join('\n');
}

const REFRESH_BUTTON = {
  type: 'button' as const,
  text: 'Refresh',
  actionId: 'cmd:devices:refresh',
  value: 'refresh',
};

export function createDevicesHandler(router?: CommandActionRouter) {
  if (router) {
    router.registerCommand('devices', {
      actions: [{
        actionId: 'refresh',
        handler: async (ctx) => {
          const adapter = router.getAdapter();
          if (!adapter || !ctx.messageRef) return;
          const text = buildDevicesText();
          await adapter.updateMessage(ctx.messageRef, {
            text,
            richBlocks: [
              { type: 'section', text },
              { type: 'actions', elements: [REFRESH_BUTTON] },
            ],
          }).catch(() => {});
        },
      }],
    });
  }

  return async function handleDevicesCmd(channel: string, adapter: PlatformAdapter): Promise<CommandResult | void> {
    const text = buildDevicesText();

    if (!router) {
      await adapter.postMessage(channel, { text });
      return;
    }

    return {
      text,
      richBlocks: [{ type: 'section' as const, text }],
      actions: [REFRESH_BUTTON],
    };
  };
}

/** @deprecated Use createDevicesHandler() instead. */
export async function handleDevicesCmd(channel: string, adapter: PlatformAdapter): Promise<void> {
  const handler = createDevicesHandler();
  await handler(channel, adapter);
}
