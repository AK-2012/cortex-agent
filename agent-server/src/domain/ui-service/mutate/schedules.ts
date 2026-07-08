// input:  UiServiceDeps + { scheduleId } | ScheduleAddArgs
// output: pause/resume/remove/add schedule handlers → Ok<void|ScheduleInfo> | Err
// pos:    mutate handlers for 'schedules.{pause,resume,remove,add}'

import type { UiServiceDeps, Result, ScheduleAddArgs, ScheduleInfo } from '../types.js';
import type { ScheduleTask } from '@store/schedule-repo.js';

/** Map a persisted ScheduleTask → ScheduleInfo DTO (mirrors query/schedules.ts). */
function toScheduleInfo(s: ScheduleTask): ScheduleInfo {
  return {
    id: s.id,
    type: s.type,
    message: s.message,
    projectId: s.projectId,
    nextRun: s.nextRun != null ? new Date(s.nextRun).toISOString() : null,
    lastRun: s.lastRun != null ? new Date(s.lastRun).toISOString() : null,
    paused: s.isPaused ?? false,
    pausedBy: s.pausedBy ?? null,
  };
}

export async function handlePauseSchedule(
  deps: UiServiceDeps,
  args: { scheduleId: string },
): Promise<Result<void>> {
  try {
    const updated = await deps.scheduler.pause(args.scheduleId);
    if (!updated) {
      return { ok: false, code: 'not-found', message: `Schedule not found: ${args.scheduleId}` };
    }
    return { ok: true, data: undefined };
  } catch (err: any) {
    return { ok: false, code: 'internal', message: err?.message || String(err) };
  }
}

export async function handleResumeSchedule(
  deps: UiServiceDeps,
  args: { scheduleId: string },
): Promise<Result<void>> {
  try {
    const updated = await deps.scheduler.resume(args.scheduleId);
    if (!updated) {
      return { ok: false, code: 'not-found', message: `Schedule not found: ${args.scheduleId}` };
    }
    return { ok: true, data: undefined };
  } catch (err: any) {
    return { ok: false, code: 'internal', message: err?.message || String(err) };
  }
}

export async function handleRemoveSchedule(
  deps: UiServiceDeps,
  args: { scheduleId: string },
): Promise<Result<void>> {
  try {
    const removed = await deps.scheduler.remove(args.scheduleId);
    if (!removed) {
      return { ok: false, code: 'not-found', message: `Schedule not found: ${args.scheduleId}` };
    }
    return { ok: true, data: undefined };
  } catch (err: any) {
    return { ok: false, code: 'internal', message: err?.message || String(err) };
  }
}

// Create a schedule (DR-0018 §2.1 7c). Re-checks the per-type required fields (mirrors
// domain/mcp/tools/schedule.ts::runScheduleAdd) so a direct facade / unit call is rejected as an Err
// with nothing written; the zod router already rejects the same cases upstream. The injected
// deps.scheduler.add composes the real scheduler.add + schedule-repo backfill of target/fallback.
export async function handleAddSchedule(
  deps: UiServiceDeps,
  args: ScheduleAddArgs,
): Promise<Result<ScheduleInfo>> {
  // Per-type required-field validation — return Err BEFORE calling add() so nothing is written.
  if (args.type === 'interval' && args.intervalMs === undefined) {
    return { ok: false, code: 'invalid-args', message: 'intervalMs is required for type=interval' };
  }
  if ((args.type === 'daily' || args.type === 'weekly') && !args.time) {
    return { ok: false, code: 'invalid-args', message: `time is required for type=${args.type}` };
  }
  if (args.type === 'weekly' && args.dayOfWeek === undefined) {
    return { ok: false, code: 'invalid-args', message: 'dayOfWeek is required for type=weekly' };
  }
  if (args.type === 'once' && args.delay === undefined) {
    return { ok: false, code: 'invalid-args', message: 'delay is required for type=once' };
  }
  if (!args.message) {
    return { ok: false, code: 'invalid-args', message: 'message is required' };
  }

  try {
    const projectId = args.projectId ?? 'general';
    const task = await deps.scheduler.add(args.type, {
      message: args.message,
      projectId,
      profile: args.profile ?? null,
      intervalMs: args.intervalMs,
      time: args.time,
      dayOfWeek: args.dayOfWeek,
      delay: args.delay,
      target: args.target,
      fallback: args.fallback,
    });
    return { ok: true, data: toScheduleInfo(task) };
  } catch (err: any) {
    return { ok: false, code: 'internal', message: err?.message || String(err) };
  }
}
