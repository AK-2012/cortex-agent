import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handlePauseSchedule,
  handleResumeSchedule,
  handleRemoveSchedule,
} from '../../../src/domain/ui-service/mutate/schedules.js';
import type { UiServiceDeps } from '../../../src/domain/ui-service/types.js';

function makeDeps(overrides: Partial<UiServiceDeps> = {}): UiServiceDeps {
  return {
    projectStore: { list: () => [], get: () => undefined, exists: () => false, getDefault: () => ({ id: 'general', name: 'general', kind: 'general' as const, contextDir: '/g' }), createProject: () => ({ ok: false, code: 'invalid-name' as const, message: 'stub' }) },
    sessionStore: { listByProject: async () => [], listResumable: async () => [], getById: async () => null },
    threadStore: { getAll: () => [], get: () => null },
    taskStore: { getAll: () => [], getById: () => null, load: () => {}, refresh: () => {} },
    scheduler: { list: async () => [], get: async () => null, pause: async () => null, resume: async () => null, remove: async () => false },
    executionRegistry: { getExecution: () => null, getAll: () => [], cancelExecution: () => null },
    executionLogTailer: { startTail: () => {}, stopTail: () => {}, refCount: () => 0 },
    runningExecutions: { getAll: () => [] } as any,
    costSummary: async () => ({ today: 0, week: 0, month: 0, total: 0, byMode: {} as any, byProject: {}, byTrigger: {}, bySource: {}, byBackend: {}, tokens: {} as any, entryCount: 0 }),
    bus: { subscribe: () => ({ unsubscribe: () => {} }), publish: () => {} } as any,
    adapter: {} as any,
    ...overrides,
  };
}

test('schedules.pause returns not-found on missing schedule', async () => {
  const result = await handlePauseSchedule(makeDeps(), { scheduleId: 'sch_missing' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'not-found');
});

test('schedules.pause returns ok on success', async () => {
  const result = await handlePauseSchedule(makeDeps({
    scheduler: { list: async () => [], get: async () => null, pause: async () => ({ id: 'sch1', isPaused: true } as any), resume: async () => null, remove: async () => false },
  }), { scheduleId: 'sch1' });
  assert.equal(result.ok, true);
});

test('schedules.resume returns not-found on missing schedule', async () => {
  const result = await handleResumeSchedule(makeDeps(), { scheduleId: 'sch_missing' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'not-found');
});

test('schedules.resume returns ok on success', async () => {
  const result = await handleResumeSchedule(makeDeps({
    scheduler: { list: async () => [], get: async () => null, pause: async () => null, resume: async () => ({ id: 'sch1', isPaused: false } as any), remove: async () => false },
  }), { scheduleId: 'sch1' });
  assert.equal(result.ok, true);
});

test('schedules.remove returns not-found on missing schedule', async () => {
  const result = await handleRemoveSchedule(makeDeps(), { scheduleId: 'sch_missing' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'not-found');
});

test('schedules.remove returns ok on success', async () => {
  const result = await handleRemoveSchedule(makeDeps({
    scheduler: { list: async () => [], get: async () => null, pause: async () => null, resume: async () => null, remove: async () => true },
  }), { scheduleId: 'sch1' });
  assert.equal(result.ok, true);
});
