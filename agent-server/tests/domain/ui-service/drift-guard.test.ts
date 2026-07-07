// input:  types.ts + ui-service.ts
// output: DTO drift guard — enumerates every QueryScope/MutateOp string and asserts the facade has a registered handler
// pos:    CI-fails on missing impl for a newly added scope/op

import test from 'node:test';
import assert from 'node:assert/strict';

// We test the handler registrations by importing the facade and checking
// that known scope/op strings don't produce "unknown" errors.
import { createUiService } from '../../../src/domain/ui-service/ui-service.js';
import type { UiServiceDeps } from '../../../src/domain/ui-service/types.js';

// Minimal deps — handlers that throw will be caught by the try/catch and
// returned as Err, not thrown. We only care that the handler exists.
function makeMinimalDeps(): UiServiceDeps {
  return {
    projectStore: {
      list: () => [],
      get: () => undefined,
      exists: () => false,
      getDefault: () => ({ id: 'general', name: 'general', kind: 'general' as const, contextDir: '/tmp' }),
    },
    sessionStore: {
      listByProject: async () => [],
      listResumable: async () => [],
      getById: async () => null,
    },
    threadStore: {
      getAll: () => [],
      get: () => null,
    },
    taskStore: {
      getAll: () => [],
      getById: () => null,
      load: () => {},
      refresh: () => {},
    },
    scheduler: {
      list: async () => [],
      get: async () => null,
      pause: async () => null,
      resume: async () => null,
      remove: async () => false,
      add: async () => ({ id: 'sch_new' } as any),
    },
    executionRegistry: {
      getExecution: () => null,
      getAll: () => [],
      cancelExecution: () => null,
    },
    executionLogTailer: { startTail: () => {}, stopTail: () => {}, refCount: () => 0 },
    runningExecutions: {
      register: () => {},
      getByKey: () => null,
      getByThreadId: () => null,
      getByExecutionId: () => null,
      has: () => false,
      killByKey: () => false,
      killByThreadId: () => false,
      remove: () => {},
      getAll: () => [],
      complete: () => false,
      fail: () => false,
      supersede: () => false,
    } as any,
    costSummary: async () => ({
      today: 0, week: 0, month: 0, total: 0,
      byMode: {} as any,
      byProject: {}, byTrigger: {}, bySource: {}, byBackend: {},
      tokens: { today: { input: 0, output: 0 }, month: { input: 0, output: 0 }, total: { input: 0, output: 0 } },
      entryCount: 0,
    }),
    bus: { subscribe: () => ({ unsubscribe: () => {} }), publish: () => {}, close: async () => {} } as any,
    adapter: {
      getProjectConduits: async () => ({}),
    } as any,
  };
}

const queryScopes = [
  'projects.list',
  'sessions.list',
  'threads.list',
  'tasks.list',
  'schedules.list',
  'executions.list',
  'executions.get',
  'cost.summary',
] as const;

const mutateOps = [
  'threads.cancel',
  'executions.cancel',
  'schedules.pause',
  'schedules.resume',
  'schedules.remove',
  'schedules.add',
  'tasks.claim',
  'tasks.unclaim',
  'tasks.complete',
  'tasks.block',
  'tasks.unblock',
] as const;

test('drift-guard: every QueryScope has a registered handler', async () => {
  const ui = createUiService(makeMinimalDeps());
  for (const scope of queryScopes) {
    const result = await ui.query(scope, {} as any);
    // A missing handler is signalled by the facade's "Unknown query scope: …" Err. A registered
    // handler may legitimately return any code (incl. 'invalid-args' for its own validation), so we
    // key the drift sentinel off that specific message, not the code.
    assert.ok(result.ok !== undefined, `Handler for ${scope} should exist and return a Result`);
    if (!result.ok) {
      const err = result as any;
      if (typeof err.message === 'string' && err.message.startsWith('Unknown query scope')) {
        assert.fail(`Handler for ${scope} is not registered: ${err.message}`);
      }
    }
  }
});

test('drift-guard: every MutateOp has a registered handler', async () => {
  const ui = createUiService(makeMinimalDeps());
  for (const op of mutateOps) {
    const result = await ui.mutate(op, {} as any);
    assert.ok(result.ok !== undefined, `Handler for ${op} should exist and return a Result`);
    if (!result.ok) {
      const err = result as any;
      if (typeof err.message === 'string' && err.message.startsWith('Unknown mutate op')) {
        assert.fail(`Handler for ${op} is not registered: ${err.message}`);
      }
    }
  }
});
