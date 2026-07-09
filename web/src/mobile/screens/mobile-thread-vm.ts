// Pure mobile-only glue for the 5b 线程 screen (design scheme.dc.html L3005–3108).
// The load-bearing L2-expand / L3-drill / step-dot / level / depth / pill RULES are reused verbatim
// from the desktop helpers (features/workbench/right-panel-vm + features/thread/{nested-threads,
// thread-steps}) — this module only formats the mobile-specific chrome (zh meta line, honest budget
// band, collapsed sub-line, step clock). Framework-free so it is unit-tested in isolation (TDD).

import type { ThreadInfo, ThreadStepDetail } from '@cortex-agent/ui-contract';
import type { Vocab } from '@/i18n';
import { formatCost, formatDurationS, formatAge } from '@/features/workbench/right-panel-vm';

/**
 * Status-pill LABEL in the mobile (zh) vocabulary. Colors still come from the reused desktop
 * `threadPill` (same rule); only the text is localized (done_when: ZH 文案走 i18n) — the desktop
 * helper hardcodes English labels, which must not leak into the zh mobile surface.
 */
export function pillLabel(status: ThreadInfo['status'], vocab: Vocab): string {
  switch (status) {
    case 'running':
      return vocab.pillRunning;
    case 'waiting':
      return vocab.pillWaiting;
    case 'completed':
      return vocab.pillDone;
    case 'failed':
      return vocab.pillFailed;
    default:
      return vocab.pillCancelled;
  }
}

export interface BudgetBand {
  numerator: string;
  denominator: string;
  pct: number;
}

/**
 * Today's spend band. `cost.summary` carries `today` but NO budget limit (verified cost-tracker.ts) →
 * denominator is an honest "—" and the fill is 0% (GAP-B; no fabricated $10.00). `today` is real.
 */
export function budgetBand(today: number | undefined): BudgetBand {
  return {
    numerator: typeof today === 'number' ? formatCost(today) : '—',
    denominator: '—',
    pct: 0,
  };
}

/** Expanded-card meta line "thr_8f2c · 步骤 3/4 · 42m" — zh analog of right-panel `threadMetaLine`. */
export function threadMetaLineZh(info: ThreadInfo, now: number, stepWord: string): string {
  const parts: string[] = [info.id];
  if (info.currentStep) parts.push(`${stepWord} ${info.currentStep.index + 1}/${info.totalSteps}`);
  parts.push(formatAge(info.createdAt, now));
  return parts.join(' · ');
}

/** Collapsed Card-B sub-line "thr_9c07 · 1/4 计划" (id · frac stage). gpu/status-note omitted (no field). */
export function threadSubLine(info: ThreadInfo): string {
  const parts: string[] = [info.id];
  if (info.currentStep) {
    const frac = `${info.currentStep.index + 1}/${info.totalSteps}`;
    parts.push(info.currentStep.name ? `${frac} ${info.currentStep.name}` : frac);
  }
  return parts.join(' · ');
}

/** Elapsed seconds → "MM:SS" (minutes uncapped). */
export function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Step time cell: running → live MM:SS elapsed since startedAt; completed → compact duration; else "". */
export function stepTimeLabel(step: ThreadStepDetail, now: number): string {
  if (step.status === 'running') {
    return step.startedAt ? fmtClock((now - Date.parse(step.startedAt)) / 1000) : '';
  }
  if (step.durationS != null) return formatDurationS(step.durationS);
  return '';
}
