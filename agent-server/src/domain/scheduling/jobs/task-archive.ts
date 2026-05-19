// input:  task-archiver + PlatformAdapter
// output: task-archive job runner — registers as 'task-archive'
// pos:    periodic completed task archiving (non-LLM programmatic work)

import { register, ctx } from '../job-registry.js';
import { runTaskArchiver } from '../../tasks/archiver.js';

// Self-register
register('task-archive', async (payload: unknown) => {
  const { channel } = payload as { channel: string; scheduleTaskId: string };
  const results = await runTaskArchiver();
  const adapter = ctx.adapter!;
  if (results.archived.length > 0) {
    const summary = results.archived.map((r: { project: string; ids: string[] }) => `*${r.project}*: archived ${r.ids.length} tasks`).join('\n');
    await adapter.postMessage(channel, { text: `:file_folder: Task auto-archive:\n${summary}` });
  }
  if (results.errors.length > 0) {
    const errSummary = results.errors.join('\n');
    await adapter.postMessage(channel, { text: `:warning: Task archiver errors:\n${errSummary}` });
  }
});
