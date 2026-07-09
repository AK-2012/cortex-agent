// Container for one 5b thread card: binds the real `threads.get` (B1) step-tree on expand and the real
// `threads.cancel` mutation on 取消, delegating all rendering to the prop-driven MobileThreadCardView.
// Running threads default-open (scheme shows the running experiment-pipeline expanded); others collapse
// to a header row and lazy-fetch on open. Mirrors the desktop RightThreadCard container.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ThreadInfo, ThreadDetail, ThreadChildNode } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { useVocab } from '@/i18n';
import { useThreadGetLiveSync } from '@/features/thread/useThreadGetLiveSync';
import { MobileThreadCardView } from './MobileThreadViews';

function LiveCard({
  thread,
  detail,
  now,
  onToggle,
  onDrill,
}: {
  thread: ThreadInfo;
  detail: ThreadDetail;
  now: number;
  onToggle: () => void;
  onDrill: (n: ThreadChildNode) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const vocab = useVocab();
  useThreadGetLiveSync(thread.id);
  const cancel = useMutation(
    trpc.threads.cancel.mutationOptions({
      onSettled: () => {
        queryClient.invalidateQueries(trpc.threads.list.queryFilter());
        queryClient.invalidateQueries(trpc.threads.get.queryFilter({ threadId: thread.id }));
      },
    }),
  );
  return (
    <MobileThreadCardView
      thread={thread}
      detail={detail}
      now={now}
      vocab={vocab}
      expanded
      onToggle={onToggle}
      onCancel={() => cancel.mutate({ threadId: thread.id })}
      onDrill={onDrill}
    />
  );
}

export function MobileThreadCard({
  thread,
  now,
  onDrill,
}: {
  thread: ThreadInfo;
  now: number;
  onDrill: (n: ThreadChildNode) => void;
}) {
  const [open, setOpen] = useState(thread.status === 'running');
  const trpc = useTRPC();
  const vocab = useVocab();
  const detailQuery = useQuery({
    ...trpc.threads.get.queryOptions({ threadId: thread.id }),
    enabled: open,
  });

  if (open && detailQuery.data) {
    return (
      <LiveCard thread={thread} detail={detailQuery.data} now={now} onToggle={() => setOpen(false)} onDrill={onDrill} />
    );
  }
  return (
    <MobileThreadCardView
      thread={thread}
      now={now}
      vocab={vocab}
      expanded={open}
      loading={open && detailQuery.isPending}
      onToggle={() => setOpen((o) => !o)}
      onCancel={() => {}}
      onDrill={onDrill}
    />
  );
}
