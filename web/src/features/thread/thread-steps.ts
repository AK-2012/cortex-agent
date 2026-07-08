// Pure selectors + formatters for the inline thread card (design 11a) and the shared
// ThreadStepList primitive. Frame-work-free so they can be unit-tested in isolation (TDD).
// Source DTO: ThreadDetail from threads.get (design §6.3 B1).

import type {
  ThreadDetail,
  ThreadStepDetail,
  ThreadDispatchInfo,
  ThreadChildNode,
  ThreadAgentFlow,
} from '@cortex-agent/ui-contract';

/** The single running step, or null when the thread is terminal / has no active step. */
export function selectActiveStep(detail: ThreadDetail): ThreadStepDetail | null {
  return detail.steps.find((s) => s.status === 'running') ?? null;
}

/** Machine dispatches attributed to a step, joined by agent slot (the only per-step link in the DTO). */
export function dispatchesForStep(
  detail: ThreadDetail,
  step: ThreadStepDetail,
): ThreadDispatchInfo[] {
  return detail.dispatches.filter((d) => d.agentSlotId === step.agentSlotId);
}

export interface ActiveStepChildren {
  dispatches: ThreadDispatchInfo[];
  subthreads: ThreadChildNode[];
  agentFlow: ThreadAgentFlow | null;
}

/**
 * The expanded children of the active step (design 11a: only the active step expands).
 * Execute-type steps surface as `dispatches` (machine executions), Review-type steps as
 * `subthreads` — both are shown; the thread's data determines which is non-empty (no brittle
 * stage-name string matching). Null when there is no active step.
 */
export function activeStepChildren(detail: ThreadDetail): ActiveStepChildren | null {
  const step = selectActiveStep(detail);
  if (!step) return null;
  return {
    dispatches: dispatchesForStep(detail, step),
    subthreads: detail.children,
    agentFlow: detail.agentFlow,
  };
}

function formatDuration(durationS: number): string {
  const total = Math.round(durationS);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Non-null display chunks for a collapsed step line: [stage, cost, duration]. */
export function stepSummaryParts(step: ThreadStepDetail): string[] {
  const parts: string[] = [];
  if (step.stage) parts.push(step.stage);
  if (step.costUsd != null) parts.push(`$${step.costUsd.toFixed(2)}`);
  if (step.durationS != null) parts.push(formatDuration(step.durationS));
  return parts;
}
