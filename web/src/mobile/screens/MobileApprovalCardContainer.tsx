import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { useVocab } from '@/i18n';
import { mobileApprovalDesc } from './mobile-session-vm';
import { MobileApprovalCard } from './MobileApprovalCard';

// Over-budget approval card (scheme 5a L2975-2986), bound to REAL approvals.list ({status:'pending'})
// + approvals.approve / approvals.reject. Shows the first pending entry; hidden when 0 pending
// (honest empty — no fabricated card). The real ApprovalInfo has no estimate/budget/from table
// (task 851f precedent) → the desc shows the real reason/operation, never an invented cost number.
export function MobileApprovalCardContainer(): JSX.Element | null {
  const trpc = useTRPC();
  const vocab = useVocab();
  const queryClient = useQueryClient();
  const listQuery = useQuery(trpc.approvals.list.queryOptions({ status: 'pending' }));

  const invalidate = (): void => {
    queryClient.invalidateQueries(trpc.approvals.list.queryFilter({ status: 'pending' }));
  };
  const approveMut = useMutation(trpc.approvals.approve.mutationOptions({ onSuccess: invalidate }));
  const rejectMut = useMutation(trpc.approvals.reject.mutationOptions({ onSuccess: invalidate }));

  const entry = (listQuery.data ?? [])[0];
  if (!entry) return null;

  const busy = approveMut.isPending || rejectMut.isPending;

  return (
    <MobileApprovalCard
      id={entry.id}
      title={entry.title}
      desc={mobileApprovalDesc(entry)}
      needsApprovalLabel={vocab.needsApproval}
      approveLabel={vocab.approve}
      denyLabel={vocab.deny}
      disabled={busy}
      onApprove={() => approveMut.mutate({ id: entry.id })}
      onDeny={() => rejectMut.mutate({ id: entry.id })}
    />
  );
}
