// Mobile 5c 任务 screen (scheme.dc.html L3110-3195). Binds the real `tasks.list` into the scheme's
// grouped view, live-refreshes via the shared tasks subscription, and drives 「解除」 through the real
// `tasks.unblock` mutation. Presentation lives in MobileTasksView; grouping in ../mobile-tasks.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskInfo } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { useVocab } from '@/i18n';
import { useTasksLiveSync } from '@/features/tasks/useTasksLiveSync';
import {
  allOpenCount,
  executableCount,
  groupMobileTasks,
  orderedGroups,
  type MobileSegment,
} from '../mobile-tasks';
import { MobileTasksView } from './MobileTasksView';

export function MobileTasksScreen() {
  const vocab = useVocab();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const tasksQuery = useQuery(trpc.tasks.list.queryOptions({}));
  useTasksLiveSync();

  const [segment, setSegment] = useState<MobileSegment>('executable');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries(trpc.tasks.list.queryFilter());
  const unblock = useMutation(
    trpc.tasks.unblock.mutationOptions({
      onSettled: () => {
        setPendingId(null);
        invalidate();
      },
    }),
  );

  const tasks = tasksQuery.data ?? [];
  const grouped = useMemo(() => groupMobileTasks(tasks), [tasks]);
  const groups = orderedGroups(grouped, segment);
  const execCount = executableCount(grouped);
  const totalCount = allOpenCount(grouped);

  const onToggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const onUnblock = (t: TaskInfo) => {
    setPendingId(t.id);
    unblock.mutate({ projectId: t.project, taskId: t.id });
  };

  const empty = tasksQuery.isPending
    ? '…'
    : tasksQuery.isError
      ? tasksQuery.error.message
      : vocab.mNoTasks;

  return (
    <MobileTasksView
      vocab={vocab}
      groups={groups}
      segment={segment}
      executableCount={execCount}
      allCount={totalCount}
      onSegment={setSegment}
      expandedIds={expandedIds}
      onToggleExpand={onToggleExpand}
      pendingId={pendingId}
      onUnblock={onUnblock}
      empty={empty}
    />
  );
}
