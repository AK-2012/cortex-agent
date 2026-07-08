// Pure form → schedules.add logic for the New-schedule overlay (design 7c, prototype L1431-1459).
// Framework-free so the DTO/value mapping is unit-tested in isolation. The modal (ScheduleModal.tsx)
// and the provider (ScheduleModalProvider.tsx) hold React state + the tRPC mutation; this file only
// derives: which fields a TYPE shows, the real `ScheduleAddArgs` payload, validation, and the footer
// next-run label. intervalMs / delay are raw ms ints per the backend zod contract (scheduleAddInput).

import type { ScheduleAddArgs } from '@cortex-agent/ui-contract';

export type SchedType = 'interval' | 'daily' | 'weekly' | 'once';
export type IntervalUnit = 'min' | 'hr';
export type FallbackKind = 'fresh' | 'skip' | 'wait';
// Only target kinds the browser can actually construct. `current-channel` (the prototype default)
// and an explicit thread/channel target have no source in the web contract → not offered / omitted
// (flagged data gap); the scheduler applies its own default when `target` is absent.
export type TargetChoice = 'current-channel' | 'fresh' | 'project';

export const SCHED_TYPES: SchedType[] = ['interval', 'daily', 'weekly', 'once'];
export const INTERVAL_UNITS: IntervalUnit[] = ['min', 'hr'];
export const FALLBACK_OPTIONS: FallbackKind[] = ['fresh', 'skip', 'wait'];
export const TARGET_OPTIONS: TargetChoice[] = ['current-channel', 'fresh', 'project'];

export const DAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

// PROFILE has no `profiles` tRPC scope (c3ce precedent: profile-menu is a static set). `profile` is
// optional in ScheduleAddArgs, so this static list is a flagged placeholder, not backend-driven.
export const PROFILE_OPTIONS: string[] = ['claude-haiku', 'claude-sonnet', 'claude-opus', 'research'];

export interface ScheduleForm {
  type: SchedType;
  message: string;
  profile: string;
  time: string; // HH:MM (daily / weekly)
  dayOfWeek: number; // 0..6 (weekly)
  intervalValue: number; // interval
  intervalUnit: IntervalUnit;
  delayValue: number; // once
  delayUnit: IntervalUnit;
  target: TargetChoice;
  fallback: FallbackKind;
  projectId: string | null;
}

export function defaultScheduleForm(projectId: string | null): ScheduleForm {
  return {
    type: 'daily',
    message: '',
    profile: 'claude-haiku',
    time: '09:00',
    dayOfWeek: 1,
    intervalValue: 30,
    intervalUnit: 'min',
    delayValue: 10,
    delayUnit: 'min',
    target: 'current-channel',
    fallback: 'fresh',
    projectId,
  };
}

export interface FieldVisibility {
  time: boolean;
  interval: boolean;
  dayOfWeek: boolean;
  delay: boolean;
}

export function visibleFields(type: SchedType): FieldVisibility {
  return {
    time: type === 'daily' || type === 'weekly',
    interval: type === 'interval',
    dayOfWeek: type === 'weekly',
    delay: type === 'once',
  };
}

export function unitToMs(value: number, unit: IntervalUnit): number {
  return unit === 'hr' ? value * 3_600_000 : value * 60_000;
}

const TIME_RE = /^\d{2}:\d{2}$/;

function buildTarget(choice: TargetChoice, projectId: string | null): ScheduleAddArgs['target'] {
  if (choice === 'fresh') return { kind: 'fresh' };
  if (choice === 'project') return { kind: 'project', projectId: projectId ?? 'general' };
  return undefined; // current-channel → let the scheduler default (no constructible channel here)
}

export function buildScheduleAddArgs(form: ScheduleForm): ScheduleAddArgs {
  const args: ScheduleAddArgs = {
    type: form.type,
    message: form.message.trim(),
    fallback: form.fallback,
  };
  if (form.projectId) args.projectId = form.projectId;
  if (form.profile) args.profile = form.profile;

  if (form.type === 'interval') args.intervalMs = unitToMs(form.intervalValue, form.intervalUnit);
  if (form.type === 'daily' || form.type === 'weekly') args.time = form.time;
  if (form.type === 'weekly') args.dayOfWeek = form.dayOfWeek;
  if (form.type === 'once') args.delay = unitToMs(form.delayValue, form.delayUnit);

  const target = buildTarget(form.target, form.projectId);
  if (target) args.target = target;

  return args;
}

export interface Validation {
  ok: boolean;
  errors: string[];
}

export function validateScheduleForm(form: ScheduleForm): Validation {
  const errors: string[] = [];
  if (form.message.trim().length === 0) errors.push('message is required');
  if (form.type === 'interval' && !(form.intervalValue > 0)) errors.push('interval must be > 0');
  if ((form.type === 'daily' || form.type === 'weekly') && !TIME_RE.test(form.time))
    errors.push('time must be HH:MM');
  if (form.type === 'weekly' && !(form.dayOfWeek >= 0 && form.dayOfWeek <= 6))
    errors.push('dayOfWeek must be 0..6');
  if (form.type === 'once' && !(form.delayValue > 0)) errors.push('delay must be > 0');
  return { ok: errors.length === 0, errors };
}

export function computeNextRun(form: ScheduleForm, now: Date): Date {
  if (form.type === 'interval') return new Date(now.getTime() + unitToMs(form.intervalValue, form.intervalUnit));
  if (form.type === 'once') return new Date(now.getTime() + unitToMs(form.delayValue, form.delayUnit));

  // daily / weekly: next occurrence of HH:MM (weekly also advances to the target weekday)
  const [h, m] = form.time.split(':').map((n) => parseInt(n, 10));
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (form.type === 'daily') {
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
  // weekly
  let deltaDays = (form.dayOfWeek - now.getDay() + 7) % 7;
  if (deltaDays === 0 && next.getTime() <= now.getTime()) deltaDays = 7;
  next.setDate(next.getDate() + deltaDays);
  return next;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function humanizeDelta(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m === 0 ? `${h}h` : `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function nextRunParts(form: ScheduleForm, now: Date): { clock: string; delta: string } {
  const next = computeNextRun(form, now);
  return {
    clock: `${pad2(next.getHours())}:${pad2(next.getMinutes())}`,
    delta: humanizeDelta(next.getTime() - now.getTime()),
  };
}

export function nextRunLabel(form: ScheduleForm, now: Date): string {
  const { clock, delta } = nextRunParts(form, now);
  return `next run ${clock} · in ${delta}`;
}
