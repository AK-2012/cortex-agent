// input:  PlatformAdapter + startup metadata
// output: buildStartupMessage + sendStartupDmIfConfigured
// pos:    send DM notification to admin channel during startup
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { PlatformAdapter } from '@platform/index.js';

function buildStartupMessage({ machine, restartReason }: { machine?: string; restartReason?: string }) {
  const machineLabel = machine || 'unknown-machine';
  const verb = restartReason ? 'restarted' : 'started';
  const base = `Cortex agent ${verb} on ${machineLabel}.`;
  return restartReason ? `${base} Reason: ${restartReason}.` : base;
}

async function sendStartupDmIfConfigured(
  adapter: PlatformAdapter,
  { machine, restartReason }: { machine?: string; restartReason?: string } = {},
) {
  const adminChannel = adapter.getAdminChannel();
  if (!adminChannel) return false;
  await adapter.postMessage(adminChannel, {
    text: buildStartupMessage({ machine, restartReason }),
  });
  return true;
}

export { buildStartupMessage, sendStartupDmIfConfigured };
