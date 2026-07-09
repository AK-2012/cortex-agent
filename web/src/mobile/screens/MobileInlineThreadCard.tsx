import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { useVocab } from '@/i18n';
import { useThreadGetLiveSync } from '@/features/thread/useThreadGetLiveSync';
import { threadPill } from '@/features/workbench/thread-card-proto';
import { buildMobileStepper } from './mobile-session-vm';
import { MobileThreadStepper } from './MobileThreadStepper';

// Inline experiment-pipeline thread card (scheme 5a L2954-2973), bound to REAL threads.get (B1). The
// contract has no session→thread link (the scheme hard-codes thr_8f2c), so we bind to the most-
// relevant active thread: the first running (else first waiting) live thread from threads.list —
// same discipline as the desktop InlineThreadCardProto. Re-flows live via useThreadGetLiveSync.
// "打开 →" targets the mobile threads tab (mobile thread-detail is 5b scope — flagged).
export function MobileInlineThreadCard(): JSX.Element | null {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const vocab = useVocab();
  const listQuery = useQuery(trpc.threads.list.queryOptions({ status: ['running', 'waiting'] }));

  const threads = listQuery.data ?? [];
  const target = threads.find((t) => t.status === 'running') ?? threads[0] ?? null;
  const threadId = target?.id ?? '';

  useThreadGetLiveSync(threadId);

  const getQuery = useQuery({
    ...trpc.threads.get.queryOptions({ threadId }),
    enabled: !!threadId,
  });

  if (!threadId || getQuery.isPending || getQuery.isError || !getQuery.data) return null;

  const detail = getQuery.data;
  const card = buildMobileStepper(detail);

  return (
    <MobileThreadStepper
      card={card}
      pill={threadPill(detail.status)}
      subthreadsLabel={vocab.subthreads}
      openLabel={vocab.open}
      onOpen={() => navigate('/m/threads')}
    />
  );
}
