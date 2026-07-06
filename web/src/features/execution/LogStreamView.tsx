import { useEffect, useRef } from 'react';
import { EmptyState } from '@/design';
import type { LogState } from './log-buffer';

// Live log viewer (design 8b, DR-0018 §6.3 F3). Mono, scrollable; auto-scrolls to the bottom on
// new lines unless the user has scrolled up (sticky-bottom). Purely presentational — the SSE
// subscription + bounded buffer live in useExecutionLogStream. Token-only styling (no hard-coded hex).

export interface LogStreamViewProps {
  state: LogState;
  // false when the execution is not a cortex-run (no runName) → no subscribable log stream.
  enabled: boolean;
  running: boolean;
}

export function LogStreamView({ state, enabled, running }: LogStreamViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.lines, state.dropped]);

  if (!enabled) {
    return (
      <EmptyState
        title="No live log"
        description="This execution has no run name — it is not a cortex-run launch, so no live log stream is available."
      />
    );
  }

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div data-log-stream="true" className="flex h-full min-h-0 flex-col">
      {state.dropped > 0 && (
        <div className="shrink-0 pb-1g text-ui text-state-wait">
          … {state.dropped} line{state.dropped === 1 ? '' : 's'} dropped
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto rounded-card border border-card bg-surface-card p-1g shadow-card"
      >
        {state.lines.length === 0 ? (
          <span className="text-ui text-state-ink/40">
            {running ? 'waiting for output…' : 'no log output'}
          </span>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-ui text-state-ink/90">
            {state.lines.join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}
