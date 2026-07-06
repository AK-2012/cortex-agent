import { describe, it, expect } from 'vitest';
import type { TaskInfo } from '@cortex-agent/ui-contract';
import { groupTasks, PRIORITY_ORDER } from './group-tasks';

function task(partial: Partial<TaskInfo> & Pick<TaskInfo, 'id' | 'status' | 'priority'>): TaskInfo {
  return {
    text: `task ${partial.id}`,
    project: 'p',
    actionable: partial.status === 'open',
    claimedBy: null,
    blockedBy: null,
    dependsOn: [],
    plan: null,
    template: 'coder-review',
    ...partial,
  };
}

describe('groupTasks', () => {
  it('returns empty open/done groups for empty input', () => {
    const g = groupTasks([]);
    expect(g.open).toEqual([]);
    expect(g.done).toEqual([]);
  });

  it('splits by lifecycle: open before done', () => {
    const g = groupTasks([
      task({ id: 'a', status: 'done', priority: 'high' }),
      task({ id: 'b', status: 'open', priority: 'high' }),
    ]);
    expect(g.open.flatMap((grp) => grp.tasks.map((t) => t.id))).toEqual(['b']);
    expect(g.done.flatMap((grp) => grp.tasks.map((t) => t.id))).toEqual(['a']);
  });

  it('orders priority groups high → medium → low within a lifecycle', () => {
    const g = groupTasks([
      task({ id: 'lo', status: 'open', priority: 'low' }),
      task({ id: 'hi', status: 'open', priority: 'high' }),
      task({ id: 'md', status: 'open', priority: 'medium' }),
    ]);
    expect(g.open.map((grp) => grp.priority)).toEqual(['high', 'medium', 'low']);
    expect(g.open.map((grp) => grp.tasks.map((t) => t.id))).toEqual([['hi'], ['md'], ['lo']]);
  });

  it('omits empty priority groups', () => {
    const g = groupTasks([task({ id: 'x', status: 'open', priority: 'medium' })]);
    expect(g.open.map((grp) => grp.priority)).toEqual(['medium']);
  });

  it('preserves input order (stable) within a priority group', () => {
    const g = groupTasks([
      task({ id: 'first', status: 'open', priority: 'high' }),
      task({ id: 'second', status: 'open', priority: 'high' }),
      task({ id: 'third', status: 'open', priority: 'high' }),
    ]);
    expect(g.open[0].tasks.map((t) => t.id)).toEqual(['first', 'second', 'third']);
  });

  it('groups done tasks by priority too', () => {
    const g = groupTasks([
      task({ id: 'd1', status: 'done', priority: 'low' }),
      task({ id: 'd2', status: 'done', priority: 'high' }),
    ]);
    expect(g.done.map((grp) => grp.priority)).toEqual(['high', 'low']);
    expect(g.done.map((grp) => grp.tasks.map((t) => t.id))).toEqual([['d2'], ['d1']]);
  });

  it('exposes the canonical priority order', () => {
    expect(PRIORITY_ORDER).toEqual(['high', 'medium', 'low']);
  });
});
