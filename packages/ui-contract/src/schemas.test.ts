import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryInputSchemas, mutateInputSchemas } from './schemas.js';

const QUERY_SCOPES = [
  'projects.list', 'sessions.list', 'threads.list', 'tasks.list',
  'schedules.list', 'executions.list', 'cost.summary',
] as const;

const MUTATE_OPS = [
  'threads.cancel', 'executions.cancel', 'schedules.pause', 'schedules.resume',
  'schedules.remove', 'tasks.claim', 'tasks.unclaim', 'tasks.complete',
  'tasks.block', 'tasks.unblock',
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
  // cost.summary projectId is nullable
  assert.deepEqual(queryInputSchemas['cost.summary'].parse({ projectId: null }), { projectId: null });
});

test('query schemas reject invalid input', () => {
  assert.throws(() => queryInputSchemas['tasks.list'].parse({ status: 'nope' }));
  assert.throws(() => queryInputSchemas['executions.list'].parse({ limit: 'ten' }));
  assert.throws(() => queryInputSchemas['sessions.list'].parse({ resumable: 'yes' }));
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
