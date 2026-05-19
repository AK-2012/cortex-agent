// input:  nothing (leaf module)
// output: channelQueues Map + enqueue() — per-channel serial work queue
// pos:    orch/ layer [S6-B]
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

/**
 * Per-channel serial Promise queue. Each channel has at most one tail entry.
 * Consumers may call .has(channel) to check whether a queue is already running
 * (e.g. to show a hourglass reaction), and .delete(channel) to discard a
 * pending tail (e.g. !cancel).
 */
export const channelQueues = new Map<string, Promise<void>>();

/**
 * Append fn to the channel's serial queue.
 *
 * Returns true if a queue was already running for this channel when enqueue()
 * was called (useful for showing backpressure indicators). Returns false if
 * this is the first entry for the channel.
 *
 * The queue entry is automatically removed once fn resolves or rejects, so
 * the Map never accumulates stale entries for completed channels.
 */
export function enqueue(channel: string, fn: () => Promise<void>): boolean {
  const hadExisting = channelQueues.has(channel);
  const prev = channelQueues.get(channel) || Promise.resolve();
  const next = prev.then(fn, fn);
  channelQueues.set(channel, next);
  next.finally(() => {
    if (channelQueues.get(channel) === next) channelQueues.delete(channel);
  });
  return hadExisting;
}
