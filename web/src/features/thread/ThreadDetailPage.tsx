import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTRPC } from '@/lib/trpc';
import { ID, MonoText, StatusPill } from '@/design';
import { ThreadStepList } from './ThreadStepList';
import { NestedThreadsPanel } from './NestedThreadsPanel';
import { ThreadArtifactsPanel } from './ThreadArtifactsPanel';
import { useThreadGetLiveSync } from './useThreadGetLiveSync';
import { MAX_LEVEL, treeMaxLevel } from './nested-threads';

// Thread detail page (design 11b, DR-0018 §6.3 F2). Full page for one thread:
//   left  — single-column pipeline (reuses ThreadStepList; only the active step expands, showing
//           the inline agent flow + the nested-thread panel 2b for its subthreads);
//   right — thread-level artifacts, persistent (unchanged when the active step switches).
// Nested subthreads (≤5 levels) get the three-state 2b behavior via NestedThreadsPanel; drilling
// into a child navigates here for that child, carrying an ancestor trail for the breadcrumb.

const RUNNING = new Set(['running', 'waiting']);

// Depth dots "x/5" — how many of the 5 levels the tree currently reaches.
function DepthMeter({ levels }: { levels: number }) {
  return (
    <div className="ml-auto flex items-center gap-0.5g" data-depth-levels={levels}>
      <MonoText muted>depth</MonoText>
      {Array.from({ length: MAX_LEVEL }, (_, i) => (
        <span
          key={i}
          className={`h-[6px] w-[6px] rounded-full ${
            i < levels ? 'bg-state-run' : 'bg-state-gray'
          }`}
        />
      ))}
      <MonoText muted>
        {levels}/{MAX_LEVEL}
      </MonoText>
    </div>
  );
}

function Breadcrumb({ trail }: { trail: string[] }) {
  if (trail.length === 0) return null;
  return (
    <nav className="flex flex-wrap items-center gap-1g pb-1g" aria-label="Ancestors">
      {trail.map((id) => (
        <span key={id} className="flex items-center gap-1g">
          <Link
            to={`/threads/${id}`}
            state={{ trail: trail.slice(0, trail.indexOf(id)) }}
            className="text-ui text-state-run hover:underline"
          >
            <ID value={id} />
          </Link>
          <span className="text-state-ink/30">›</span>
        </span>
      ))}
    </nav>
  );
}

export function ThreadDetailPage() {
  const { threadId = '' } = useParams();
  const location = useLocation();
  const trail = ((location.state as { trail?: string[] } | null)?.trail ?? []).filter(
    (id) => id !== threadId,
  );

  const trpc = useTRPC();
  const threadQuery = useQuery(trpc.threads.get.queryOptions({ threadId }));
  useThreadGetLiveSync(threadId);

  if (threadQuery.isPending) {
    return <div className="p-2g text-ui text-state-ink/40">Loading thread…</div>;
  }
  if (threadQuery.isError) {
    return (
      <div className="p-2g">
        <div className="rounded-card border border-card bg-pill-failed-bg px-1.5g py-1g text-ui text-pill-failed-fg shadow-card">
          Failed to load thread {threadId}: {threadQuery.error.message}
        </div>
      </div>
    );
  }

  const detail = threadQuery.data;
  const live = RUNNING.has(detail.status);
  const levels = treeMaxLevel(detail.children);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-thread-detail={detail.id}>
      <header className="flex flex-col gap-1g border-b border-card px-2g py-1.5g">
        <Breadcrumb trail={trail} />
        <div className="flex items-center gap-1g">
          <StatusPill status={detail.status} />
          <ID value={detail.id} />
          <span className="truncate text-ui font-medium text-state-ink">{detail.templateName}</span>
          <MonoText muted className="shrink-0">
            ${detail.totalCostUsd.toFixed(2)}
          </MonoText>
          <DepthMeter levels={levels} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
        <section className="min-h-0 overflow-auto p-2g" data-pipeline="true">
          <ThreadStepList
            detail={detail}
            renderSubthreads={(subthreads) => (
              <NestedThreadsPanel nodes={subthreads} focusId={detail.id} trail={trail} />
            )}
          />
        </section>
        <aside className="min-h-0 overflow-auto border-l border-card p-2g">
          <ThreadArtifactsPanel artifacts={detail.artifacts} live={live} />
        </aside>
      </div>
    </div>
  );
}
