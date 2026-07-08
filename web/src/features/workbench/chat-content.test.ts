import { describe, it, expect } from 'vitest';
import {
  fmtClock,
  moneyLabel,
  toolCallsLabel,
  MORNING,
} from './chat-content';

describe('fmtClock', () => {
  it('formats the prototype default runBase (42*60+13) as 42:13', () => {
    expect(fmtClock(42 * 60 + 13)).toBe('42:13');
  });
  it('zero-pads minutes and seconds', () => {
    expect(fmtClock(5)).toBe('00:05');
    expect(fmtClock(65)).toBe('01:05');
    expect(fmtClock(600)).toBe('10:00');
  });
});

describe('moneyLabel', () => {
  it('renders a 2-decimal dollar amount', () => {
    expect(moneyLabel(0.31)).toBe('$0.31');
    expect(moneyLabel(2.5)).toBe('$2.50');
  });
});

describe('toolCallsLabel', () => {
  it('pluralises tool call(s)', () => {
    expect(toolCallsLabel(1)).toBe('1 tool call');
    expect(toolCallsLabel(4)).toBe('4 tool calls');
  });
});

describe('MORNING representative content (verbatim from prototype)', () => {
  it('carries the exact header + run defaults', () => {
    expect(MORNING.title).toBe('morning review');
    expect(MORNING.profile).toBe('research');
    expect(MORNING.runBaseSeconds).toBe(42 * 60 + 13);
    expect(MORNING.turns).toBe(12);
    expect(MORNING.sessionCost).toBe(0.31);
  });
  it('carries the divider + user message verbatim', () => {
    expect(MORNING.divider).toBe('TODAY 07:42');
    expect(MORNING.userMessage).toBe(
      'How did the domain-randomization sweep go overnight?',
    );
  });
  it('carries the 4 morning tool calls with labels/kinds/inputs', () => {
    expect(MORNING.toolCalls).toHaveLength(4);
    expect(MORNING.toolCalls.map((c) => c.label)).toEqual([
      'read domain-rand-sweep.md',
      'threads.status',
      'read eval-logs/',
      'recompute table',
    ]);
    expect(MORNING.toolCalls[3]).toEqual({
      label: 'recompute table',
      kind: 'bash',
      input: 'python tools/recompute_success.py --all-seeds',
    });
  });
  it('carries the assistant text + result chips verbatim', () => {
    expect(MORNING.assistant1).toContain('7 of 8 seeds converged');
    expect(MORNING.assistant1Chips).toEqual([
      { text: 'success 82% ↑9', bg: '#E9F4EE', color: '#23854F' },
      { text: 'seeds 7/8', bg: '#F1F2F5', color: '#5B6472' },
    ]);
    expect(MORNING.assistant2).toBe(
      'The review step spawned a verify-metrics sub-thread to re-derive the success table:',
    );
  });
  it('carries the APR-0007 approval representative content', () => {
    expect(MORNING.approval.id).toBe('APR-0007');
    expect(MORNING.approval.tagText).toBe('Approval required');
    expect(MORNING.approval.title).toBe(
      'Over-budget dispatch — 8×A100 ablation sweep',
    );
    expect(MORNING.approval.desc).toBe(
      'Estimated $12.40 vs $10.00 daily budget · requested by thr_8f2c',
    );
  });
});
