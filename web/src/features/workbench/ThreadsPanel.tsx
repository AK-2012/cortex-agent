import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ThreadInfo } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { ID, StatusPill } from '@/design';
import { InlineThreadCard } from '@/features/thread/InlineThreadCard';
import { threadScopeFilter, type Scope } from './scope';
import { useThreadsLiveSync } from './useThreadsLiveSync';

function ThreadRow({
  thread,
  expanded,
  onToggle,
}: {
  thread: ThreadInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-1g">
      <div className="flex items-stretch gap-1g">
        <button
          type="button"
          data-thread-id={thread.id}
          data-status={thread.status}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex flex-1 items-center gap-1.5g rounded-card border border-card bg-surface-card px-1.5g py-1g text-left shadow-card transition-colors hover:bg-surface-canvas-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-run/40"
        >
          <span className="shrink-0 font-mono text-ui text-state-ink/40">{expanded ? '▾' : '▸'}</span>
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
        </button>
        <Link
          to={`/threads/${thread.id}`}
          data-open-thread-id={thread.id}
          className="flex shrink-0 items-center rounded-card border border-card bg-surface-card px-1g text-ui text-state-run shadow-card transition-colors hover:bg-surface-canvas-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-run/40"
          title="Open thread detail"
        >
          open ›
        </Link>
      </div>
      {expanded && <InlineThreadCard threadId={thread.id} />}
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        <ThreadRow
          key={t.id}
          thread={t}
          expanded={expandedId === t.id}
          onToggle={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
        />
      ))}
    </div>
  );
}
