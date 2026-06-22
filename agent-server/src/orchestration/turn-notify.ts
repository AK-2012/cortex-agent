// input:  orch/bg-continuation(isInteractiveChannel), store/outbound-queue(durablePost,getOutboundQueue), core/status-format(buildSessionTag), core/icons, core/i18n
// output: isTurnNotifyEnabled / getTurnNotifyThresholdS / maybeNotifyTurnComplete
// pos:    orch layer — push a NEW message (Slack + Feishu) when a long-running user turn finishes
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import { createLogger } from '@core/log.js';
import { Icons } from '../core/icons.js';
import { t } from '../core/i18n.js';
import { buildSessionTag } from '../core/status-format.js';
import type { Destination, PlatformAdapter } from '@platform/index.js';
import { getOutboundQueue, durablePost } from '@store/outbound-queue.js';
import { isInteractiveChannel } from './bg-continuation.js';

const log = createLogger('turn-notify');

const DEFAULT_THRESHOLD_S = 60;

/** Feature gate: turn-completion notification is ON by default. Opt out by setting
 *  CORTEX_TURN_NOTIFY to a falsy value (0 / false / off / no). */
export function isTurnNotifyEnabled(): boolean {
  const v = process.env.CORTEX_TURN_NOTIFY;
  if (v === undefined) return true;
  return !['0', 'false', 'off', 'no'].includes(v.trim().toLowerCase());
}

/** Minimum turn duration (seconds) before a completion notification is pushed.
 *  Configurable via CORTEX_TURN_NOTIFY_THRESHOLD_S; defaults to 60s. A non-positive
 *  or unparseable value falls back to the default. */
export function getTurnNotifyThresholdS(): number {
  const raw = process.env.CORTEX_TURN_NOTIFY_THRESHOLD_S;
  if (raw === undefined) return DEFAULT_THRESHOLD_S;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_THRESHOLD_S;
  return n;
}

/** Push a NEW message to the conversation's channel when a long-running, user-initiated
 *  turn finishes — so the user gets an actual push notification (editing the status
 *  message to "✓ Done" does not notify on Slack or Feishu). Works for both Slack and
 *  Feishu through the PlatformAdapter abstraction (Composite fans out to both).
 *
 *  Gated by: feature flag, interactive-channel scope, and a duration threshold.
 *  Never throws — a failed notification must not affect the main turn. */
export async function maybeNotifyTurnComplete(params: {
  adapter: PlatformAdapter;
  channel: string;
  threadAnchorId: string | null;
  sessionName: string | null;
  sessionId: string | null;
  elapsedS: number;
  elapsedStr: string;
  status: 'completed' | 'failed';
  metricsSuffix?: string;
}): Promise<void> {
  const { adapter, channel, threadAnchorId, sessionName, sessionId, elapsedS, elapsedStr, status, metricsSuffix } = params;
  try {
    if (!isTurnNotifyEnabled()) return;
    if (!isInteractiveChannel(channel)) return;
    if (elapsedS < getTurnNotifyThresholdS()) return;

    const sessionTag = buildSessionTag(sessionName, sessionId);
    const text = status === 'completed'
      ? `${Icons.ok} ${t('notify.turnComplete')} | ${sessionTag}(${elapsedStr}${metricsSuffix ?? ''})`
      : `${Icons.error} ${t('notify.turnFailed')} | ${sessionTag}(${elapsedStr})`;

    const dest: Destination = { type: 'interactive-reply', conduit: channel, sessionId: sessionId ?? '' };
    const opts = threadAnchorId ? { threadId: threadAnchorId } : undefined;
    const queue = getOutboundQueue();
    if (queue) {
      await durablePost(queue, adapter, dest, { text }, opts);
    } else {
      await adapter.postMessage(dest, { text }, opts);
    }
  } catch (err) {
    log.warn('turn-complete notification failed:', (err as Error)?.message ?? err);
  }
}
