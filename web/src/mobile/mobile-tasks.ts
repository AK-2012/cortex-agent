// Pure task-grouping logic for the mobile 5c 任务 screen (scheme.dc.html L3110-3195). Maps the real
// `tasks.list` DTO into the scheme's four lifecycle groups + the 可执行/全部 segmented counts. Kept
// framework-free so the DTO→scheme mapping is unit-testable in isolation (RB pure-vm precedent).
import type { TaskInfo } from '@cortex-agent/ui-contract';

export type MobileTaskGroup = 'in-progress' | 'claimable' | 'waiting-deps' | 'blocked';

/**
 * Classify one task into a scheme group. Precedence (top→down): blocked → in-progress → claimable →
 * waiting-deps, so an overlapping task (e.g. claimed AND blocked) lands in the higher-attention group.
 */
export function classifyMobileTask(t: TaskInfo): MobileTaskGroup {
  if (t.blockedBy != null) return 'blocked';
  if (t.claimedBy != null) return 'in-progress';
  if (t.actionable) return 'claimable';
  return 'waiting-deps';
}

export interface MobileTasksGrouped {
  inProgress: TaskInfo[];
  claimable: TaskInfo[];
  waitingDeps: TaskInfo[];
  blocked: TaskInfo[];
}

/** Bucket the OPEN tasks by classifier (done tasks are excluded from all four groups). Stable order. */
export function groupMobileTasks(tasks: TaskInfo[]): MobileTasksGrouped {
  const g: MobileTasksGrouped = { inProgress: [], claimable: [], waitingDeps: [], blocked: [] };
  for (const t of tasks) {
    if (t.status !== 'open') continue;
    switch (classifyMobileTask(t)) {
      case 'in-progress':
        g.inProgress.push(t);
        break;
      case 'claimable':
        g.claimable.push(t);
        break;
      case 'waiting-deps':
        g.waitingDeps.push(t);
        break;
      case 'blocked':
        g.blocked.push(t);
        break;
    }
  }
  return g;
}

/**
 * 可执行 count = in-progress + claimable open tasks (the executable/executing working set).
 * Matches the scheme mock arithmetic 可执行 3 = 进行中(1) + 可认领(2).
 */
export function executableCount(tasks: TaskInfo[]): number {
  return tasks.filter((t) => {
    if (t.status !== 'open') return false;
    const c = classifyMobileTask(t);
    return c === 'in-progress' || c === 'claimable';
  }).length;
}

/** 全部 count = every open task in the queue. */
export function allOpenCount(tasks: TaskInfo[]): number {
  return tasks.filter((t) => t.status === 'open').length;
}

export type MobileSegment = 'executable' | 'all';

export interface MobileGroupView {
  group: MobileTaskGroup;
  tasks: TaskInfo[];
}

/**
 * Ordered, non-empty group views for a segment. `all` shows the four groups in scheme order;
 * `executable` shows only 进行中 + 可认领 (the executable working set).
 */
export function orderedGroups(grouped: MobileTasksGrouped, segment: MobileSegment): MobileGroupView[] {
  const all: MobileGroupView[] = [
    { group: 'in-progress', tasks: grouped.inProgress },
    { group: 'claimable', tasks: grouped.claimable },
    { group: 'waiting-deps', tasks: grouped.waitingDeps },
    { group: 'blocked', tasks: grouped.blocked },
  ];
  const scoped =
    segment === 'executable'
      ? all.filter((g) => g.group === 'in-progress' || g.group === 'claimable')
      : all;
  return scoped.filter((g) => g.tasks.length > 0);
}

/** Per-group status dot color — verbatim from scheme L3127/3138/3166/3177 (§8.3 raw values). */
export const MOBILE_GROUP_DOT: Record<MobileTaskGroup, string> = {
  'in-progress': '#C03D33',
  claimable: '#C99A2E',
  'waiting-deps': '#C99A2E',
  blocked: '#C99A2E',
};
