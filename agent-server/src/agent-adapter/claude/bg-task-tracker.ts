// input:  parsed Claude stream-json events (system/result)
// output: BgTaskTracker (pending background-task count) + isContinuationResult
// pos:    CC backend background-task continuation tracking (pure, no I/O)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

/**
 * Tracks in-flight background tasks (run_in_background Bash/Agent) for a single
 * persistent Claude session, by observing the CLI's stream-json `system` events.
 *
 * Observed lifecycle (real shapes, see /tmp/bg-capture.mjs):
 *   - launch:     { type:'system', subtype:'task_started',      task_id, task_type }
 *   - completion: { type:'system', subtype:'task_updated',      task_id, patch:{status:'completed'} }
 *                 { type:'system', subtype:'task_notification', task_id, status:'completed', summary }
 *
 * IMPORTANT: task_updated{completed} and task_notification are TWO separate events, and the
 * CLI emits task_updated FIRST — sometimes seconds before the matching task_notification
 * (gaps up to ~24s observed when several run_in_background tasks finish close together).
 * task_notification is the one that actually re-invokes the model (the continuation turn).
 * So pending is keyed off task_notification ONLY; clearing on task_updated would let the
 * count hit 0 while continuation turns are still undelivered, sealing a turn "done"
 * prematurely (a continuation result resolving in that gap snapshots pendingCount==0).
 *
 * When a background task completes the CLI spontaneously re-invokes the model and
 * emits a fresh turn whose terminating `result` carries `origin.kind:'task-notification'`
 * (see isContinuationResult). The adapter uses pendingCount to decide whether a turn's
 * result should be sealed ("done") or held in a "waiting" state, and continuationArmed
 * to recognize the spontaneous continuation turn that follows.
 */
export class BgTaskTracker {
  private readonly pending = new Set<string>();
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
        this.pending.add(id);
        break;
      case 'task_updated':
        // Intentionally a no-op for pending/arming, even on status 'completed'.
        // task_updated marks the task's WORK as finished, but the CLI emits the
        // matching task_notification LATER (observed gaps up to ~24s with several
        // parallel tasks). task_notification is the event that actually re-invokes
        // the model (the continuation turn). If we cleared pending here, the count
        // could reach 0 while notifications are still undelivered, and a continuation
        // turn resolving in that gap would seal the turn "done" prematurely. Pending
        // is therefore keyed off task_notification only (see below).
        break;
      case 'task_notification':
        // Emitted when a background task finishes (status 'completed' or error);
        // this is the event that re-invokes the model. It is the authoritative
        // completion-delivery signal, so it (and only it) clears pending + arms.
        this.pending.delete(id);
        this.continuationArmed = true;
        break;
      default:
        break;
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
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
