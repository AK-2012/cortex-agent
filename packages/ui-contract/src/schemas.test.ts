import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryInputSchemas, mutateInputSchemas } from './schemas.js';

const QUERY_SCOPES = [
  'projects.list', 'sessions.list', 'threads.list', 'threads.get', 'tasks.list',
  'schedules.list', 'executions.list', 'executions.get', 'memory.tree', 'memory.file',
  'cost.summary', 'config.get',
] as const;

const MUTATE_OPS = [
  'threads.cancel', 'executions.cancel', 'schedules.pause', 'schedules.resume',
  'schedules.remove', 'tasks.claim', 'tasks.unclaim', 'tasks.complete',
  'tasks.block', 'tasks.unblock', 'config.set',
] as const;

test('every QueryScope has an input schema', () => {
  for (const scope of QUERY_SCOPES) {
    assert.ok(queryInputSchemas[scope], `missing query schema: ${scope}`);
  }
  assert.equal(Object.keys(queryInputSchemas).length, QUERY_SCOPES.length);
});

test('every MutateOp has an input schema', () => {
  for (const op of MUTATE_OPS) {
    assert.ok(mutateInputSchemas[op], `missing mutate schema: ${op}`);
  }
  assert.equal(Object.keys(mutateInputSchemas).length, MUTATE_OPS.length);
});

test('query schemas accept valid input', () => {
  assert.deepEqual(queryInputSchemas['projects.list'].parse({}), {});
  assert.equal(
    queryInputSchemas['tasks.list'].parse({ projectId: 'p', status: 'open', actionable: true }).status,
    'open',
  );
  assert.deepEqual(
    queryInputSchemas['executions.list'].parse({ status: ['running'], limit: 5 }),
    { status: ['running'], limit: 5 },
  );
  assert.deepEqual(
    queryInputSchemas['executions.get'].parse({ executionId: 'exec_1' }),
    { executionId: 'exec_1' },
  );
  // cost.summary projectId is nullable
  assert.deepEqual(queryInputSchemas['cost.summary'].parse({ projectId: null }), { projectId: null });
  // threads.get requires a threadId
  assert.deepEqual(queryInputSchemas['threads.get'].parse({ threadId: 'thr_a' }), { threadId: 'thr_a' });
  // memory.tree requires a projectId
  assert.deepEqual(queryInputSchemas['memory.tree'].parse({ projectId: 'p' }), { projectId: 'p' });
  // memory.file requires projectId + path
  assert.deepEqual(
    queryInputSchemas['memory.file'].parse({ projectId: 'p', path: 'STATUS.md' }),
    { projectId: 'p', path: 'STATUS.md' },
  );
});

test('query schemas reject invalid input', () => {
  assert.throws(() => queryInputSchemas['tasks.list'].parse({ status: 'nope' }));
  assert.throws(() => queryInputSchemas['executions.list'].parse({ limit: 'ten' }));
  assert.throws(() => queryInputSchemas['threads.get'].parse({}));
  assert.throws(() => queryInputSchemas['sessions.list'].parse({ resumable: 'yes' }));
  assert.throws(() => queryInputSchemas['memory.tree'].parse({}));
  assert.throws(() => queryInputSchemas['memory.file'].parse({ projectId: 'p' }));
});

test('mutate schemas require their mandatory fields', () => {
  assert.deepEqual(mutateInputSchemas['threads.cancel'].parse({ threadId: 't1' }), { threadId: 't1' });
  assert.deepEqual(
    mutateInputSchemas['tasks.claim'].parse({ projectId: 'p', taskId: 'f184' }),
    { projectId: 'p', taskId: 'f184' },
  );
  // tasks.block requires reason
  assert.throws(() => mutateInputSchemas['tasks.block'].parse({ projectId: 'p', taskId: 'f184' }));
  assert.deepEqual(
    mutateInputSchemas['tasks.block'].parse({ projectId: 'p', taskId: 'f184', reason: 'stuck' }),
    { projectId: 'p', taskId: 'f184', reason: 'stuck' },
  );
  // missing required id
  assert.throws(() => mutateInputSchemas['threads.cancel'].parse({}));
  assert.throws(() => mutateInputSchemas['tasks.claim'].parse({ projectId: 'p' }));
});

test('config.get accepts an empty object', () => {
  assert.deepEqual(queryInputSchemas['config.get'].parse({}), {});
});

test('config.set accepts a valid budget and rejects illegal values / sections', () => {
  assert.deepEqual(
    mutateInputSchemas['config.set'].parse({ section: 'budget', value: { daily_usd: 100, monthly_usd: 2000 } }),
    { section: 'budget', value: { daily_usd: 100, monthly_usd: 2000 } },
  );
  // negative / zero rejected
  assert.throws(() => mutateInputSchemas['config.set'].parse({ section: 'budget', value: { daily_usd: -1, monthly_usd: 2000 } }));
  // missing field rejected
  assert.throws(() => mutateInputSchemas['config.set'].parse({ section: 'budget', value: { daily_usd: 100 } }));
  // unknown section rejected
  assert.throws(() => mutateInputSchemas['config.set'].parse({ section: 'profiles', value: {} }));
});
