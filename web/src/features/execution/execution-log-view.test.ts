import { describe, expect, it } from 'vitest';
import type { ExecutionDetailInfo } from '@cortex-agent/ui-contract';
import {
  execClock,
  execMeta,
  execNow,
  execPill,
  isStoppable,
  logStreamEnabled,
} from './execution-log-view';

function detail(over: Partial<ExecutionDetailInfo> = {}): ExecutionDetailInfo {
  return {
    id: 'exec_3097',
    type: 'dispatch',
    kind: 'cortex-run',
    status: 'running',
    projectId: 'cortex-self',
    sessionId: null,
    threadId: 'thr_x',
    runtime: {
      startedAt: '2026-07-06T01:58:03Z',
      updatedAt: '2026-07-06T07:49:12Z',
      endedAt: null,
    },
    dispatch: {
      taskId: 'T-041',
      machine: 'gpu-01',
      pid: '4242',
      tmuxName: 'run-3097',
      sessionName: 'sess',
      scheduleTaskId: null,
      runName: 'overnight-dr',
    },
    metrics: { costUsd: 1.24, numTurns: 12, durationS: 83 },
    gpu: null,
    text: { label: 'overnight DR sweep', finalOutput: null, error: null },
    ...over,
  };
}

describe('execPill', () => {
  it('maps each status to the prototype pill glyph+label', () => {
    expect(execPill('running')).toBe('● running');
    expect(execPill('completed')).toBe('✓ done');
    expect(execPill('failed')).toBe('✕ failed');
    expect(execPill('cancelled')).toBe('✕ cancelled');
    expect(execPill('stale')).toBe('◦ stale');
  });
  it('falls back to the raw status for an unknown value', () => {
    expect(execPill('weird')).toBe('weird');
  });
});

describe('execClock', () => {
  it('formats an ISO timestamp as UTC HH:MM', () => {
    expect(execClock('2026-07-06T07:49:12Z')).toBe('07:49');
    expect(execClock('2026-07-06T01:05:03Z')).toBe('01:05');
  });
  it('returns empty string for null', () => {
    expect(execClock(null)).toBe('');
  });
});

describe('execMeta', () => {
  it('joins machine · taskId · finished-time (endedAt present)', () => {
    const d = detail({
      status: 'completed',
      runtime: { startedAt: '2026-07-06T01:58:03Z', updatedAt: '2026-07-06T07:49:12Z', endedAt: '2026-07-06T07:49:10Z' },
    });
    expect(execMeta(d)).toBe('gpu-01 · T-041 · finished 07:49');
  });
  it('shows running when there is no endedAt', () => {
    expect(execMeta(detail())).toBe('gpu-01 · T-041 · running');
  });
  it('omits null machine / taskId segments (no dispatch)', () => {
    const d = detail({ dispatch: null });
    expect(execMeta(d)).toBe('running');
  });
  it('omits only the null segment', () => {
    const d = detail();
    d.dispatch = { ...d.dispatch!, machine: null };
    expect(execMeta(d)).toBe('T-041 · running');
  });
});

describe('execNow', () => {
  it('is the UTC HH:MM:SS of endedAt when finished', () => {
    const d = detail({
      runtime: { startedAt: '2026-07-06T01:58:03Z', updatedAt: '2026-07-06T07:49:12Z', endedAt: '2026-07-06T07:49:10Z' },
    });
    expect(execNow(d)).toBe('07:49:10');
  });
  it('is the UTC HH:MM:SS of updatedAt while running', () => {
    expect(execNow(detail())).toBe('07:49:12');
  });
});

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
