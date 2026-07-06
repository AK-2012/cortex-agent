import { useQuery } from '@tanstack/react-query';
import type { ThreadInfo } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { ID, StatusPill } from '@/design';
import { threadScopeFilter, type Scope } from './scope';
import { useThreadsLiveSync } from './useThreadsLiveSync';

function ThreadRow({ thread }: { thread: ThreadInfo }) {
  return (
    <div
      data-thread-id={thread.id}
      data-status={thread.status}
      className="flex items-center gap-1.5g rounded-card border border-card bg-surface-card px-1.5g py-1g shadow-card"
    >
      <ID value={thread.id} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui text-state-ink" title={thread.templateName}>
          {thread.templateName}
        </div>
        {thread.currentStep && (
          <div className="truncate font-mono text-ui text-state-ink/45">
            {thread.currentStep.index + 1}/{thread.totalSteps} · {thread.currentStep.name}
          </div>
        )}
      </div>
      <StatusPill status={thread.status} />
    </div>
  );
}

export interface ThreadsPanelProps {
  scope: Scope;
}

// Workbench right-panel Threads tab (design 3a): real threads.list filtered by Active/History
// (status[] server-side), live-updating on thread lifecycle events. Loading/error/empty states.
export function ThreadsPanel({ scope }: ThreadsPanelProps) {
  const trpc = useTRPC();
  const threadsQuery = useQuery(
    trpc.threads.list.queryOptions({ status: threadScopeFilter(scope) }),
  );

  useThreadsLiveSync();

  if (threadsQuery.isPending) {
    return <div className="text-ui text-state-ink/40">Loading threads…</div>;
  }

  if (threadsQuery.isError) {
    return (
      <div className="rounded-card border border-card bg-pill-failed-bg px-1.5g py-1g text-ui text-pill-failed-fg shadow-card">
        Failed to load threads: {threadsQuery.error.message}
      </div>
    );
  }

  if (threadsQuery.data.length === 0) {
    return (
      <div className="text-ui text-state-ink/40">
        No {scope === 'active' ? 'active' : 'past'} threads.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1g overflow-auto">
      {threadsQuery.data.map((t) => (
        <ThreadRow key={t.id} thread={t} />
      ))}
    </div>
  );
}
