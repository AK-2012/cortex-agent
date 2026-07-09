import { describe, it, expect } from 'vitest';
import type { ScheduleInfo, ExecutionInfo } from '@cortex-agent/ui-contract';
import {
  projectAvatarInitials,
  relTimeZh,
  intervalLabelZh,
  nextRunLabelZh,
  lastRunLabelZh,
  countTodayExecutions,
  activeThreadCountLabelZh,
} from './overview-mobile-vm';

const sched = (p: Partial<ScheduleInfo>): ScheduleInfo => ({
  id: 's1',
  type: 'interval',
  message: 'x',
  projectId: 'proj',
  nextRun: null,
  lastRun: null,
  paused: false,
  pausedBy: null,
  ...p,
});

const exec = (p: Partial<ExecutionInfo>): ExecutionInfo => ({
  id: 'exec_1',
  type: 'local',
  status: 'running',
  taskId: null,
  sessionId: null,
  projectId: 'proj',
  machine: null,
  startedAt: '2026-07-09T00:00:00.000Z',
  finishedAt: null,
  durationMs: null,
  cost: null,
  ...p,
});

describe('projectAvatarInitials', () => {
  it('takes the first char of the first two hyphen/underscore/space words', () => {
    expect(projectAvatarInitials('quad-nav-sim2real')).toBe('QN');
    expect(projectAvatarInitials('cortex_self')).toBe('CS');
    expect(projectAvatarInitials('data flywheel')).toBe('DF');
  });
  it('takes the first two chars of a single-word id', () => {
    expect(projectAvatarInitials('flywheel')).toBe('FL');
    expect(projectAvatarInitials('a')).toBe('A');
  });
  it('returns a dash for null / empty', () => {
    expect(projectAvatarInitials(null)).toBe('—');
    expect(projectAvatarInitials('')).toBe('—');
    expect(projectAvatarInitials('   ')).toBe('—');
  });
});

describe('relTimeZh', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z');
  it('formats sub-minute / minutes / hours / days', () => {
    expect(relTimeZh('2026-07-09T11:59:40.000Z', now)).toBe('刚刚');
    expect(relTimeZh('2026-07-09T11:45:00.000Z', now)).toBe('15 分钟');
    expect(relTimeZh('2026-07-09T09:00:00.000Z', now)).toBe('3 小时');
    expect(relTimeZh('2026-07-06T12:00:00.000Z', now)).toBe('3 天');
  });
  it('handles missing / unparseable input', () => {
    expect(relTimeZh(null, now)).toBe('—');
    expect(relTimeZh('not-a-date', now)).toBe('—');
  });
});

describe('intervalLabelZh', () => {
  it('renders 每天 HH:MM for daily with a nextRun', () => {
    const s = sched({ type: 'daily', nextRun: '2026-07-10T07:30:00.000Z' });
    // hh:mm derived from local time of nextRun
    expect(intervalLabelZh(s)).toMatch(/^每天 \d{2}:\d{2}$/);
  });
  it('renders 每周 HH:MM for weekly with a nextRun', () => {
    const s = sched({ type: 'weekly', nextRun: '2026-07-10T07:30:00.000Z' });
    expect(intervalLabelZh(s)).toMatch(/^每周 \d{2}:\d{2}$/);
  });
  it('falls back to the raw type when no clock is derivable', () => {
    expect(intervalLabelZh(sched({ type: 'interval' }))).toBe('interval');
    expect(intervalLabelZh(sched({ type: 'daily', nextRun: null }))).toBe('daily');
  });
});

describe('nextRunLabelZh', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z');
  it('formats hours / minutes ahead', () => {
    expect(nextRunLabelZh('2026-07-10T07:00:00.000Z', now)).toBe('19 小时后');
    expect(nextRunLabelZh('2026-07-09T12:10:00.000Z', now)).toBe('10 分钟后');
  });
  it('says 即将 when due and — when absent', () => {
    expect(nextRunLabelZh('2026-07-09T11:59:00.000Z', now)).toBe('即将');
    expect(nextRunLabelZh(null, now)).toBe('—');
  });
});

describe('lastRunLabelZh', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z');
  it('formats time since the last run (outcome NOT fabricated)', () => {
    expect(lastRunLabelZh('2026-07-09T10:00:00.000Z', now)).toBe('上次 2 小时前');
    expect(lastRunLabelZh('2026-07-09T11:45:00.000Z', now)).toBe('上次 15 分钟前');
  });
  it('says 未运行 when never run', () => {
    expect(lastRunLabelZh(null, now)).toBe('未运行');
  });
});

describe('countTodayExecutions', () => {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  it('counts executions started on the same local calendar day as now', () => {
    const list = [
      exec({ id: 'a', startedAt: iso(now) }),
      exec({ id: 'b', startedAt: iso(now) }),
      // three days earlier is unambiguously a different calendar day in any timezone
      exec({ id: 'c', startedAt: iso(now - 3 * 86400000) }),
    ];
    expect(countTodayExecutions(list, now)).toBe(2);
  });
  it('ignores executions with no startedAt', () => {
    expect(countTodayExecutions([exec({ startedAt: null as unknown as string })], now)).toBe(0);
  });
  it('is 0 for an empty list', () => {
    expect(countTodayExecutions([], now)).toBe(0);
  });
});

describe('activeThreadCountLabelZh', () => {
  it('renders N 线程运行中', () => {
    expect(activeThreadCountLabelZh(2)).toBe('2 线程运行中');
    expect(activeThreadCountLabelZh(0)).toBe('0 线程运行中');
  });
});
