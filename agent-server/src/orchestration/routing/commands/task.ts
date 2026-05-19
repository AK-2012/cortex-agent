import type { PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';
import type { CommandActionRouter } from '@orch/interactions/command-action-router.js';
import type { Task } from '@core/task-parser.js';
import { scanAllTasks, completedHashSet, isActionable } from '@domain/tasks/parser.js';
import { PROJECTS_DIR } from '@core/utils.js';
import * as path from 'path';
import { existsSync } from 'fs';

type TaskFilter = 'all' | 'actionable' | 'in-progress' | 'blocked';

function formatTaskList(tasks: Task[], filter: TaskFilter, project: string): string {
  const completed = completedHashSet(tasks);

  const filtered = filter === 'all' ? tasks : tasks.filter(task => {
    switch (filter) {
      case 'actionable': return task.status !== 'done' && isActionable(task, completed);
      case 'in-progress': return !!task.claimed_by;
      case 'blocked': return !!task.blocked_by;
      default: return true;
    }
  });

  const filterLabel = filter === 'all' ? '' : ` — ${filter}`;
  const lines = [`*Tasks for \`${project}\`* (${filtered.length}/${tasks.length})${filterLabel}\n`];

  for (const task of filtered) {
    const status = task.status === 'done' ? ':white_check_mark:' : (task.blocked_by ? ':no_entry_sign:' : (task.claimed_by ? ':arrows_counterclockwise:' : (task.paused ? ':double_vertical_bar:' : ':radio_button:')));
    const id = task.id ? `\`${task.id}\`` : '—';
    const tags: string[] = [];
    if (task.priority) tags.push(task.priority);
    if (task.gpu) tags.push(`gpu:${task.gpu}`);

    const statusLabel = task.status === 'done' ? 'completed'
      : task.blocked_by ? `blocked: ${task.blocked_by}`
      : task.claimed_by ? `in-progress: ${task.claimed_by}`
      : task.paused ? 'paused'
      : (task.approval_needed && !task.approved_at) ? 'approval-needed'
      : isActionable(task, completed) ? 'actionable'
      : 'open';

    lines.push(`${status} ${id} *${task.text}*`);
    lines.push(`    Status: ${statusLabel} · Priority: ${task.priority}`);
    if (tags.length) lines.push(`    Tags: ${tags.join(', ')}`);
    if (task.why) lines.push(`    Why: ${task.why}`);
    if (task.done_when) lines.push(`    Done when: ${task.done_when}`);
    if (task.depends_on.length) lines.push(`    Depends on: ${task.depends_on.join(', ')}`);
    lines.push('');
  }

  if (filtered.length === 0) {
    lines.push(`No ${filter} tasks found.`);
  }

  return lines.join('\n');
}

const SECTION_BLOCK_LIMIT = 2900; // Slack section text max is 3000; leave margin

function textToSectionBlocks(text: string): import('@platform/index.js').RichBlock[] {
  if (text.length <= SECTION_BLOCK_LIMIT) {
    return [{ type: 'section' as const, text }];
  }
  const blocks: import('@platform/index.js').RichBlock[] = [];
  const lines = text.split('\n');
  let chunk = '';
  for (const line of lines) {
    if (chunk.length + line.length + 1 > SECTION_BLOCK_LIMIT && chunk.length > 0) {
      blocks.push({ type: 'section' as const, text: chunk });
      chunk = '';
    }
    chunk += (chunk ? '\n' : '') + line;
  }
  if (chunk) blocks.push({ type: 'section' as const, text: chunk });
  return blocks;
}

function buildFilterButtons(project: string): import('@platform/index.js').ActionElement[] {
  const TASK_FILTERS: { label: string; value: string }[] = [
    { label: 'All', value: 'all' },
    { label: 'Actionable', value: 'actionable' },
    { label: 'In Progress', value: 'in-progress' },
    { label: 'Blocked', value: 'blocked' },
  ];
  return TASK_FILTERS.map(f => ({
    type: 'button' as const,
    text: f.label,
    actionId: `cmd:tasks:filter-${f.value}`,
    value: JSON.stringify({ project, filter: f.value }),
  }));
}

export function createTasksHandler(router?: CommandActionRouter) {
  if (router) {
    const filterHandler = async (ctx: import('@platform/index.js').ActionContext) => {
      const adapter = router.getAdapter();
      if (!adapter || !ctx.messageRef) return;
      try {
        const { project, filter } = JSON.parse(ctx.value) as { project: string; filter: TaskFilter };
        const tasks = scanAllTasks(project);
        const text = formatTaskList(tasks, filter, project);
        await adapter.updateMessage(ctx.messageRef, {
          text,
          richBlocks: [
            ...textToSectionBlocks(text),
            { type: 'actions', elements: buildFilterButtons(project) },
          ],
        }).catch(() => {});
      } catch { /* invalid value — ignore */ }
    };
    router.registerCommand('tasks', {
      actions: ['all', 'actionable', 'in-progress', 'blocked'].map(key => ({
        actionId: `filter-${key}`,
        handler: filterHandler,
      })),
    });
  }

  return async function handleTasksCmdInteractive(
    channel: string, adapter: PlatformAdapter, trimmedMessage: string,
  ): Promise<CommandResult | void> {
    const args = trimmedMessage.split(/\s+/).slice(1);
    if (args.length === 0) {
      await adapter.postMessage(channel, { text: ':x: Usage: `!tasks <project>`' });
      return;
    }
    const project = args[0];
    const projectDir = path.join(PROJECTS_DIR, project);
    if (!existsSync(projectDir)) {
      await adapter.postMessage(channel, { text: `:x: Project not found: \`${project}\`` });
      return;
    }
    const tasks = scanAllTasks(project);
    if (tasks.length === 0) {
      await adapter.postMessage(channel, { text: `No tasks found for \`${project}\`.` });
      return;
    }

    const text = formatTaskList(tasks, 'all', project);

    if (!router) {
      await adapter.postMessage(channel, { text });
      return;
    }

    return {
      text,
      richBlocks: textToSectionBlocks(text),
      actions: buildFilterButtons(project),
    };
  };
}

/** @deprecated Use createTasksHandler() instead. */
export async function handleTasksCmd(channel: string, adapter: PlatformAdapter, trimmedMessage: string): Promise<void> {
  const handler = createTasksHandler();
  await handler(channel, adapter, trimmedMessage);
}
