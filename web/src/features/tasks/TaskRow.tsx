import type { TaskInfo } from '@cortex-agent/ui-contract';
import { PriorityPill, StatusPill } from './Pills';

export interface TaskRowProps {
  task: TaskInfo;
  pending: boolean;
  onClaim: (task: TaskInfo) => void;
  onComplete: (task: TaskInfo) => void;
}

const ACTION_BTN =
  'rounded-card border border-card px-1g py-0.5g text-ui text-state-ink/80 ' +
  'hover:bg-surface-canvas-alt disabled:opacity-40 disabled:cursor-not-allowed';

// One task line: id (mono) · text · priority/status pills · claim/block state · one action.
// Claim (actionable) or Complete (open, routed through the daemon) — the mutation that
// proves live update. Done tasks carry no action.
export function TaskRow({ task, pending, onClaim, onComplete }: TaskRowProps) {
  return (
    <div
      data-task-id={task.id}
      data-status={task.status}
      className="flex items-center gap-1.5g rounded-card border border-card bg-surface-card px-1.5g py-1g shadow-card"
    >
      <span className="shrink-0 font-mono text-ui text-state-ink/50">{task.id}</span>
      <span className="min-w-0 flex-1 truncate text-ui text-state-ink" title={task.text}>
        {task.text}
      </span>
      {task.claimedBy && (
        <span className="shrink-0 font-mono text-ui text-state-ink/50">@{task.claimedBy}</span>
      )}
      {task.blockedBy && (
        <span className="shrink-0 font-mono text-ui text-pill-failed-fg">blocked</span>
      )}
      <PriorityPill priority={task.priority} />
      <StatusPill status={task.status} />
      {task.status === 'open' && (
        <div className="flex shrink-0 gap-1g">
          {task.actionable && (
            <button className={ACTION_BTN} disabled={pending} onClick={() => onClaim(task)}>
              Claim
            </button>
          )}
          <button className={ACTION_BTN} disabled={pending} onClick={() => onComplete(task)}>
            Complete
          </button>
        </div>
      )}
    </div>
  );
}
