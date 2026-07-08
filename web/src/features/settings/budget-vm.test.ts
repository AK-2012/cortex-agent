import { describe, it, expect } from 'vitest';
import type { ConfigBudget } from '@cortex-agent/ui-contract';
import {
  DAILY_CHIPS,
  WARN_CHIPS,
  isDailyChipActive,
  buildBudgetValue,
  formatBudgetUsd,
  budgetBarPct,
} from './budget-vm';

const budget = (daily: number | null, monthly: number | null): ConfigBudget => ({
  daily_usd: daily,
  monthly_usd: monthly,
});

describe('budget-vm', () => {
  it('exposes the prototype daily + warn chip sets', () => {
    expect(DAILY_CHIPS).toEqual([5, 10, 20, 50]);
    expect(WARN_CHIPS).toEqual([60, 80, 90]);
  });

  it('isDailyChipActive matches the current daily budget', () => {
    expect(isDailyChipActive(budget(10, 300), 10)).toBe(true);
    expect(isDailyChipActive(budget(10, 300), 20)).toBe(false);
    expect(isDailyChipActive(null, 10)).toBe(false);
    expect(isDailyChipActive(budget(null, 300), 10)).toBe(false);
  });

  it('buildBudgetValue preserves the existing monthly_usd and sets the new daily', () => {
    expect(buildBudgetValue(budget(10, 300), 20)).toEqual({ daily_usd: 20, monthly_usd: 300 });
  });

  it('buildBudgetValue returns null when monthly_usd is unwritable (config.set requires positive)', () => {
    // zod requires monthly_usd finite & positive; we never fabricate one.
    expect(buildBudgetValue(budget(10, null), 20)).toBeNull();
    expect(buildBudgetValue(budget(10, 0), 20)).toBeNull();
    expect(buildBudgetValue(null, 20)).toBeNull();
  });

  it('buildBudgetValue rejects a non-positive next daily', () => {
    expect(buildBudgetValue(budget(10, 300), 0)).toBeNull();
    expect(buildBudgetValue(budget(10, 300), -5)).toBeNull();
  });

  it('formatBudgetUsd renders $N or a dash for null', () => {
    expect(formatBudgetUsd(10)).toBe('$10');
    expect(formatBudgetUsd(12.5)).toBe('$12.50');
    expect(formatBudgetUsd(null)).toBe('—');
  });

  it('budgetBarPct is today/daily clamped to 0..100', () => {
    expect(budgetBarPct(4.21, 10)).toBe('42%');
    expect(budgetBarPct(15, 10)).toBe('100%');
    expect(budgetBarPct(0, 10)).toBe('0%');
    expect(budgetBarPct(5, null)).toBe('0%');
    expect(budgetBarPct(5, 0)).toBe('0%');
  });
});
