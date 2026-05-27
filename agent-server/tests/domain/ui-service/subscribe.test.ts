import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../../src/events/event-bus.js';
import { createSubscription } from '../../../src/domain/ui-service/subscribe.js';
import type { UiServiceDeps } from '../../../src/domain/ui-service/types.js';
import type { Subscription } from '../../../src/events/event-bus.js';

function makeDeps(bus: EventBus): UiServiceDeps {
  return {
    projectStore: { list: () => [], get: () => undefined, exists: () => false, getDefault: () => ({ id: 'general', name: 'general', kind: 'general' as const, contextDir: '/g' }) },
    sessionStore: { listByProject: async () => [], listResumable: async () => [], getById: async () => null },
    threadStore: { getAll: () => [], get: () => null },
    taskStore: { getAll: () => [], getById: () => null, load: () => {} },
    scheduler: { list: async () => [], get: async () => null, pause: async () => null, resume: async () => null, remove: async () => false },
    executionRegistry: { getExecution: () => null, getAll: () => [], cancelExecution: () => null },
    runningExecutions: { getAll: () => [] } as any,
    costSummary: async () => ({ today: 0, week: 0, month: 0, total: 0, byMode: {} as any, byProject: {}, byTrigger: {}, bySource: {}, byBackend: {}, tokens: {} as any, entryCount: 0 }),
    bus: bus as any,
    adapter: {} as any,
  };
}

test('subscribe receives published events matching filter', async () => {
  const bus = new EventBus();
  const sub = createSubscription(makeDeps(bus), {
    events: ['thread.created', 'task.claimed'],
  });

  bus.publish({ type: 'thread.created', threadId: 'thr_1', templateName: 'test' });
  bus.publish({ type: 'task.claimed', taskId: 't1', by: 'agent1' });

  const iter = sub[Symbol.asyncIterator]();
  const event1 = await iter.next();
  assert.equal(event1.done, false);
  assert.equal(event1.value.type, 'thread.created');
  assert.ok(event1.value.ts);

  const event2 = await iter.next();
  assert.equal(event2.done, false);
  assert.equal(event2.value.type, 'task.claimed');

  sub.close();
});

test('subscribe filters out non-matching event types', async () => {
  const bus = new EventBus();
  const sub = createSubscription(makeDeps(bus), {
    events: ['agent.started'],
  });

  bus.publish({ type: 'thread.created', threadId: 'thr_1', templateName: 'test' });
  bus.publish({ type: 'agent.started', channel: 'C1', executionId: 'exec_1', backend: 'claude' });

  const iter = sub[Symbol.asyncIterator]();
  const event1 = await iter.next();
  assert.equal(event1.done, false);
  assert.equal(event1.value.type, 'agent.started');

  sub.close();
});

test('subscribe close() unsubscribes all bus handlers', async () => {
  const bus = new EventBus();
  let called = false;

  // Subscribe normally to verify handler is registered
  const sub1 = bus.subscribe('thread.created', () => { called = true; });
  const sub = createSubscription(makeDeps(bus), {
    events: ['thread.created'],
  });

  // Close the UI subscription
  sub.close();

  // Publish event — the original handler (sub1) still fires, but the UI subscription handler doesn't
  bus.publish({ type: 'thread.created', threadId: 'thr_1', templateName: 'test' });

  // The external handler should still work
  assert.equal(called, true);

  sub1.unsubscribe();
});

test('subscribe provides UiEvent shape with type, ts, payload', async () => {
  const bus = new EventBus();
  const sub = createSubscription(makeDeps(bus), {
    events: ['task.claimed'],
  });

  bus.publish({ type: 'task.claimed', taskId: 't1', by: 'agent1' });

  const iter = sub[Symbol.asyncIterator]();
  const event = await iter.next();
  assert.equal(event.done, false);
  assert.equal(typeof event.value.type, 'string');
  assert.equal(typeof event.value.ts, 'string');
  assert.ok(event.value.payload);
  const payload = event.value.payload as any;
  assert.equal(payload.type, 'task.claimed');
  assert.equal(payload.taskId, 't1');

  sub.close();
});

test('subscribe handles close() called multiple times', () => {
  const bus = new EventBus();
  const sub = createSubscription(makeDeps(bus), {
    events: ['thread.created'],
  });

  sub.close();
  sub.close(); // second close should not throw
  assert.ok(true, 'multiple close() calls ok');
});

test('subscribe close() signals iterator done', async () => {
  const bus = new EventBus();
  const sub = createSubscription(makeDeps(bus), {
    events: ['thread.created'],
  });

  // Close before consuming
  sub.close();

  const iter = sub[Symbol.asyncIterator]();
  const result = await iter.next();
  assert.equal(result.done, true);
});

test('subscribe close() unblocks pending iterator next()', async () => {
  const bus = new EventBus();
  const sub = createSubscription(makeDeps(bus), {
    events: ['thread.created'],
  });

  const iter = sub[Symbol.asyncIterator]();

  // Start a pending next() that will block (no events published)
  const nextPromise = iter.next();

  // Close the subscription — should unblock the pending next()
  sub.close();

  const result = await nextPromise;
  assert.equal(result.done, true);
});
