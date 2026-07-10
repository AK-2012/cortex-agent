// input:  parsed Claude stream-json events (system/result)
// output: BgTaskTracker (running/undelivered background-task counts) + isContinuationResult
// pos:    CC backend background-task continuation tracking (pure, no I/O)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

/**
 * Tracks in-flight background tasks (run_in_background Bash/Agent) for a single
 * persistent Claude session, by observing the CLI's stream-json `system` events.
 *
 * Observed lifecycle (real shapes, see /tmp/bg-capture.mjs):
 *   - launch:     { type:'system', subtype:'task_started',      task_id, task_type }
 *   - work done:  { type:'system', subtype:'task_updated',      task_id, patch:{status:'completed'|'failed'|'killed'} }
 *   - delivery:   { type:'system', subtype:'task_notification', task_id, status:'completed', summary }
 *
 * task_notification is the event that actually re-invokes the model (the spontaneous
 * continuation turn). BUT — 2026-07-10 investigation — the CLI does NOT always emit it:
 *   - CC versions ≤ 2026-07-05: a task completing while its owning turn was still active got
 *     task_updated{completed} and NEVER a notification (11 verified cases; sessions lived
 *     20+ min after, incl. further turns, with zero notifications). Fixed in CC ≥ 07-06,
 *     but the contract cannot be trusted across CLI auto-updates.
 *   - TaskStop-killed tasks (patch.status 'killed') never get a notification at all.
 *
 * The tracker therefore keeps TWO sets:
 *   - `running`     — started, work not yet finished. Snapshot as pendingBackgroundTasks.
 *   - `undelivered` — work finished (task_updated terminal status) but the notification has
 *     not been observed. The CLI may deliver it up to ~24s later (observed gap with several
 *     parallel tasks) — or never. Snapshot as undeliveredBackgroundTasks; orchestration arms
 *     a grace watchdog (bg-wait-guard) for these instead of waiting forever.
 * Killed tasks are dropped from both sets immediately (no notification will ever come).
 */
export class BgTaskTracker {
  private readonly running = new Set<string>();
  private readonly undelivered = new Set<string>();
  /** Set when a background task completes; the spontaneous continuation turn that
   *  follows is recognized via this flag. Cleared by disarmContinuation(). */
  continuationArmed = false;

  /** Observe one parsed stream-json event. Idempotent per task_id. */
  observe(data: any): void {
    if (!data || data.type !== 'system') return;
    const id = typeof data.task_id === 'string' ? data.task_id : null;
    if (!id) return;
    switch (data.subtype) {
      case 'task_started':
        this.running.add(id);
        break;
      case 'task_updated': {
        const status = data.patch?.status;
        if (status === 'killed') {
          // TaskStop kill: no notification will ever come — drop entirely.
          this.running.delete(id);
          this.undelivered.delete(id);
        } else if (status === 'completed' || status === 'failed') {
          // Work finished; the matching task_notification may follow (observed gaps up to
          // ~24s) or may never come (old-CLI same-turn completions). Keep the task visible
          // as "undelivered" so a result snapshotting in the gap does not seal early, while
          // no longer counting it as running.
          this.running.delete(id);
          this.undelivered.add(id);
        }
        // Non-terminal patches (status 'running', output updates) are no-ops.
        break;
      }
      case 'task_notification':
        // The authoritative completion-delivery signal: the model is being re-invoked.
        this.running.delete(id);
        this.undelivered.delete(id);
        this.continuationArmed = true;
        break;
      default:
        break;
    }
  }

  /** Tasks whose work is still executing. */
  get pendingCount(): number {
    return this.running.size;
  }

  /** Tasks whose work finished but whose task_notification has not been observed. */
  get undeliveredCount(): number {
    return this.undelivered.size;
  }

  /** True while anything may still produce a continuation — the session must stay alive. */
  hasPending(): boolean {
    return this.running.size > 0 || this.undelivered.size > 0;
  }

  disarmContinuation(): void {
    this.continuationArmed = false;
  }
}

/** A `result` event produced by a background-task continuation turn carries
 *  origin.kind === 'task-notification'. Used to distinguish a spontaneous
 *  continuation result from a normal turn result. */
export function isContinuationResult(data: any): boolean {
  return data?.type === 'result' && data?.origin?.kind === 'task-notification';
}

/** How a parsed stream-json line should be routed by the session's handleLine. */
export type LineRoute =
  | 'normal' // a turn is active — process via the existing currentTurn path
  | 'open-continuation' // no active turn, but a background completion re-invoked the model
  | 'ignore'; // no active turn and not a continuation — drop (pre-existing behavior)

/**
 * Decide how a parsed line should be routed given whether a turn is currently active.
 * Pure: depends only on the tracker's armed state and the event type.
 */
export function routeLine(tracker: BgTaskTracker, data: any, hasActiveTurn: boolean): LineRoute {
  if (hasActiveTurn) return 'normal';
  if (data?.type === 'assistant' && tracker.continuationArmed) return 'open-continuation';
  return 'ignore';
}
