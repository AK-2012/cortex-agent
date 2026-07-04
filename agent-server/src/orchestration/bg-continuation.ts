// input:  ContinuationSink contract (agent-adapter) + OutputStream + AgentResult
// output: buildContinuationSink + scope/feature gating helpers
// pos:    CC background-task continuation orchestration (merge into reply + waiting status)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { OutputStream } from '@platform/index.js';
import type { AgentResult } from '@core/types/agent-types.js';
import type { ContinuationSink } from '../agent-adapter/types.js';

export interface ContinuationSinkDeps {
  /** The originating turn's OutputStream — continuation text is appended here so the
   *  follow-up merges into the same reply (looks like one turn). */
  stream: OutputStream;
  /** Optional callback for tool_use events from the continuation turn. When set,
   *  forwarded to the ContinuationSink so the adapter can route continuation tool
   *  calls to the originating turn's ToolTrace (Slack tool traces + history). */
  onToolUse?: ((name: string, input: any) => void) | null;
  /** Called when the continuation result still has background tasks pending (chained
   *  tasks): keep the status in a waiting state with the remaining count. */
  onWaiting: (pendingCount: number) => void;
  /** Called when the continuation turn is rate-limited: seal the status as rate-limited
   *  and record for auto-resume, instead of leaving it in waiting or sealing as done. */
  onRateLimited: (result: AgentResult) => void;
  /** Called when no background tasks remain: seal the status as complete, record the
   *  continuation's cost, and clear the streaming callback + sink. */
  onComplete: (result: AgentResult) => void;
}

/**
 * Build the session-level continuation sink. Pure dispatch: assistant text is merged
 * into the originating reply via the shared OutputStream; the terminating result either
 * holds the waiting status (tasks still pending) or completes the turn (none remain).
 * Heavy side effects (seal / cost / clear) are injected via onWaiting / onComplete.
 */
export function buildContinuationSink(deps: ContinuationSinkDeps): ContinuationSink {
  return {
    onAssistantText: (text: string) => deps.stream.emitText(text),
    onToolUse: deps.onToolUse || undefined,
    onResult: (result: AgentResult) => {
      if (result.rateLimited) { deps.onRateLimited(result); return; }
      const pending = result.pendingBackgroundTasks ?? 0;
      if (pending > 0) deps.onWaiting(pending);
      else deps.onComplete(result);
    },
  };
}

/** Feature gate: background-task continuation is ON by default. Opt out by setting
 *  CORTEX_BG_CONTINUATION to a falsy value (0 / false / off / no). */
export function isBgContinuationEnabled(): boolean {
  const v = process.env.CORTEX_BG_CONTINUATION;
  if (v === undefined) return true;
  return !['0', 'false', 'off', 'no'].includes(v.trim().toLowerCase());
}

/** Scope gate: only interactive user conduits (Slack / Feishu), never thread/dispatch. */
export function isInteractiveChannel(channel: string): boolean {
  return !!channel && (channel.startsWith('slack:') || channel.startsWith('feishu:'));
}
