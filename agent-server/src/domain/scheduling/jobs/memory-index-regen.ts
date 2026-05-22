// input:  memory-index-regen + PlatformAdapter
// output: memory-index-regen job runner — registers as 'memory-index-regen'
// pos:    periodic memory index regeneration (non-LLM programmatic work)

import { register, ctx } from '../job-registry.js';
import { regenAll as runMemoryIndexRegen } from '../../memory/index-regen.js';

// Self-register
register('memory-index-regen', async (payload: unknown) => {
  const { channel } = payload as { channel: string; scheduleTaskId: string };
  try {
    const projects = runMemoryIndexRegen();
    await ctx.adapter!.postMessage({ type: 'interactive-reply', conduit: channel }, { text: `:brain: Memory index regen: ${projects.length} projects updated` });
  } catch (err) {
    await ctx.adapter!.postMessage({ type: 'interactive-reply', conduit: channel }, { text: `:warning: Memory index regen error: ${err}` });
  }
});
