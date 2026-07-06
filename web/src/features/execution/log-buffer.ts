// Pure bounded-log reducer for the execution detail live log stream (design 8b, DR-0018 §6.3 F3).
// Frames come from the `execution.log` SSE subscription payload; appendLog accumulates them into a
// ring capped at `cap` lines. Both the backend-reported flood drops (`frame.dropped`) and lines
// evicted here when the cap is exceeded fold into one `dropped` total (the "…N lines dropped"
// marker). Replayed/duplicate frames (seq ≤ lastSeq) are ignored so a reconnect can't double-append.
// Framework-free → unit-tested.

export interface LogFrame {
  lines: string[];
  seq: number;
  dropped?: number;
}

export interface LogState {
  lines: string[];
  dropped: number;
  lastSeq: number | null;
}

export const EMPTY_LOG: LogState = { lines: [], dropped: 0, lastSeq: null };

export function appendLog(state: LogState, frame: LogFrame, cap: number): LogState {
  // Guard against replayed / out-of-order frames on reconnect.
  if (state.lastSeq !== null && frame.seq <= state.lastSeq) {
    return state;
  }

  let dropped = state.dropped + (frame.dropped ?? 0);
  let lines = frame.lines.length > 0 ? [...state.lines, ...frame.lines] : state.lines;

  if (lines.length > cap) {
    dropped += lines.length - cap;
    lines = lines.slice(lines.length - cap);
  }

  return { lines, dropped, lastSeq: frame.seq };
}
