import type { TaskInfo } from '@cortex-agent/ui-contract';

// Token-driven pills (DR-0018 §5 palette in tailwind.config.ts) — no hard-coded hex.

const BASE = 'inline-flex items-center rounded-card px-1g py-0.5g font-mono text-ui leading-none';

const PRIORITY_STYLES: Record<TaskInfo['priority'], string> = {
  high: 'bg-pill-failed-bg text-pill-failed-fg',
  medium: 'bg-pill-waiting-bg text-pill-waiting-fg',
  low: 'bg-pill-cancelled-bg text-pill-cancelled-fg',
};

const STATUS_STYLES: Record<TaskInfo['status'], string> = {
  open: 'bg-pill-running-bg text-pill-running-fg',
  done: 'bg-pill-done-bg text-pill-done-fg',
};

export function PriorityPill({ priority }: { priority: TaskInfo['priority'] }) {
  return <span className={`${BASE} ${PRIORITY_STYLES[priority]}`}>{priority}</span>;
}

export function StatusPill({ status }: { status: TaskInfo['status'] }) {
  return <span className={`${BASE} ${STATUS_STYLES[status]}`}>{status}</span>;
}
