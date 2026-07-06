import { describe, expect, it } from 'vitest';
import { SCOPES, threadScopeFilter, taskScopeFilter, type Scope } from './scope';

// Every thread status the ui-service contract can emit (types.ts ThreadInfo.status).
const THREAD_STATUSES = ['running', 'waiting', 'completed', 'failed', 'cancelled', 'aborted'];

describe('threadScopeFilter', () => {
  it('active → live thread statuses only', () => {
    expect(threadScopeFilter('active')).toEqual(['running', 'waiting']);
  });

  it('history → terminal thread statuses only', () => {
    expect(threadScopeFilter('history')).toEqual(['completed', 'failed', 'cancelled', 'aborted']);
  });

  it('active and history partition the full thread status vocabulary (no overlap, no gap)', () => {
    const active = threadScopeFilter('active');
    const history = threadScopeFilter('history');
    expect([...active, ...history].sort()).toEqual([...THREAD_STATUSES].sort());
    expect(active.some((s) => history.includes(s))).toBe(false);
  });

  it('returns a fresh array (mutating the result does not leak into the constant)', () => {
    const first = threadScopeFilter('active');
    first.push('mutated');
    expect(threadScopeFilter('active')).toEqual(['running', 'waiting']);
  });
});

describe('taskScopeFilter', () => {
  it('active → open, history → done', () => {
    expect(taskScopeFilter('active')).toBe('open');
    expect(taskScopeFilter('history')).toBe('done');
  });

  it('every scope maps to a valid task lifecycle', () => {
    for (const scope of SCOPES as readonly Scope[]) {
      expect(['open', 'done']).toContain(taskScopeFilter(scope));
    }
  });
});
