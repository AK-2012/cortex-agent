import { describe, it, expect } from 'vitest';
import type { ThreadInfo, ThreadStepDetail } from '@cortex-agent/ui-contract';
import { en, zh } from '@/i18n';
import { budgetBand, threadMetaLineZh, threadSubLine, stepTimeLabel, fmtClock, pillLabel } from './mobile-thread-vm';

// Pure mobile-only glue for the 5b 线程 screen. The structural L2/L3/dot/level/depth/pill rules are
// reused from the desktop helpers (right-panel-vm / nested-threads / thread-steps) and covered by
// their own suites; these tests cover ONLY the mobile-specific formatting (zh meta line, honest
// budget band, collapsed sub-line, step clock).

const baseInfo: ThreadInfo = {
  id: 'thr_8f2c',
  templateName: 'experiment-pipeline',
  currentStep: { index: 2, name: '评审' },
  status: 'running',
  projectId: 'p',
  createdAt: new Date(Date.now() - 42 * 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  totalSteps: 4,
  artifactPath: null,
};

function step(partial: Partial<ThreadStepDetail>): ThreadStepDetail {
  return {
    stepIndex: 0,
    agentSlotId: 'a',
    stage: null,
    status: 'completed',
    executionId: null,
    sessionId: null,
    sessionName: null,
    costUsd: null,
    numTurns: null,
    durationS: null,
    startedAt: null,
    endedAt: null,
    outputSummary: null,
    ...partial,
  };
}

describe('budgetBand — honest denominator (GAP-B: CostSummary has no budget limit)', () => {
  it('real today numerator, "—" denominator, 0% fill', () => {
    expect(budgetBand(4.21)).toEqual({ numerator: '$4.21', denominator: '—', pct: 0 });
  });
  it('undefined today → "—" numerator (no fabrication)', () => {
    expect(budgetBand(undefined)).toEqual({ numerator: '—', denominator: '—', pct: 0 });
  });
  it('zero today is real, not missing', () => {
    expect(budgetBand(0)).toEqual({ numerator: '$0.00', denominator: '—', pct: 0 });
  });
});

describe('threadMetaLineZh — "thr · 步骤 3/4 · 42m"', () => {
  it('id · <stepWord> idx+1/total · age', () => {
    expect(threadMetaLineZh(baseInfo, Date.now(), '步骤')).toBe('thr_8f2c · 步骤 3/4 · 42m');
  });
  it('omits the step segment when currentStep is null', () => {
    const info = { ...baseInfo, currentStep: null };
    expect(threadMetaLineZh(info, Date.now(), '步骤')).toBe('thr_8f2c · 42m');
  });
});

describe('threadSubLine — collapsed Card B "thr · 1/4 stage"', () => {
  it('id · frac stage', () => {
    const info = { ...baseInfo, id: 'thr_9c07', currentStep: { index: 0, name: '计划' }, totalSteps: 4 };
    expect(threadSubLine(info)).toBe('thr_9c07 · 1/4 计划');
  });
  it('frac only when stage name is empty', () => {
    const info = { ...baseInfo, id: 'thr_a41d', currentStep: { index: 0, name: '' }, totalSteps: 3 };
    expect(threadSubLine(info)).toBe('thr_a41d · 1/3');
  });
  it('id only when no current step', () => {
    const info = { ...baseInfo, id: 'thr_x', currentStep: null };
    expect(threadSubLine(info)).toBe('thr_x');
  });
});

describe('stepTimeLabel', () => {
  it('running → MM:SS elapsed since startedAt', () => {
    const now = Date.now();
    const s = step({ status: 'running', startedAt: new Date(now - (4 * 60 + 12) * 1000).toISOString() });
    expect(stepTimeLabel(s, now)).toBe('04:12');
  });
  it('completed → compact duration', () => {
    expect(stepTimeLabel(step({ status: 'completed', durationS: 180 }), Date.now())).toBe('3m');
  });
  it('pending → empty', () => {
    expect(stepTimeLabel(step({ status: 'pending' }), Date.now())).toBe('');
  });
  it('running with no startedAt → empty (no fabrication)', () => {
    expect(stepTimeLabel(step({ status: 'running', startedAt: null }), Date.now())).toBe('');
  });
});

describe('pillLabel — zh status pill text (colors come from desktop threadPill)', () => {
  it('maps thread status to the zh vocab label', () => {
    expect(pillLabel('running', zh)).toBe('运行中');
    expect(pillLabel('waiting', zh)).toBe('等待中');
    expect(pillLabel('completed', zh)).toBe('完成');
    expect(pillLabel('failed', zh)).toBe('失败');
    expect(pillLabel('cancelled', zh)).toBe('已取消');
    expect(pillLabel('aborted', zh)).toBe('已取消');
  });
  it('respects the active vocab (en on desktop)', () => {
    expect(pillLabel('running', en)).toBe('Running');
  });
});

describe('fmtClock — MM:SS', () => {
  it('pads minutes and seconds', () => {
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(9)).toBe('00:09');
    expect(fmtClock(252)).toBe('04:12');
    expect(fmtClock(3661)).toBe('61:01');
  });
});
