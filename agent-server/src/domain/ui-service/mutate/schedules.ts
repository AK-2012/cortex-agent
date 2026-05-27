// input:  UiServiceDeps + { scheduleId }
// output: pause/resume/remove schedule handlers → Ok<void> | Err
// pos:    mutate handlers for 'schedules.{pause,resume,remove}'

import type { UiServiceDeps, Result } from '../types.js';

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
