// input:  job-registry + Scheduler
// output: initScheduledRunner + setSchedulerRef + createScheduler
// pos:    scheduled task execution and programmatic task dispatch — delegates to domain/scheduling/job-registry
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { dispatch, ctx, register } from './job-registry.js';

// Import job modules to trigger self-registration at module load
import './jobs/scheduled-task.js';
import './jobs/task-dispatch.js';
import './jobs/memory-index-regen.js';
import './jobs/task-archive.js';
import './jobs/sync-public.js';

import { Scheduler } from './scheduler.js';
import type { EventBus } from '@events/index.js';
import type { PlatformAdapter } from '@platform/index.js';

export function initScheduledRunner(adapter: PlatformAdapter): void { ctx.adapter = adapter; }
export function setSchedulerRef(s: Scheduler): void { ctx.schedulerRef = s; }
export function setBus(bus: EventBus): void { ctx.bus = bus; }
export function setInteractiveCallbacksFactory(factory: import('./job-registry.js').InteractiveCallbacksFactory): void { ctx.buildInteractiveCallbacks = factory; }

export function createScheduler(): Scheduler {
  const sched = new Scheduler(
    async (params) => { dispatch('scheduled-task', params); },
    async (params) => { dispatch('task-dispatch', params); },
    {
      'memory-index-regen': async (params) => { dispatch('memory-index-regen', params); },
      'task-archive': async (params) => { dispatch('task-archive', params); },
      'sync-public': async (params) => { dispatch('sync-public', params); },
    },
  );
  ctx.schedulerRef = sched;
  return sched;
}

export { cancelDispatchedTask } from './jobs/task-dispatch.js';
