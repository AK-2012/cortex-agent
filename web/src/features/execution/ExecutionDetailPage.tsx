import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTRPC } from '@/lib/trpc';
import { ID, MonoText, StatusPill } from '@/design';
import { ExecutionDetailRail } from './ExecutionDetailRail';
import { LogStreamView } from './LogStreamView';
import { useExecutionLogStream } from './useExecutionLogStream';
import { formatCost, logStreamEnabled } from './execution-detail';

// Execution detail page (design 8b, DR-0018 §6.3 F3). Renders a real executions.get (lifecycle /
// watchdog / GPU / cost right rail) for one execution, with a live-scrolling cortex-run log stream
// (B2-C executions.log) on the left and a working Stop (executions.cancel). Reached from a thread
// dispatch row (ThreadStepList) via /executions/:executionId.
//
// Right-rail metrics/status have no lifecycle bus event to invalidate on, so poll while running;
// the log stream itself is push (SSE). Stop invalidates the query so the status flips on cancel.
export function ExecutionDetailPage() {
  const { executionId = '' } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const execQuery = useQuery(
    trpc.executions.get.queryOptions(
      { executionId },
      { refetchInterval: (q) => (q.state.data?.status === 'running' ? 3000 : false) },
    ),
  );

  const detail = execQuery.data;
  const enabled = detail ? logStreamEnabled(detail) : false;
  const logState = useExecutionLogStream(executionId, enabled);

  const [stopping, setStopping] = useState(false);
  const cancel = useMutation(
    trpc.executions.cancel.mutationOptions({
      onSettled: () => {
        setStopping(false);
        queryClient.invalidateQueries(trpc.executions.get.queryFilter({ executionId }));
      },
    }),
  );
  const onStop = () => {
    setStopping(true);
    cancel.mutate({ executionId });
  };

  if (execQuery.isPending) {
    return <div className="p-2g text-ui text-state-ink/40">Loading execution…</div>;
  }
  if (execQuery.isError) {
    const notFound =
      (execQuery.error as { data?: { code?: string } }).data?.code === 'NOT_FOUND';
    return (
      <div className="p-2g">
        <div className="rounded-card border border-card bg-pill-failed-bg px-1.5g py-1g text-ui text-pill-failed-fg shadow-card">
          {notFound
            ? `Execution ${executionId} not found.`
            : `Failed to load execution ${executionId}: ${execQuery.error.message}`}
        </div>
      </div>
    );
  }

  const d = execQuery.data;
  const running = d.status === 'running';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-execution-detail={d.id}>
      <header className="flex items-center gap-1g border-b border-card px-2g py-1.5g">
        <StatusPill status={d.status} />
        <ID value={d.id} />
        <span className="truncate text-ui font-medium text-state-ink">
          {d.text.label ?? d.kind}
        </span>
        <MonoText muted className="ml-auto shrink-0">
          {formatCost(d.metrics.costUsd)}
        </MonoText>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
        <section className="min-h-0 overflow-hidden p-2g" data-log-pane="true">
          <LogStreamView state={logState} enabled={enabled} running={running} />
        </section>
        <aside className="min-h-0 overflow-auto border-l border-card p-2g">
          <ExecutionDetailRail detail={d} onStop={onStop} stopping={stopping || cancel.isPending} />
        </aside>
      </div>
    </div>
  );
}
