import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskInfo } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { groupTasks, type TaskGroup } from './group-tasks';
import { TaskRow } from './TaskRow';
import { useTasksLiveSync } from './useTasksLiveSync';

function GroupSection({
  title,
  groups,
  pendingId,
  onClaim,
  onComplete,
}: {
  title: string;
  groups: TaskGroup[];
  pendingId: string | null;
  onClaim: (t: TaskInfo) => void;
  onComplete: (t: TaskInfo) => void;
}) {
  const count = groups.reduce((n, g) => n + g.tasks.length, 0);
  return (
    <section className="mb-3g">
      <h2 className="mb-1g text-ui font-medium uppercase tracking-wide text-state-ink/60">
        {title} <span className="font-mono text-state-ink/40">({count})</span>
      </h2>
      {count === 0 ? (
        <div className="rounded-card border border-card bg-surface-card px-1.5g py-1g text-ui text-state-ink/40 shadow-card">
          None
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.priority} className="mb-1.5g">
            <h3 className="mb-0.5g font-mono text-ui text-state-ink/45">{group.priority}</h3>
            <div className="flex flex-col gap-1g">
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  pending={pendingId === task.id}
                  onClaim={onClaim}
                  onComplete={onComplete}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

// Tasks tab (design 4a): real tasks.list via tRPC, grouped by lifecycle · priority, with
// live refresh on a daemon-routed mutation (useTasksLiveSync). Claim/Complete drive real
// mutations that emit task events → subscription → invalidate → refetch.
export function TasksPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const tasksQuery = useQuery(trpc.tasks.list.queryOptions({}));
  const [pendingId, setPendingId] = useState<string | null>(null);

  useTasksLiveSync();

  const invalidate = () => queryClient.invalidateQueries(trpc.tasks.list.queryFilter());

  const claim = useMutation(
    trpc.tasks.claim.mutationOptions({
      onSettled: () => {
        setPendingId(null);
        invalidate();
      },
    }),
  );
  const complete = useMutation(
    trpc.tasks.complete.mutationOptions({
      onSettled: () => {
        setPendingId(null);
        invalidate();
      },
    }),
  );

  const onClaim = (t: TaskInfo) => {
    setPendingId(t.id);
    claim.mutate({ projectId: t.project, taskId: t.id });
  };
  const onComplete = (t: TaskInfo) => {
    setPendingId(t.id);
    complete.mutate({ projectId: t.project, taskId: t.id, note: 'completed via Web UI' });
  };

  return (
    <section className="flex h-full flex-col">
      <h1 className="mb-2g text-body font-medium text-state-ink">Tasks</h1>

      {tasksQuery.isPending && (
        <div className="text-ui text-state-ink/40">Loading tasks…</div>
      )}

      {tasksQuery.isError && (
        <div className="rounded-card border border-card bg-pill-failed-bg px-1.5g py-1g text-ui text-pill-failed-fg shadow-card">
          Failed to load tasks: {tasksQuery.error.message}
        </div>
      )}

      {tasksQuery.data &&
        (() => {
          const grouped = groupTasks(tasksQuery.data);
          if (tasksQuery.data.length === 0) {
            return <div className="text-ui text-state-ink/40">No tasks.</div>;
          }
          return (
            <div className="min-h-0 flex-1 overflow-auto">
              <GroupSection
                title="Open"
                groups={grouped.open}
                pendingId={pendingId}
                onClaim={onClaim}
                onComplete={onComplete}
              />
              <GroupSection
                title="Done"
                groups={grouped.done}
                pendingId={pendingId}
                onClaim={onClaim}
                onComplete={onComplete}
              />
            </div>
          );
        })()}
    </section>
  );
}
