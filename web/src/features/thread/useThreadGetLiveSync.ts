import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '@/lib/trpc';

// Thread lifecycle events (event-types.ts, bridged onto the UiService subscription). Any of them
// can change what threads.get returns for the open card (a step starts/finishes, the thread ends),
// so each invalidates the threads.get query for THIS thread → refetch → the card re-flows.
const THREAD_EVENTS = [
  'thread.created',
  'thread.step.started',
  'thread.step.finished',
  'thread.completed',
  'thread.failed',
];

/**
 * Open one SSE subscription for thread lifecycle events and invalidate the `threads.get` query
 * for `threadId` on each, so the inline thread card re-fetches live after a daemon-routed thread
 * transition. Closes on unmount. Mirrors features/workbench/useThreadsLiveSync.
 */
export function useThreadGetLiveSync(threadId: string): void {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    const sub = client.subscribe.subscribe(
      { events: THREAD_EVENTS },
      {
        onData: () => {
          queryClient.invalidateQueries(trpc.threads.get.queryFilter({ threadId }));
        },
      },
    );
    return () => sub.unsubscribe();
  }, [client, queryClient, trpc, threadId]);
}
