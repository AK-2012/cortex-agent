// input:  schedules.json + JsonRepository
// output: ScheduleRepo (read / addTask / removeTask / updateTask / rateLimitThrottle)
// pos:    Schedule persistence layer. Based on JsonRepository abstraction (Pattern A), AsyncMutex serializes reads/writes of schedules.json.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import { JsonRepository } from './json-repository.js';
import { STORE_DIR } from '@core/paths.js';

export const SCHEDULES_FILE = path.join(STORE_DIR, 'schedules.json');

/** Where a fired scheduled-task should land. Resolved by the cortex_schedule_add MCP tool
 *  (or schedule-cli) at create time — `__current__` placeholders are concretized then, so
 *  list/get always show real IDs. The 4 kinds map to the dispatch branches in
 *  scheduling/jobs/scheduled-task.ts. */
export type ScheduleTarget =
  | { kind: 'fresh' }
  /** Fire into the channel — reuses any active thread / channel-default session. */
  | { kind: 'channel'; channel: string }
  /** Fire into a specific cortex-XXXX session, reusing its sessionId. Channel+sessionId are locked at create time. */
  | { kind: 'session'; sessionName: string; sessionId: string; channel: string }
  /** Continue a specific thread; only valid while thread.status is running|waiting. */
  | { kind: 'thread'; threadId: string; channel: string };

export interface ScheduleTask {
  id: string;
  type: 'interval' | 'daily' | 'weekly' | 'once';
  message: string;
  channel: string;
  profile: string | null;
  intervalMs?: number;
  time?: string;
  dayOfWeek?: number;
  delay?: number;
  runAt?: number;
  nextRun?: number | null;
  createdAt: number;
  isPaused?: boolean;
  pausedAt?: number | null;
  pausedBy?: 'user' | 'rate-limit' | null;
  lastRun?: number | null;
  lastSkipped?: number | null;
  dispatchType?: string;
  preCheck?: string;
  taskConfigHash?: string;
  /** Dispatch routing — defaults to { kind: 'fresh' } for legacy records. */
  target?: ScheduleTarget;
  /** What to do when target session/thread no longer exists at fire time.
   *  fresh: silently fall back to fresh-thread dispatch.
   *  skip:  record lastSkipped, post a Slack one-liner, do not run.
   *  wait:  reschedule short delay (max 3 retries), then fall back to fresh. */
  fallback?: 'fresh' | 'skip' | 'wait';
}

export interface SchedulesData {
  tasks: ScheduleTask[];
  rateLimitThrottle?: { resetsAt: number; activatedAt: number; modes?: string[] } | null;
}

function defaultData(): SchedulesData {
  return { tasks: [] };
}

function migrate(raw: unknown): SchedulesData {
  if (typeof raw !== 'object' || raw === null || !('tasks' in raw)) {
    return defaultData();
  }
  const data = raw as SchedulesData;
  // Backfill target=fresh on records persisted before the multi-target dispatch landed,
  // so the scheduler can dispatch them through the unified branch table without null-checks.
  for (const task of data.tasks) {
    if (!task.target) task.target = { kind: 'fresh' };
  }
  return data;
}

export class ScheduleRepo {
  private _repo: JsonRepository<SchedulesData>;

  constructor(filePath: string = SCHEDULES_FILE) {
    this._repo = new JsonRepository<SchedulesData>({
      filePath,
      defaultValue: defaultData,
      migrate,
    });
  }

  async read(): Promise<SchedulesData> {
    return this._repo.read();
  }

  async addTask(task: ScheduleTask): Promise<void> {
    await this._repo.mutate((data) => {
      data.tasks.push(task);
      return { next: data, result: undefined };
    });
  }

  async removeTask(id: string): Promise<boolean> {
    return this._repo.mutate((data) => {
      const idx = data.tasks.findIndex(t => t.id === id);
      if (idx === -1) return { next: data, result: false };
      data.tasks.splice(idx, 1);
      return { next: data, result: true };
    });
  }

  async updateTask(id: string, fn: (task: ScheduleTask) => void): Promise<ScheduleTask | null> {
    return this._repo.mutate((data) => {
      const task = data.tasks.find(t => t.id === id);
      if (!task) return { next: data, result: null };
      fn(task);
      return { next: data, result: task };
    });
  }

  async findTask(id: string): Promise<ScheduleTask | null> {
    const data = await this._repo.read();
    return data.tasks.find(t => t.id === id) || null;
  }

  async setRateLimitThrottle(meta: { resetsAt: number; activatedAt: number; modes?: string[] } | null): Promise<void> {
    await this._repo.mutate((data) => {
      data.rateLimitThrottle = meta;
      return { next: data, result: undefined };
    });
  }

  async getRateLimitThrottle(): Promise<{ resetsAt: number; activatedAt: number; modes?: string[] } | null> {
    const data = await this._repo.read();
    return data.rateLimitThrottle || null;
  }

  /** Generic mutate passthrough for composite operations. */
  async mutate<R>(fn: (data: SchedulesData) => { next: SchedulesData; result: R }): Promise<R> {
    return this._repo.mutate(fn);
  }

  /** Drop the in-memory cache so the next read() fetches from disk. Test hook. */
  invalidate(): void {
    this._repo.invalidate();
  }

  /** Wait for any in-flight mutate() to complete. For graceful SIGTERM drain. */
  flush(): Promise<void> {
    return this._repo.flush();
  }
}

export const scheduleRepo = new ScheduleRepo();  // default singleton for production use
