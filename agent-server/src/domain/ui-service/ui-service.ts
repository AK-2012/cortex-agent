// input:  UiServiceDeps
// output: createUiService(deps): UiService — facade routing scope/op strings to per-module handlers
// pos:    transport-agnostic UI service facade

import type { UiServiceDeps, UiService, QueryScope, MutateOp, Result } from './types.js';
import { handleProjectsList } from './query/projects.js';
import { handleSessionsList } from './query/sessions.js';
import { handleThreadsList, handleThreadsGet } from './query/threads.js';
import { handleTasksList } from './query/tasks.js';
import { handleSchedulesList } from './query/schedules.js';
import { handleExecutionsList } from './query/executions.js';
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
        return { ok: false, code: 'internal', message: err?.message || String(err) };
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
  };
}
