// input:  PlatformAdapter + sessionStore + status-helpers
// output: finalizeThreadSuccess + buildProgressUpdater
// pos:    shared helper functions used by both the scheduled-task and task-dispatch jobs

import type { PlatformAdapter, MessageRef } from '@platform/index.js';
import type { AgentResult } from '@core/types/agent-types.js';
import { buildSessionTag, buildUserProcessingMessage, computeElapsed, formatMetricsSuffix } from '@core/status-format.js';
import { createLogger } from '@core/log.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { getOutboundQueue, durableUpdate } from '@store/outbound-queue.js';
import { getActiveBackend, getActiveProfile } from '../../agents/index.js';

const log = createLogger('scheduler');

export function buildProgressUpdater(adapter: PlatformAdapter, statusMsg: MessageRef, startTime: number, effectiveProfile: string, sessionName: string): (progress: Record<string, any> | null) => void {
  return (progress) => {
    adapter.updateMessage(statusMsg, {
      text: buildUserProcessingMessage({
        startTime,
        elapsed_s: progress?.duration_ms != null ? progress.duration_ms / 1000 : null,
        num_turns: progress?.num_turns ?? null,
        profileName: effectiveProfile, sessionName,
      }),
    }).catch((e: Error) => {
      log.error('Failed to update processing status:', e.message);
    });
  };
}

export async function finalizeThreadSuccess(adapter: PlatformAdapter, channel: string, statusMsg: MessageRef | null, { startTime, sessionName, result, threadResult, project, trigger, label, sessionKind, statusPrefix }: {
  startTime: number; sessionName: string; result: AgentResult | null; threadResult: Record<string, any>;
  project: string; trigger: string; label: string | null; sessionKind: 'scheduled' | 'local'; statusPrefix: string;
}): Promise<void> {
  const { elapsedStr, elapsedS } = computeElapsed(startTime);
  if (result?.sessionId) {
    await sessionStore.registerSession(sessionName, {
      sessionId: result.sessionId, channel,
      backend: getActiveBackend(), kind: sessionKind,
      label,
      profileName: getActiveProfile(channel),
      projectId: project,
    });
  }
  const metrics = formatMetricsSuffix({ costUsd: threadResult.totalCostUsd, numTurns: threadResult.totalNumTurns });
  if (statusMsg) {
    const text = `:white_check_mark: ${statusPrefix} | ${buildSessionTag(sessionName, result?.sessionId)}(${elapsedStr}${metrics})`;
    const queue = getOutboundQueue();
    if (queue) {
      await durableUpdate(queue, adapter, statusMsg, { text });
    } else {
      await adapter.updateMessage(statusMsg, { text });
    }
  }
}
