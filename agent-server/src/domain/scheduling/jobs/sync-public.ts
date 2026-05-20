// input:  sync-public script + PlatformAdapter
// output: sync-public job runner — registers as 'sync-public'
// pos:    periodic fetch + cherry-pick from public/main to main (non-LLM programmatic work)

import { register, ctx } from '../job-registry.js';
import { execSync } from 'child_process';

const SYNC_SCRIPT = '/home/fangxin/Cortex/scripts/sync-pull-from-public.sh';

// Self-register
register('sync-public', async (payload: unknown) => {
  const { channel } = payload as { channel: string; scheduleTaskId: string };
  const adapter = ctx.adapter!;
  try {
    const output = execSync(`bash "${SYNC_SCRIPT}"`, {
      timeout: 30_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output.trim().split('\n');
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine.includes('0 failed') || lastLine.includes('everything in sync') || lastLine.includes('OK:') || lastLine.includes('SKIP:')) {
      // Quiet success — no message needed unless there were actual syncs
      const countLine = lines.find(l => l.includes('cherry-picked'));
      if (countLine && !countLine.includes('0 cherry-picked')) {
        await adapter.postMessage(channel, { text: `:arrows_counterclockwise: Public sync: ${countLine.trim()}` });
      }
    } else {
      await adapter.postMessage(channel, { text: `:warning: Public sync issue:\n\`\`\`\n${output.slice(-500)}\n\`\`\`` });
    }
  } catch (err: any) {
    const msg = err?.stderr || err?.message || String(err);
    await adapter.postMessage(channel, { text: `:warning: Public sync error: ${msg.slice(0, 500)}` });
  }
});
