import { describe, expect, it } from 'vitest';
import type { ExecutionDetailInfo } from '@cortex-agent/ui-contract';
import {
  formatCost,
  formatDuration,
  formatGpu,
  formatNum,
  isStoppable,
  logStreamEnabled,
} from './execution-detail';

function detail(over: Partial<ExecutionDetailInfo> = {}): ExecutionDetailInfo {
  return {
    id: 'exec1',
    type: 'dispatch',
    kind: 'cortex-run',
    status: 'running',
    projectId: 'cortex-self',
    sessionId: null,
    threadId: 'thr_x',
    runtime: { startedAt: '2026-07-06T00:00:00Z', updatedAt: '2026-07-06T00:01:00Z', endedAt: null },
    dispatch: {
      taskId: '2198',
      machine: 'lab2',
      pid: '4242',
      tmuxName: 'run-2198',
      sessionName: 'sess',
      scheduleTaskId: null,
      runName: 'my-run',
    },
    metrics: { costUsd: 1.5, numTurns: 12, durationS: 83 },
    gpu: null,
    text: { label: 'my-run', finalOutput: null, error: null },
    ...over,
  };
}

describe('isStoppable', () => {
  it('only a running execution is stoppable', () => {
    expect(isStoppable('running')).toBe(true);
    for (const s of ['completed', 'failed', 'cancelled', 'stale']) {
      expect(isStoppable(s)).toBe(false);
    }
  });
});

describe('logStreamEnabled', () => {
  it('true only when dispatch.runName is present (a cortex-run)', () => {
    expect(logStreamEnabled(detail())).toBe(true);
    expect(logStreamEnabled(detail({ dispatch: null }))).toBe(false);
    const d = detail();
    expect(logStreamEnabled(detail({ dispatch: { ...d.dispatch!, runName: null } }))).toBe(false);
  });
});

describe('formatGpu', () => {
  it('renders an em dash when unknown (always null today)', () => {
    expect(formatGpu(null)).toBe('—');
    expect(formatGpu({ indices: [], memoryMb: null })).toBe('—');
  });
  it('renders indices and memory when present', () => {
    expect(formatGpu({ indices: [0, 1], memoryMb: 24576 })).toBe('GPU 0,1 · 24576 MB');
    expect(formatGpu({ indices: [2], memoryMb: null })).toBe('GPU 2');
  });
});

describe('formatCost / formatNum', () => {
  it('formats cost with a dollar sign and 2 decimals, dash for null', () => {
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(null)).toBe('—');
  });
  it('formats numbers, dash for null', () => {
    expect(formatNum(12)).toBe('12');
    expect(formatNum(null)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats seconds/minutes/hours, dash for null', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(83)).toBe('1m 23s');
    expect(formatDuration(3723)).toBe('1h 2m');
  });
  it('rounds fractional seconds', () => {
    expect(formatDuration(44.6)).toBe('45s');
  });
});
