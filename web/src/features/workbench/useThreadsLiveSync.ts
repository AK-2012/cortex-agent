import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '@/lib/trpc';

// Thread lifecycle events the daemon publishes on the EventBus (event-types.ts) and bridges
// onto the UiService subscription. Any of them can change what threads.list returns for the
// current Active/History scope, so each invalidates the query → refetch → re-render.
const THREAD_EVENTS = [
  'thread.created',
  'thread.step.started',
  'thread.step.finished',
  'thread.completed',
  'thread.failed',
];

/**
 * Open one SSE subscription for thread lifecycle events and invalidate the `threads.list`
 * query on each, so the workbench Threads tab re-fetches live after a daemon-routed thread
 * transition. Closes on unmount. Mirrors features/tasks/useTasksLiveSync.
 */
export function useThreadsLiveSync(): void {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    const sub = client.subscribe.subscribe(
      { events: THREAD_EVENTS },
      {
        onData: () => {
          queryClient.invalidateQueries(trpc.threads.list.queryFilter());
        },
      },
    );
    return () => sub.unsubscribe();
  }, [client, queryClient, trpc]);
}
