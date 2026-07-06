import type { TaskInfo } from '@cortex-agent/ui-contract';

export type Priority = TaskInfo['priority'];

/** Canonical priority ordering used for both sub-grouping and display. */
export const PRIORITY_ORDER: readonly Priority[] = ['high', 'medium', 'low'];

export interface TaskGroup {
  priority: Priority;
  tasks: TaskInfo[];
}

export interface GroupedTasks {
  open: TaskGroup[];
  done: TaskGroup[];
}

/** Group a lifecycle slice into priority sub-groups (high→medium→low), omitting empty groups. */
function byPriority(tasks: TaskInfo[]): TaskGroup[] {
  return PRIORITY_ORDER
    .map((priority) => ({ priority, tasks: tasks.filter((t) => t.priority === priority) }))
    .filter((g) => g.tasks.length > 0);
}

/**
 * Split tasks by lifecycle (open before done), then by priority within each lifecycle.
 * Input order is preserved within a priority group (stable — `filter` keeps order).
 */
export function groupTasks(tasks: TaskInfo[]): GroupedTasks {
  return {
    open: byPriority(tasks.filter((t) => t.status === 'open')),
    done: byPriority(tasks.filter((t) => t.status === 'done')),
  };
}
