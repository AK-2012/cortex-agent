import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { Card, CardBody, CardHeader, ID, MonoText, StatusPill } from '@/design';
import { ThreadStepList } from './ThreadStepList';
import { useThreadGetLiveSync } from './useThreadGetLiveSync';

export interface InlineThreadCardProps {
  threadId: string;
}

// Inline thread card (design 11a, DR-0018 §6.3 F1): renders a real threads.get (ThreadDetail) as a
// vertical step pipeline via ThreadStepList — completed steps collapsed, the active step expanded
// with its dispatches/subthreads — and re-flows live via useThreadGetLiveSync. Chat is the ultimate
// host (Stage 4); until then this mounts in the workbench Threads tab (row expand).
export function InlineThreadCard({ threadId }: InlineThreadCardProps) {
  const trpc = useTRPC();
  const threadQuery = useQuery(trpc.threads.get.queryOptions({ threadId }));

  useThreadGetLiveSync(threadId);

  if (threadQuery.isPending) {
    return <div className="text-ui text-state-ink/40">Loading thread…</div>;
  }

  if (threadQuery.isError) {
    return (
      <div className="rounded-card border border-card bg-pill-failed-bg px-1.5g py-1g text-ui text-pill-failed-fg shadow-card">
        Failed to load thread: {threadQuery.error.message}
      </div>
    );
  }

  const detail = threadQuery.data;

  return (
    <div data-inline-thread-id={detail.id}>
      <Card>
        <CardHeader>
        <div className="flex items-center gap-1g">
          <StatusPill status={detail.status} />
          <ID value={detail.id} />
          <span className="truncate text-ui font-medium text-state-ink">{detail.templateName}</span>
          <MonoText muted className="ml-auto shrink-0">
            ${detail.totalCostUsd.toFixed(2)}
          </MonoText>
        </div>
        </CardHeader>
        <CardBody>
          <ThreadStepList detail={detail} />
        </CardBody>
      </Card>
    </div>
  );
}
