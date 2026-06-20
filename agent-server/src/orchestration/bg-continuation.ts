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
  /** Called when the continuation result still has background tasks pending (chained
   *  tasks): keep the status in a waiting state with the remaining count. */
  onWaiting: (pendingCount: number) => void;
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
    onResult: (result: AgentResult) => {
      const pending = result.pendingBackgroundTasks ?? 0;
      if (pending > 0) deps.onWaiting(pending);
      else deps.onComplete(result);
    },
  };
}

/** Feature gate: background-task continuation is opt-in via CORTEX_BG_CONTINUATION. */
export function isBgContinuationEnabled(): boolean {
  const v = process.env.CORTEX_BG_CONTINUATION;
  return v === '1' || v === 'true';
}

/** Scope gate: only interactive user conduits (Slack / Feishu), never thread/dispatch. */
export function isInteractiveChannel(channel: string): boolean {
  return !!channel && (channel.startsWith('slack:') || channel.startsWith('feishu:'));
}
