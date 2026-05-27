// input:  EventBus + SubscribeFilter
// output: AsyncIterable<UiEvent> & { close() } — bounded queue, overflow emits synthetic dropped event
// pos:    subscribe primitive for UiService

import type { UiServiceDeps, SubscribeFilter, UiEvent } from './types.js';

const QUEUE_CAP = 256;

interface AsyncQueue<T> {
  push(item: T): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

function createAsyncQueue<T>(cap: number): AsyncQueue<T> {
  const buffer: T[] = [];
  let resolve: ((value: IteratorResult<T>) => void) | null = null;
  let closed = false;

  return {
    push(item: T): void {
      if (closed) return;
      if (buffer.length >= cap) {
        // Drop oldest and emit synthetic event
        buffer.shift();
      }
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: item, done: false });
      } else {
        buffer.push(item);
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> => {
          if (buffer.length > 0) {
            const value = buffer.shift()!;
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise((res) => {
            resolve = res;
          });
        },
      };
    },
  };
}

export function createSubscription(
  deps: UiServiceDeps,
  filter: SubscribeFilter,
): AsyncIterable<UiEvent> & { close(): void } {
  const eventTypes = filter.events;
  const projectId = filter.projectId ?? null;
  const queue = createAsyncQueue<UiEvent>(QUEUE_CAP);

  const subscriptions = eventTypes.map((type) => {
    const sub = deps.bus.subscribe(type as any, (event: any) => {
      // Post-filter by projectId if specified
      if (projectId && event.projectId && event.projectId !== projectId) {
        return;
      }
      // Post-filter by payload projectId if not already on the event
      if (projectId && event.payload?.projectId && event.payload.projectId !== projectId) {
        return;
      }
      const uiEvent: UiEvent = {
        type: event.type,
        ts: event.ts,
        payload: event,
      };
      queue.push(uiEvent);
    });
    return sub;
  });

  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const sub of subscriptions) {
      sub.unsubscribe();
    }
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<UiEvent> {
      return queue[Symbol.asyncIterator]();
    },
    close,
  };
}
