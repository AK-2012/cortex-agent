// input:  formatDurationCompact (core/utils)
// output: 4 pure formatting functions: computeElapsed / formatMetricsSuffix / buildSessionTag / buildUserProcessingMessage
// pos:    zero-dependency pure functions in the core layer; the subset imported by domain-layer status-helpers
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { formatDurationCompact } from './utils.js';

export function computeElapsed(startTime: number): { elapsedStr: string; elapsedS: number } {
  const elapsedS = (Date.now() - startTime) / 1000;
  return { elapsedStr: elapsedS.toFixed(1), elapsedS };
}

export function formatMetricsSuffix({ costUsd, numTurns }: { costUsd: number | null; numTurns: number | null }): string {
  const turnsStr = numTurns != null ? ` · ${numTurns} turns` : '';
  const costStr = costUsd != null ? ` · $${costUsd.toFixed(4)}` : '';
  return `${turnsStr}${costStr}`;
}

/** Build "cortex-XXXX · `uuid`" tag for Slack status messages. */
export function buildSessionTag(sessionName: string | null, sessionId: string | null): string {
  if (!sessionName && !sessionId) return '';
  const parts: string[] = [];
  if (sessionName) parts.push(sessionName);
  if (sessionId) parts.push(`\`${sessionId}\``);
  return parts.join(' · ') + ' | ';
}

export function buildUserProcessingMessage({ startTime, elapsed_s = null, num_turns = null, profileName, sessionName = null, sessionId = null }: { startTime: number; elapsed_s?: number | null; num_turns?: number | null; profileName: string; sessionName?: string | null; sessionId?: string | null }): string {
  const elapsed = elapsed_s ?? ((Date.now() - startTime) / 1000);
  const sessionTag = buildSessionTag(sessionName, sessionId);
  const turnsStr = num_turns != null ? ` | :repeat: ${num_turns} turns` : '';
  return `:hourglass_flowing_sand: Processing | ${sessionTag}${profileName || 'default'} | :stopwatch: ${formatDurationCompact(elapsed || 0)}${turnsStr}`;
}
