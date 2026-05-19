// input:  Codex JSON-RPC event method/params
// output: codexEventToNormalized translator
// pos:    Translation layer from Codex events to NormalizedEvent
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { CodexEventParams } from '@domain/costs/codex-event-format.js';
import type { NormalizedEvent } from '../normalize/event-types.js';

/**
 * Translate a Codex JSON-RPC event (method + params) to a NormalizedEvent.
 * Returns null for events that have no NormalizedEvent counterpart in Phase 1
 * (internal/transient or richer than current NormalizedEvent surface).
 *
 * Coverage:
 *   item/completed (agentMessage)         → assistant_text { text }
 *   account/rateLimits/updated            → rate_limit { raw }
 *   thread/error                          → error { message, fatal:false }
 *   default / commandExecution / fileChange / token-usage / etc. → null
 *
 * session_started and turn_complete are synthesized by the adapter wrapper from
 * non-event sources (sessionId resolution + turn-result reduction), not by this parser.
 */
export function codexEventToNormalized(method: string, params: CodexEventParams): NormalizedEvent | null {
  if (params == null) return null;

  if (method === 'item/completed') {
    const item = params.item;
    if (!item || item.type !== 'agentMessage') return null;
    const text = String(item.text ?? '').trim();
    if (!text) return null;
    return { type: 'assistant_text', text };
  }

  if (method === 'account/rateLimits/updated') {
    return { type: 'rate_limit', raw: params };
  }

  if (method === 'thread/error') {
    const message = typeof params.message === 'string' && params.message.length > 0
      ? params.message
      : 'codex thread error';
    return { type: 'error', message, fatal: false };
  }

  return null;
}
