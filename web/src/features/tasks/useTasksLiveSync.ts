import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '@/lib/trpc';

// Task lifecycle events the daemon publishes through taskMutator (mutator.ts) and bridges
// onto the UiService subscription (subscribe.ts). unclaim/unblock deliberately absent —
// the CortexEvent union has no such events, so they cannot drive a live refresh.
const TASK_EVENTS = ['task.claimed', 'task.completed', 'task.blocked', 'task.dispatched'];

/**
 * Open one SSE subscription for task lifecycle events and invalidate the `tasks.list`
 * query on each, so the Tasks tab re-fetches and re-renders live after a mutation routed
 * through the daemon (query→mutate→event→invalidate→refetch). Closes on unmount.
 */
export function useTasksLiveSync(): void {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    const sub = client.subscribe.subscribe(
      { events: TASK_EVENTS },
      {
        onData: () => {
          queryClient.invalidateQueries(trpc.tasks.list.queryFilter());
        },
      },
    );
    return () => sub.unsubscribe();
  }, [client, queryClient, trpc]);
}
