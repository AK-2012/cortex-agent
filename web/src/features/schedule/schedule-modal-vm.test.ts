import { describe, it, expect } from 'vitest';
import {
  defaultScheduleForm,
  visibleFields,
  unitToMs,
  buildScheduleAddArgs,
  validateScheduleForm,
  computeNextRun,
  nextRunLabel,
  nextRunParts,
  profileOptions,
  SCHED_TYPES,
  DAY_OPTIONS,
  FALLBACK_OPTIONS,
  TARGET_OPTIONS,
  type ScheduleForm,
} from './schedule-modal-vm';

function form(overrides: Partial<ScheduleForm> = {}): ScheduleForm {
  return { ...defaultScheduleForm('nimbus'), ...overrides };
}

describe('SCHED_TYPES / option lists', () => {
  it('exposes the four schedule types in prototype order', () => {
    expect(SCHED_TYPES).toEqual(['interval', 'daily', 'weekly', 'once']);
  });
  it('day options map Sun..Sat → 0..6', () => {
    expect(DAY_OPTIONS.map((d) => d.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(DAY_OPTIONS[0].label).toBe('Sun');
    expect(DAY_OPTIONS[6].label).toBe('Sat');
  });
  it('fallback options are the real backend enum', () => {
    expect(FALLBACK_OPTIONS).toEqual(['fresh', 'skip', 'wait']);
  });
  it('target options only include constructible kinds', () => {
    expect(TARGET_OPTIONS).toEqual(['current-channel', 'fresh', 'project']);
  });
});

describe('profileOptions', () => {
  it('returns the real profile names unchanged when current is among them', () => {
    expect(profileOptions(['default', 'research'], 'research')).toEqual(['default', 'research']);
  });
  it('appends current once when it is not among the real names', () => {
    expect(profileOptions(['default', 'research'], 'claude-haiku')).toEqual([
      'default',
      'research',
      'claude-haiku',
    ]);
  });
  it('does not duplicate current when it is already present', () => {
    expect(profileOptions(['default', 'default'], 'default')).toEqual(['default']);
  });
  it('no source (undefined names) → only the current value, nothing fabricated', () => {
    expect(profileOptions(undefined, 'claude-haiku')).toEqual(['claude-haiku']);
  });
  it('no source and empty current → empty list', () => {
    expect(profileOptions(undefined, '')).toEqual([]);
    expect(profileOptions([], '')).toEqual([]);
  });
});

describe('defaultScheduleForm', () => {
  it('defaults to a daily 09:00 fresh-fallback form carrying the projectId', () => {
    const f = defaultScheduleForm('nimbus');
    expect(f.type).toBe('daily');
    expect(f.time).toBe('09:00');
    expect(f.fallback).toBe('fresh');
    expect(f.target).toBe('current-channel');
    expect(f.projectId).toBe('nimbus');
    expect(f.message).toBe('');
  });
  it('accepts a null projectId', () => {
    expect(defaultScheduleForm(null).projectId).toBeNull();
  });
});

describe('visibleFields', () => {
  it('interval → only the interval input', () => {
    expect(visibleFields('interval')).toEqual({ time: false, interval: true, dayOfWeek: false, delay: false });
  });
  it('daily → only time', () => {
    expect(visibleFields('daily')).toEqual({ time: true, interval: false, dayOfWeek: false, delay: false });
  });
  it('weekly → time + dayOfWeek', () => {
    expect(visibleFields('weekly')).toEqual({ time: true, interval: false, dayOfWeek: true, delay: false });
  });
  it('once → only delay', () => {
    expect(visibleFields('once')).toEqual({ time: false, interval: false, dayOfWeek: false, delay: true });
  });
});

describe('unitToMs', () => {
  it('converts minutes and hours to milliseconds', () => {
    expect(unitToMs(30, 'min')).toBe(30 * 60_000);
    expect(unitToMs(2, 'hr')).toBe(2 * 3_600_000);
  });
});

describe('buildScheduleAddArgs', () => {
  it('daily → type + time + message + projectId + profile + fallback, no interval/delay/dayOfWeek', () => {
    const args = buildScheduleAddArgs(form({ type: 'daily', message: '  ping  ', profile: 'claude-haiku' }));
    expect(args.type).toBe('daily');
    expect(args.time).toBe('09:00');
    expect(args.message).toBe('ping');
    expect(args.projectId).toBe('nimbus');
    expect(args.profile).toBe('claude-haiku');
    expect(args.fallback).toBe('fresh');
    expect(args.intervalMs).toBeUndefined();
    expect(args.delay).toBeUndefined();
    expect(args.dayOfWeek).toBeUndefined();
  });
  it('interval → raw intervalMs from value+unit, no time', () => {
    const args = buildScheduleAddArgs(form({ type: 'interval', intervalValue: 15, intervalUnit: 'min', message: 'x' }));
    expect(args.intervalMs).toBe(15 * 60_000);
    expect(args.time).toBeUndefined();
  });
  it('weekly → time + dayOfWeek', () => {
    const args = buildScheduleAddArgs(form({ type: 'weekly', time: '07:30', dayOfWeek: 3, message: 'x' }));
    expect(args.time).toBe('07:30');
    expect(args.dayOfWeek).toBe(3);
  });
  it('once → raw delay ms', () => {
    const args = buildScheduleAddArgs(form({ type: 'once', delayValue: 10, delayUnit: 'min', message: 'x' }));
    expect(args.delay).toBe(10 * 60_000);
  });
  it('current-channel target → omit target (no constructible channel)', () => {
    const args = buildScheduleAddArgs(form({ target: 'current-channel', message: 'x' }));
    expect(args.target).toBeUndefined();
  });
  it('fresh target → {kind:fresh}', () => {
    const args = buildScheduleAddArgs(form({ target: 'fresh', message: 'x' }));
    expect(args.target).toEqual({ kind: 'fresh' });
  });
  it('project target → {kind:project, projectId}', () => {
    const args = buildScheduleAddArgs(form({ target: 'project', projectId: 'nimbus', message: 'x' }));
    expect(args.target).toEqual({ kind: 'project', projectId: 'nimbus' });
  });
  it('omits projectId/profile when absent', () => {
    const args = buildScheduleAddArgs(form({ projectId: null, profile: '', message: 'x' }));
    expect(args.projectId).toBeUndefined();
    expect(args.profile).toBeUndefined();
  });
});

describe('validateScheduleForm', () => {
  it('rejects an empty message', () => {
    expect(validateScheduleForm(form({ message: '   ' })).ok).toBe(false);
  });
  it('interval requires a positive value', () => {
    expect(validateScheduleForm(form({ type: 'interval', intervalValue: 0, message: 'x' })).ok).toBe(false);
    expect(validateScheduleForm(form({ type: 'interval', intervalValue: 5, message: 'x' })).ok).toBe(true);
  });
  it('daily/weekly require a HH:MM time', () => {
    expect(validateScheduleForm(form({ type: 'daily', time: '9:00', message: 'x' })).ok).toBe(false);
    expect(validateScheduleForm(form({ type: 'daily', time: '09:00', message: 'x' })).ok).toBe(true);
  });
  it('weekly requires a dayOfWeek in 0..6', () => {
    expect(validateScheduleForm(form({ type: 'weekly', time: '09:00', dayOfWeek: 7, message: 'x' })).ok).toBe(false);
    expect(validateScheduleForm(form({ type: 'weekly', time: '09:00', dayOfWeek: 6, message: 'x' })).ok).toBe(true);
  });
  it('once requires a positive delay', () => {
    expect(validateScheduleForm(form({ type: 'once', delayValue: 0, message: 'x' })).ok).toBe(false);
    expect(validateScheduleForm(form({ type: 'once', delayValue: 3, message: 'x' })).ok).toBe(true);
  });
});

describe('computeNextRun / nextRunLabel', () => {
  it('daily 09:00 from 08:08 same day → 52 minutes out', () => {
    const now = new Date(2026, 6, 7, 8, 8, 0); // local 08:08
    const next = computeNextRun(form({ type: 'daily', time: '09:00' }), now);
    expect(next.getTime() - now.getTime()).toBe(52 * 60_000);
    expect(nextRunLabel(form({ type: 'daily', time: '09:00' }), now)).toBe('next run 09:00 · in 52m');
  });
  it('daily time already passed → rolls to tomorrow', () => {
    const now = new Date(2026, 6, 7, 10, 0, 0);
    const next = computeNextRun(form({ type: 'daily', time: '09:00' }), now);
    expect(next.getDate()).toBe(8);
  });
  it('interval → now + intervalMs', () => {
    const now = new Date(2026, 6, 7, 8, 0, 0);
    const label = nextRunLabel(form({ type: 'interval', intervalValue: 30, intervalUnit: 'min' }), now);
    expect(label).toContain('in 30m');
  });
  it('once → now + delay', () => {
    const now = new Date(2026, 6, 7, 8, 0, 0);
    const label = nextRunLabel(form({ type: 'once', delayValue: 2, delayUnit: 'hr' }), now);
    expect(label).toContain('in 2h');
  });
  it('humanizes multi-hour deltas', () => {
    const now = new Date(2026, 6, 7, 8, 0, 0);
    const label = nextRunLabel(form({ type: 'daily', time: '10:30' }), now);
    expect(label).toBe('next run 10:30 · in 2h 30m');
  });
  it('nextRunParts splits clock and delta for the styled footer', () => {
    const now = new Date(2026, 6, 7, 8, 8, 0);
    expect(nextRunParts(form({ type: 'daily', time: '09:00' }), now)).toEqual({ clock: '09:00', delta: '52m' });
  });
});
