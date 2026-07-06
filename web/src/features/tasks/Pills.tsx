import type { TaskInfo } from '@cortex-agent/ui-contract';
import { StatusPill as DesignStatusPill, type Tone } from '@/design';

// Task-specific pills built on the design-system StatusPill primitive (DR-0018 §5).
// Appearance preserved from the Stage-1 slice: priority high/med/low → failed/waiting/
// cancelled tone; status open/done → running/done tone.

const PRIORITY_TONE: Record<TaskInfo['priority'], Tone> = {
  high: 'failed',
  medium: 'waiting',
  low: 'cancelled',
};

export function PriorityPill({ priority }: { priority: TaskInfo['priority'] }) {
  return <DesignStatusPill tone={PRIORITY_TONE[priority]} label={priority} />;
}

export function StatusPill({ status }: { status: TaskInfo['status'] }) {
  return <DesignStatusPill status={status} />;
}
