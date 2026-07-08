import type { ConfigBudget, BudgetValue } from '@cortex-agent/ui-contract';

// Pure derivations for the Budget panel (design 12c, prototype.dc.html L813–855, script L2411).
// This module governs the ONLY real write in the settings modal (config.set budget), so its
// value-builder is unit-tested against the backend zod contract (daily/monthly finite & positive).
// Framework-free; no JSX, no hex.

/** Daily-limit chips (prototype budgetChips L2411). */
export const DAILY_CHIPS = [5, 10, 20, 50];
/** Warn-threshold chips (prototype warnChips L2412) — display only; no budget.json field backs it. */
export const WARN_CHIPS = [60, 80, 90];

export function isDailyChipActive(budget: ConfigBudget | null, chip: number): boolean {
  return budget?.daily_usd === chip;
}

/**
 * Build the config.set budget payload for a new daily limit, PRESERVING the existing monthly_usd.
 * Returns null (write disabled) when the write cannot satisfy the backend contract without
 * fabricating data: config.set requires BOTH daily_usd and monthly_usd to be finite & positive.
 * We never invent a monthly value, so a null/non-positive monthly (or non-positive daily) blocks it.
 */
export function buildBudgetValue(budget: ConfigBudget | null, nextDaily: number): BudgetValue | null {
  const monthly = budget?.monthly_usd;
  if (!Number.isFinite(nextDaily) || nextDaily <= 0) return null;
  if (monthly == null || !Number.isFinite(monthly) || monthly <= 0) return null;
  return { daily_usd: nextDaily, monthly_usd: monthly };
}

/** `$10` (integer) / `$12.50` (fractional) / `—` for null. */
export function formatBudgetUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? '$' + n : '$' + n.toFixed(2);
}

/** today/daily as a clamped `NN%` string for the spend bar; `0%` when daily is unusable. */
export function budgetBarPct(today: number, daily: number | null | undefined): string {
  if (daily == null || !Number.isFinite(daily) || daily <= 0) return '0%';
  const pct = Math.max(0, Math.min(100, (today / daily) * 100));
  return Math.round(pct) + '%';
}
