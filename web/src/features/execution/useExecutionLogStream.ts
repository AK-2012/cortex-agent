import { useEffect, useState } from 'react';
import { useTRPCClient } from '@/lib/trpc';
import { appendLog, EMPTY_LOG, type LogFrame, type LogState } from './log-buffer';

// Bound: keep at most this many lines in the live viewer (older lines evict into the drop count).
export const LOG_CAP = 2000;

// Opens one SSE subscription on `executions.log` for a running cortex-run execution and accumulates
// each frame's lines into a bounded buffer via the pure appendLog reducer (design 8b, §6.3
// F3). Gated on `enabled` (a live log is only subscribable when the dispatch has a runName). Resets
// and re-subscribes when the executionId changes; closes on unmount. All buffer logic lives in
// log-buffer (unit-tested) — this hook is the thin React/SSE glue.
//
// Each frame arrives as a UiEvent wrapper { type:'execution.log', ts, payload: { lines, seq, dropped? } }
// (subscribe.ts wraps the bus event under `payload`), so the log data is read off `event.payload`.
export function useExecutionLogStream(executionId: string, enabled: boolean): LogState {
  const client = useTRPCClient();
  const [state, setState] = useState<LogState>(EMPTY_LOG);

  useEffect(() => {
    if (!enabled) return;
    setState(EMPTY_LOG);
    const sub = client.executions.log.subscribe(
      { executionId },
      {
        onData: (event: { payload?: unknown }) => {
          const p = event.payload as { lines?: unknown; seq?: unknown; dropped?: unknown } | undefined;
          if (!p || !Array.isArray(p.lines)) return; // ignore non-log frames (e.g. overflow marker)
          const frame: LogFrame = {
            lines: p.lines as string[],
            seq: typeof p.seq === 'number' ? p.seq : 0,
            dropped: typeof p.dropped === 'number' ? p.dropped : undefined,
          };
          setState((s) => appendLog(s, frame, LOG_CAP));
        },
      },
    );
    return () => sub.unsubscribe();
  }, [client, executionId, enabled]);

  return state;
}
