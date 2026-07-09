import { describe, it, expect } from 'vitest';
import type { TaskInfo } from '@cortex-agent/ui-contract';
import {
  classifyMobileTask,
  groupMobileTasks,
  executableCount,
  allOpenCount,
  orderedGroups,
  MOBILE_GROUP_DOT,
} from './mobile-tasks';

function task(over: Partial<TaskInfo>): TaskInfo {
  return {
    id: 'T-000',
    text: 'a task',
    project: 'cortex-self',
    status: 'open',
    priority: 'medium',
    actionable: false,
    claimedBy: null,
    blockedBy: null,
    dependsOn: [],
    plan: null,
    template: 'coder-review',
    ...over,
  };
}

describe('classifyMobileTask', () => {
  it('blocked (blockedBy set) takes precedence over everything', () => {
    expect(classifyMobileTask(task({ blockedBy: 'ssh down', claimedBy: 'thr_1', actionable: true }))).toBe(
      'blocked',
    );
  });

  it('claimed (claimedBy set, not blocked) → in-progress', () => {
    expect(classifyMobileTask(task({ claimedBy: 'thr_1' }))).toBe('in-progress');
  });

  it('actionable + unclaimed + unblocked → claimable', () => {
    expect(classifyMobileTask(task({ actionable: true }))).toBe('claimable');
  });

  it('open, not actionable/claimed/blocked (unmet deps) → waiting-deps', () => {
    expect(classifyMobileTask(task({ dependsOn: ['T-1'], actionable: false }))).toBe('waiting-deps');
  });
});

describe('groupMobileTasks', () => {
  it('buckets by classifier and excludes done tasks entirely', () => {
    const tasks = [
      task({ id: 'A', claimedBy: 'thr_a' }), // in-progress
      task({ id: 'B', actionable: true }), // claimable
      task({ id: 'C', actionable: true }), // claimable
      task({ id: 'D', dependsOn: ['A'] }), // waiting-deps
      task({ id: 'E', blockedBy: 'robot offline' }), // blocked
      task({ id: 'F', status: 'done', actionable: true }), // excluded
    ];
    const g = groupMobileTasks(tasks);
    expect(g.inProgress.map((t) => t.id)).toEqual(['A']);
    expect(g.claimable.map((t) => t.id)).toEqual(['B', 'C']);
    expect(g.waitingDeps.map((t) => t.id)).toEqual(['D']);
    expect(g.blocked.map((t) => t.id)).toEqual(['E']);
  });

  it('preserves input order within a group', () => {
    const g = groupMobileTasks([
      task({ id: 'X', actionable: true }),
      task({ id: 'Y', actionable: true }),
    ]);
    expect(g.claimable.map((t) => t.id)).toEqual(['X', 'Y']);
  });
});

describe('segment counts', () => {
  const tasks = [
    task({ id: 'A', claimedBy: 'thr_a' }), // in-progress
    task({ id: 'B', actionable: true }), // claimable
    task({ id: 'C', actionable: true }), // claimable
    task({ id: 'D', dependsOn: ['A'] }), // waiting-deps
    task({ id: 'E', blockedBy: 'x' }), // blocked
    task({ id: 'F', status: 'done' }), // excluded
  ];

  it('executableCount = in-progress + claimable (open only)', () => {
    // scheme mock arithmetic: 可执行 3 = in-progress(1) + claimable(2)
    expect(executableCount(tasks)).toBe(3);
  });

  it('allOpenCount = every open task', () => {
    expect(allOpenCount(tasks)).toBe(5);
  });
});

describe('orderedGroups', () => {
  const grouped = groupMobileTasks([
    task({ id: 'A', claimedBy: 'thr_a' }),
    task({ id: 'B', actionable: true }),
    task({ id: 'D', dependsOn: ['A'] }),
    task({ id: 'E', blockedBy: 'x' }),
  ]);

  it('all: 进行中 → 可认领 → 等依赖 → 已阻塞 order, non-empty only', () => {
    expect(orderedGroups(grouped, 'all').map((g) => g.group)).toEqual([
      'in-progress',
      'claimable',
      'waiting-deps',
      'blocked',
    ]);
  });

  it('executable: only in-progress + claimable', () => {
    expect(orderedGroups(grouped, 'executable').map((g) => g.group)).toEqual([
      'in-progress',
      'claimable',
    ]);
  });

  it('omits empty groups', () => {
    const g = groupMobileTasks([task({ id: 'B', actionable: true })]);
    expect(orderedGroups(g, 'all').map((x) => x.group)).toEqual(['claimable']);
  });
});

describe('MOBILE_GROUP_DOT', () => {
  it('maps each group to the verbatim scheme dot hex', () => {
    expect(MOBILE_GROUP_DOT['in-progress']).toBe('#C03D33');
    expect(MOBILE_GROUP_DOT.claimable).toBe('#C99A2E');
    expect(MOBILE_GROUP_DOT['waiting-deps']).toBe('#C99A2E');
    expect(MOBILE_GROUP_DOT.blocked).toBe('#C99A2E');
  });
});
