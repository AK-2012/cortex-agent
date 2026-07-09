import { describe, it, expect } from 'vitest';
import { MOBILE_TABS, activeTabId, isTabRoute, tabBadge } from './mobile-tabs';

describe('MOBILE_TABS', () => {
  it('is the 4 bottom tabs in design order: sessions / threads / tasks / machines', () => {
    expect(MOBILE_TABS.map((t) => t.id)).toEqual(['sessions', 'threads', 'tasks', 'machines']);
  });

  it('every tab has an /m-namespaced path and a vocab label key', () => {
    for (const t of MOBILE_TABS) {
      expect(t.path.startsWith('/m/')).toBe(true);
      expect(typeof t.labelKey).toBe('string');
      expect(t.labelKey.length).toBeGreaterThan(0);
    }
  });

  it('the label key matches the tab id (会话/线程/任务/机器 come from useVocab)', () => {
    expect(MOBILE_TABS.map((t) => t.labelKey)).toEqual([
      'sessions',
      'threads',
      'tasks',
      'machines',
    ]);
  });
});

describe('activeTabId', () => {
  it('resolves each tab path to its own id', () => {
    expect(activeTabId('/m/sessions')).toBe('sessions');
    expect(activeTabId('/m/threads')).toBe('threads');
    expect(activeTabId('/m/tasks')).toBe('tasks');
    expect(activeTabId('/m/machines')).toBe('machines');
  });

  it('treats sub-paths of a tab as that tab', () => {
    expect(activeTabId('/m/threads/thr_abcd')).toBe('threads');
  });

  it('keeps the sessions tab active for the approvals / overview sub-screens (reached from 会话)', () => {
    expect(activeTabId('/m/approvals')).toBe('sessions');
    expect(activeTabId('/m/overview')).toBe('sessions');
  });

  it('defaults to sessions for an unknown path (catch-all lands there)', () => {
    expect(activeTabId('/workbench')).toBe('sessions');
    expect(activeTabId('/')).toBe('sessions');
  });
});

describe('isTabRoute', () => {
  it('is true for the 4 tab paths (and their sub-paths)', () => {
    expect(isTabRoute('/m/sessions')).toBe(true);
    expect(isTabRoute('/m/threads')).toBe(true);
    expect(isTabRoute('/m/tasks')).toBe(true);
    expect(isTabRoute('/m/machines')).toBe(true);
    expect(isTabRoute('/m/threads/thr_abcd')).toBe(true);
  });

  it('is false for the non-Tab sub-screens (10e approvals / 10f overview)', () => {
    expect(isTabRoute('/m/approvals')).toBe(false);
    expect(isTabRoute('/m/overview')).toBe(false);
  });
});

describe('tabBadge', () => {
  it('shows the active-thread count on the threads tab when > 0', () => {
    expect(tabBadge('threads', { activeThreadCount: 3, hasPendingApproval: false })).toEqual({
      count: 3,
    });
  });

  it('shows no badge on the threads tab when the count is 0', () => {
    expect(tabBadge('threads', { activeThreadCount: 0, hasPendingApproval: false })).toEqual({});
  });

  it('shows the amber approval dot on the sessions tab when an approval is pending', () => {
    expect(tabBadge('sessions', { activeThreadCount: 0, hasPendingApproval: true })).toEqual({
      dot: true,
    });
  });

  it('shows no dot on the sessions tab when nothing is pending', () => {
    expect(tabBadge('sessions', { activeThreadCount: 5, hasPendingApproval: false })).toEqual({});
  });

  it('never decorates tasks / machines tabs', () => {
    expect(tabBadge('tasks', { activeThreadCount: 9, hasPendingApproval: true })).toEqual({});
    expect(tabBadge('machines', { activeThreadCount: 9, hasPendingApproval: true })).toEqual({});
  });
});
