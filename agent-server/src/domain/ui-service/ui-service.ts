// input:  UiServiceDeps
// output: createUiService(deps): UiService — facade routing scope/op strings to per-module handlers
// pos:    transport-agnostic UI service facade

import type { UiServiceDeps, UiService, QueryScope, MutateOp, Result } from './types.js';
import { handleProjectsList } from './query/projects.js';
import { handleSessionsList } from './query/sessions.js';
import { handleThreadsList, handleThreadsGet } from './query/threads.js';
import { handleTasksList } from './query/tasks.js';
import { handleSchedulesList } from './query/schedules.js';
import { handleExecutionsList, handleExecutionsGet } from './query/executions.js';
import { handleMemoryTree, handleMemoryFile } from './query/memory.js';
import { handleCostSummary } from './query/cost.js';
import { handleCancelThread } from './mutate/threads.js';
import { handleCancelExecution } from './mutate/executions.js';
import {
  handlePauseSchedule,
  handleResumeSchedule,
  handleRemoveSchedule,
} from './mutate/schedules.js';
import {
  handleClaimTask,
  handleUnclaimTask,
  handleCompleteTask,
  handleBlockTask,
  handleUnblockTask,
} from './mutate/tasks.js';
import { createSubscription } from './subscribe.js';
import { resolveExecutionLogLocation } from '@domain/executions/log-tailer.js';

type QueryHandler = (deps: UiServiceDeps, params: any) => Promise<any>;
type MutateHandler = (deps: UiServiceDeps, args: any) => Promise<Result<any>>;

const queryHandlers: Record<string, QueryHandler> = {
  'projects.list': (deps) => handleProjectsList(deps),
  'sessions.list': (deps, params) => handleSessionsList(deps, params),
  'threads.list': (deps, params) => handleThreadsList(deps, params),
  'threads.get': (deps, params) => handleThreadsGet(deps, params),
  'tasks.list': (deps, params) => handleTasksList(deps, params),
  'schedules.list': (deps, params) => handleSchedulesList(deps, params),
  'executions.list': (deps, params) => handleExecutionsList(deps, params),
  'executions.get': (deps, params) => handleExecutionsGet(deps, params),
  'memory.tree': (deps, params) => handleMemoryTree(deps, params),
  'memory.file': (deps, params) => handleMemoryFile(deps, params),
  'cost.summary': (deps, params) => handleCostSummary(deps, params),
};

const mutateHandlers: Record<string, MutateHandler> = {
  'threads.cancel': (deps, args) => handleCancelThread(deps, args),
  'executions.cancel': (deps, args) => handleCancelExecution(deps, args),
  'schedules.pause': (deps, args) => handlePauseSchedule(deps, args),
  'schedules.resume': (deps, args) => handleResumeSchedule(deps, args),
  'schedules.remove': (deps, args) => handleRemoveSchedule(deps, args),
  'tasks.claim': (deps, args) => handleClaimTask(deps, args),
  'tasks.unclaim': (deps, args) => handleUnclaimTask(deps, args),
  'tasks.complete': (deps, args) => handleCompleteTask(deps, args),
  'tasks.block': (deps, args) => handleBlockTask(deps, args),
  'tasks.unblock': (deps, args) => handleUnblockTask(deps, args),
};

export function createUiService(deps: UiServiceDeps): UiService {
  return {
    async query(scope, params) {
      const handler = queryHandlers[scope];
      if (!handler) {
        return { ok: false, code: 'invalid-args', message: `Unknown query scope: ${scope}` };
      }
      try {
        const data = await handler(deps, params);
        return { ok: true, data };
      } catch (err: any) {
        const code = typeof err?.code === 'string' ? err.code : 'internal';
        return { ok: false, code, message: err?.message || String(err) };
      }
    },

    async mutate(op, args) {
      const handler = mutateHandlers[op];
      if (!handler) {
        return { ok: false, code: 'invalid-args', message: `Unknown mutate op: ${op}` };
      }
      try {
        const result = await handler(deps, args);
        // Publish audit event before returning
        deps.bus.publish({
          type: 'ui.mutate-invoked',
          op,
          args,
          result: result.ok ? { ok: true } : { ok: false, code: (result as any).code },
        });
        return result;
      } catch (err: any) {
        const errResult: Result<any> = { ok: false, code: 'internal', message: err?.message || String(err) };
        deps.bus.publish({
          type: 'ui.mutate-invoked',
          op,
          args,
          result: { ok: false, code: 'internal' },
        });
        return errResult;
      }
    },

    subscribe(filter) {
      return createSubscription(deps.bus, filter);
    },

    subscribeExecutionLog(executionId) {
      // Resolve the run's log location from the persisted dispatch.runName (B2-C). When it cannot
      // be resolved (unknown id / no runName / not a cortex-run), hand back an already-closed
      // stream so the client ends cleanly rather than hanging on a tail that will never emit.
      const location = resolveExecutionLogLocation(executionId, {
        getExecution: (id) => deps.executionRegistry.getExecution(id),
      });
      if (!location) {
        const empty = createSubscription(deps.bus, { events: [] });
        empty.close();
        return empty;
      }

      // First subscriber starts the shared tailer (ref-count +1); the last close stops it (-1).
      deps.executionLogTailer.startTail(executionId, location);
      const sub = createSubscription(deps.bus, { events: ['execution.log'], executionId });

      let stopped = false;
      const close = (): void => {
        sub.close();
        if (stopped) return;
        stopped = true;
        deps.executionLogTailer.stopTail(executionId);
      };
      return {
        [Symbol.asyncIterator]: () => sub[Symbol.asyncIterator](),
        close,
      };
    },
  };
}
