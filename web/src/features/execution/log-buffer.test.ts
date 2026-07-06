import { describe, expect, it } from 'vitest';
import { appendLog, EMPTY_LOG, type LogState } from './log-buffer';

// Pure bounded-log reducer for the F3 (8b) live log stream. Frames arrive from the
// `execution.log` SSE subscription (payload { lines, seq, dropped? }); appendLog accumulates
// them into a capped ring, folding both backend flood drops and client-side cap eviction into
// one `dropped` total (the "…N lines dropped" marker), and drops duplicate/replayed seqs.

describe('appendLog', () => {
  it('appends lines and advances lastSeq from the empty state', () => {
    const s = appendLog(EMPTY_LOG, { lines: ['a', 'b'], seq: 1 }, 100);
    expect(s.lines).toEqual(['a', 'b']);
    expect(s.dropped).toBe(0);
    expect(s.lastSeq).toBe(1);
  });

  it('appends across frames in order', () => {
    let s: LogState = EMPTY_LOG;
    s = appendLog(s, { lines: ['a'], seq: 1 }, 100);
    s = appendLog(s, { lines: ['b', 'c'], seq: 2 }, 100);
    expect(s.lines).toEqual(['a', 'b', 'c']);
    expect(s.lastSeq).toBe(2);
  });

  it('evicts oldest lines past the cap and counts them as dropped', () => {
    let s: LogState = EMPTY_LOG;
    s = appendLog(s, { lines: ['a', 'b', 'c'], seq: 1 }, 3);
    s = appendLog(s, { lines: ['d', 'e'], seq: 2 }, 3);
    expect(s.lines).toEqual(['c', 'd', 'e']);
    expect(s.dropped).toBe(2); // a, b evicted
  });

  it('accumulates the backend-reported flood-drop count', () => {
    let s: LogState = EMPTY_LOG;
    s = appendLog(s, { lines: ['a'], seq: 1, dropped: 5 }, 100);
    expect(s.dropped).toBe(5);
    s = appendLog(s, { lines: ['b'], seq: 2, dropped: 3 }, 100);
    expect(s.dropped).toBe(8);
    expect(s.lines).toEqual(['a', 'b']);
  });

  it('folds backend drops and cap eviction into one total', () => {
    let s: LogState = EMPTY_LOG;
    s = appendLog(s, { lines: ['a', 'b', 'c'], seq: 1, dropped: 4 }, 2);
    // 3 lines into cap 2 → evict 1 (a); plus 4 backend drops = 5
    expect(s.lines).toEqual(['b', 'c']);
    expect(s.dropped).toBe(5);
  });

  it('ignores a duplicate/replayed frame (seq <= lastSeq)', () => {
    let s: LogState = EMPTY_LOG;
    s = appendLog(s, { lines: ['a', 'b'], seq: 2 }, 100);
    const dup = appendLog(s, { lines: ['a', 'b'], seq: 2 }, 100);
    expect(dup).toBe(s); // unchanged reference
    const older = appendLog(s, { lines: ['x'], seq: 1 }, 100);
    expect(older).toBe(s);
  });

  it('applies a pure drop-marker frame (empty lines, dropped set) and advances seq', () => {
    let s: LogState = EMPTY_LOG;
    s = appendLog(s, { lines: ['a'], seq: 1 }, 100);
    s = appendLog(s, { lines: [], seq: 2, dropped: 7 }, 100);
    expect(s.lines).toEqual(['a']);
    expect(s.dropped).toBe(7);
    expect(s.lastSeq).toBe(2);
  });

  it('does not mutate the input state', () => {
    const s0 = appendLog(EMPTY_LOG, { lines: ['a'], seq: 1 }, 100);
    const before = [...s0.lines];
    appendLog(s0, { lines: ['b'], seq: 2 }, 100);
    expect(s0.lines).toEqual(before);
  });
});
