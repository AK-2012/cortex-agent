import { useQuery } from '@tanstack/react-query';
import type { SessionInfo } from '@cortex-agent/ui-contract';
import { useTRPC } from '@/lib/trpc';
import { EmptyState } from '@/design';

export interface SessionListProps {
  selectedId: string | null;
  onSelect: (session: SessionInfo) => void;
}

// Left pane (design 3a): real sessions.list. Each row is selectable; selecting drives the
// center chat placeholder. Metadata only — the contract has no transcript scope (Stage 4).
export function SessionList({ selectedId, onSelect }: SessionListProps) {
  const trpc = useTRPC();
  const sessionsQuery = useQuery(trpc.sessions.list.queryOptions({}));

  return (
    <section className="flex h-full w-72 shrink-0 flex-col border-r border-card bg-surface-rail">
      <h2 className="border-b border-card px-2g py-1.5g text-ui font-medium uppercase tracking-wide text-state-ink/60">
        Sessions{' '}
        {sessionsQuery.data && (
          <span className="font-mono text-state-ink/40">({sessionsQuery.data.length})</span>
        )}
      </h2>

      <div className="min-h-0 flex-1 overflow-auto p-1g">
        {sessionsQuery.isPending && (
          <div className="px-1g py-1g text-ui text-state-ink/40">Loading sessions…</div>
        )}

        {sessionsQuery.isError && (
          <div className="rounded-card border border-card bg-pill-failed-bg px-1.5g py-1g text-ui text-pill-failed-fg shadow-card">
            Failed to load sessions: {sessionsQuery.error.message}
          </div>
        )}

        {sessionsQuery.data &&
          (sessionsQuery.data.length === 0 ? (
            <EmptyState title="No sessions" description="Sessions appear here once a conversation starts." />
          ) : (
            <ul className="flex flex-col gap-0.5g">
              {sessionsQuery.data.map((s) => {
                const active = s.sessionId === selectedId;
                return (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      data-session-id={s.sessionId}
                      aria-current={active}
                      onClick={() => onSelect(s)}
                      className={[
                        'flex w-full flex-col gap-0.5g rounded-card px-1.5g py-1g text-left transition-colors',
                        active
                          ? 'bg-pill-running-bg text-pill-running-fg'
                          : 'text-state-ink hover:bg-surface-canvas-alt',
                      ].join(' ')}
                    >
                      <span className="truncate text-ui font-medium" title={s.name}>
                        {s.label || s.name}
                      </span>
                      <span className="flex items-center gap-1g font-mono text-ui text-state-ink/45">
                        <span className="truncate">{s.projectId}</span>
                        <span>·</span>
                        <span>{s.kind}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}
      </div>
    </section>
  );
}
