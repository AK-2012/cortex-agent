import type { PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import { handleScheduleCommand } from '@domain/scheduling/schedule-command.js';
import type { ScheduleTask } from '@domain/scheduling/scheduler.js';

const MAX_SCHEDULE_BUTTONS = 10;

const FMT_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
const fmtTime = (ts: number): string => new Date(ts).toLocaleString('en-US', FMT_OPTS);

function formatTimeUntilCompact(ms: number): string {
  if (ms <= 0) return 'now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatTaskLine(t: ScheduleTask, now: number): string {
  const id = `\`${t.id}\``;
  const profile = t.profile ? ` · ${t.profile}` : '';
  const paused = t.isPaused ? ' · *paused*' : '';
  const nextMs = (t.nextRun || t.runAt || 0) - now;
  const next = t.isPaused ? '' : ` · next: ${formatTimeUntilCompact(nextMs)}`;
  const msg = t.message.length > 40 ? t.message.slice(0, 37) + '...' : t.message;
  return `${id} ${t.type}${profile}${paused}${next} · "${msg}"`;
}

function buildScheduleTaskButtons(tasks: ScheduleTask[]): import('@platform/index.js').ActionElement[] {
  const buttons: import('@platform/index.js').ActionElement[] = [];
  for (let i = 0; i < Math.min(tasks.length, MAX_SCHEDULE_BUTTONS); i++) {
    const t = tasks[i];
    if (t.type === 'once') {
      buttons.push({
        type: 'button', text: `Remove ${t.id}`,
        actionId: `cmd:schedule:remove-${i}`, value: t.id, style: 'danger',
      });
    } else if (t.isPaused) {
      buttons.push({
        type: 'button', text: `Resume ${t.id}`,
        actionId: `cmd:schedule:resume-${i}`, value: t.id,
      });
    } else {
      buttons.push({
        type: 'button', text: `Pause ${t.id}`,
        actionId: `cmd:schedule:pause-${i}`, value: t.id,
      });
    }
  }
  return buttons;
}

export function createScheduleHandler(scheduler: any, router?: CommandActionRouter) {
  if (router && scheduler) {
    const refreshList = async (adapter: PlatformAdapter, messageRef: import('@platform/index.js').MessageRef) => {
      const tasks: ScheduleTask[] = await scheduler.list();
      const now = Date.now();
      const text = tasks.length === 0
        ? 'No scheduled tasks.'
        : `*Scheduled tasks (${tasks.length}):*\n${tasks.map(t => `• ${formatTaskLine(t, now)}`).join('\n')}`;
      await adapter.updateMessage(messageRef, {
        text,
        richBlocks: [
          { type: 'section', text },
          ...(tasks.length > 0 ? [{ type: 'actions' as const, elements: buildScheduleTaskButtons(tasks) }] : []),
        ],
      }).catch(() => {});
    };

    const pauseHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter || !ctx.messageRef) return;
      try { await scheduler.pause(ctx.value); } catch { /* ignore */ }
      await refreshList(adapter, ctx.messageRef);
    };
    const resumeHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter || !ctx.messageRef) return;
      try { await scheduler.resume(ctx.value); } catch { /* ignore */ }
      await refreshList(adapter, ctx.messageRef);
    };
    const removeHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter || !ctx.messageRef) return;
      try { await scheduler.remove(ctx.value); } catch { /* ignore */ }
      await refreshList(adapter, ctx.messageRef);
    };

    router.registerCommand('schedule', {
      actions: [
        ...Array.from({ length: MAX_SCHEDULE_BUTTONS }, (_, i) => ({
          actionId: `pause-${i}`, handler: pauseHandler,
        })),
        ...Array.from({ length: MAX_SCHEDULE_BUTTONS }, (_, i) => ({
          actionId: `resume-${i}`, handler: resumeHandler,
        })),
        ...Array.from({ length: MAX_SCHEDULE_BUTTONS }, (_, i) => ({
          actionId: `remove-${i}`, handler: removeHandler,
        })),
      ],
    });
  }

  return async function handleScheduleCmd(
    channel: string, adapter: PlatformAdapter, trimmedMessage: string,
  ): Promise<CommandResult | void> {
    const parts = trimmedMessage.split(/\s+/);
    const sub = parts[1];

    if (router && scheduler && (!sub || sub === 'list')) {
      const tasks: ScheduleTask[] = await scheduler.list();
      if (tasks.length === 0) {
        await adapter.postMessage(channel, { text: 'No scheduled tasks.' });
        return;
      }
      const now = Date.now();
      const text = `*Scheduled tasks (${tasks.length}):*\n${tasks.map(t => `• ${formatTaskLine(t, now)}`).join('\n')}`;
      return {
        text,
        richBlocks: [{ type: 'section' as const, text }],
        actions: buildScheduleTaskButtons(tasks),
      };
    }

    return handleScheduleCommand(trimmedMessage, channel, adapter, scheduler);
  };
}
