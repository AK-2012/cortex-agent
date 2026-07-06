// input:  ExecutionRepo singleton (store/execution-repo.ts)
// output: named function exports matching the pre-migration API surface, with lock-release side effect on terminal transitions
// pos:    thin re-export layer — delegates to ExecutionRepo. Maintains backward compat for all import sites.
//         Lock-release: every terminal transition (complete/fail/cancel/stale) auto-releases any task lock held by the executionId.
// >>> If I am updated, update my header comment and CORTEX.md <<<

import * as fs from 'node:fs';
import { executionRepo, TERMINAL_STATUSES } from '@store/execution-repo.js';
import { PROJECTS_DIR } from '@core/utils.js';
import { readLock, releaseLock } from '@domain/tasks/system/task-lock.js';
import { createLogger } from '@core/log.js';
import { runningExecutions } from '@core/running-executions.js';
import type { AgentResult } from '@core/types/agent-types.js';

export type { ExecutionRecord, DispatchInfo, ExecutionGpuInfo } from '@store/execution-repo.js';
export { TERMINAL_STATUSES };

const lockLog = createLogger('execution-lock-release');

/** Release any task locks still owned by `executionId` after its agent finished.
 *  Idempotent — `releaseLock` returns success on absent or non-matching locks. */
function releaseLocksOwnedBy(executionId: string | null | undefined): void {
  if (!executionId) return;
  let projects: string[];
  try {
    projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch { return; }

  for (const project of projects) {
    let lock;
    try { lock = readLock(project); } catch { continue; }
    if (!lock || lock.owner !== executionId) continue;
    try {
      const r = releaseLock(project, executionId);
      if (r.released) {
        lockLog.warn(
          `auto-released stale lock on '${project}' held by execution ${executionId} ` +
          `(agent finished without calling cortex-task lock-release)`,
        );
      }
    } catch (err: any) {
      lockLog.warn(`release attempt failed for ${project} / ${executionId}: ${err?.message || err}`);
    }
  }
}

// --- Sync reads ---

export function getExecution(id: string) {
  return executionRepo.getExecution(id);
}

export function getExecutionByTaskId(taskId: string | null | undefined) {
  return executionRepo.getExecutionByTaskId(taskId);
}

export function getAll() {
  return executionRepo.getAll();
}

export function getRunningExecutions() {
  return executionRepo.getRunningExecutions();
}

export function findRunningDispatchMatch(opts: Parameters<typeof executionRepo.findRunningDispatchMatch>[0]) {
  return executionRepo.findRunningDispatchMatch(opts);
}

// --- Sync create/mutate + fire-and-forget persist ---

export function startLocalExecution(opts: Parameters<typeof executionRepo.startLocalExecution>[0]) {
  return executionRepo.startLocalExecution(opts);
}

export function registerDispatchExecution(opts: Parameters<typeof executionRepo.registerDispatchExecution>[0]) {
  return executionRepo.registerDispatchExecution(opts);
}

export function touchExecution(id: string, patch?: Parameters<typeof executionRepo.touchExecution>[1]) {
  return executionRepo.touchExecution(id, patch);
}

export function setExecutionGpuByTaskId(taskId: string, gpu: Parameters<typeof executionRepo.setExecutionGpuByTaskId>[1]) {
  return executionRepo.setExecutionGpuByTaskId(taskId, gpu);
}

export function completeExecution(id: string, metrics?: Parameters<typeof executionRepo.completeExecution>[1]) {
  const r = executionRepo.completeExecution(id, metrics);
  if (r && TERMINAL_STATUSES.has(r.status)) releaseLocksOwnedBy(id);
  return r;
}

export function completeExecutionByTaskId(taskId: string, metrics?: Parameters<typeof executionRepo.completeExecutionByTaskId>[1]) {
  const record = executionRepo.getExecutionByTaskId(taskId);
  if (!record) return null;
  return completeExecution(record.id, metrics);
}

export function failExecution(id: string, metrics?: Parameters<typeof executionRepo.failExecution>[1]) {
  const r = executionRepo.failExecution(id, metrics);
  if (r && TERMINAL_STATUSES.has(r.status)) releaseLocksOwnedBy(id);
  return r;
}

export function failExecutionByTaskId(taskId: string, metrics?: Parameters<typeof executionRepo.failExecutionByTaskId>[1]) {
  const record = executionRepo.getExecutionByTaskId(taskId);
  if (!record) return null;
  return failExecution(record.id, metrics);
}

export function cancelExecution(id: string, metrics?: Parameters<typeof executionRepo.cancelExecution>[1]) {
  const r = executionRepo.cancelExecution(id, metrics);
  if (r && TERMINAL_STATUSES.has(r.status)) releaseLocksOwnedBy(id);
  return r;
}

export function cancelExecutionByTaskId(taskId: string, metrics?: Parameters<typeof executionRepo.cancelExecutionByTaskId>[1]) {
  const record = executionRepo.getExecutionByTaskId(taskId);
  if (!record) return null;
  return cancelExecution(record.id, metrics);
}

/**
 * Close an execution across BOTH ledgers in one call: finalize the persistent record
 * (idempotent — terminal status is guarded in execution-repo) and tear down the in-memory
 * live registry while publishing the matching agent.* lifecycle event.
 *
 * This is the single teardown every execution path should funnel through so the persistent
 * status, the live registry, and the bus events never drift apart. In particular it gives
 * thread steps their agent.completed/failed events, which the old event-less remove() skipped.
 *
 * Does NOT touch the busy-tracker — trackPendingTask(±1) is per-enqueue (a thread spans many
 * steps under one +1), so it stays managed by the caller.
 */
export function teardownExecution({ executionId, status, result, error, durationS, costUsd }: {
  executionId: string | null;
  status: 'completed' | 'failed' | 'cancelled';
  result?: AgentResult | null;
  error?: { message?: string } | null;
  durationS: number;
  costUsd?: number;
}) {
  if (!executionId) return null;
  let rec;
  if (status === 'completed') {
    rec = completeExecution(executionId, {
      costUsd: result?.total_cost_usd, numTurns: result?.num_turns, durationS, finalOutput: result?.finalOutput || null,
    });
    runningExecutions.complete(executionId, costUsd ?? result?.total_cost_usd ?? 0);
  } else if (status === 'cancelled') {
    rec = cancelExecution(executionId, { durationS });
    // The kill already happened on the cancel path; supersede() publishes agent.superseded
    // and removes the entry (a second kill() is harmless).
    runningExecutions.supersede(executionId, 'cancelled');
  } else {
    rec = failExecution(executionId, { durationS, error: error?.message || null });
    runningExecutions.fail(executionId, error?.message ?? 'error');
  }
  return rec;
}

// --- Async operations ---

export async function markMissingRunningExecutionsStale(keepRunning?: Parameters<typeof executionRepo.markMissingRunningExecutionsStale>[0]) {
  const staled = await executionRepo.markMissingRunningExecutionsStale(keepRunning);
  for (const id of staled) releaseLocksOwnedBy(id);
  return staled;
}

export async function reconcileStaleDispatches(opts: Parameters<typeof executionRepo.reconcileStaleDispatches>[0]) {
  const { count, staled } = await executionRepo.reconcileStaleDispatches(opts);
  for (const id of staled) releaseLocksOwnedBy(id);
  return count;
}

// --- Deprecated ---

/** @deprecated ExecutionRepo uses in-memory Map; cache clearing is a no-op. */
export function clearExecutionCache(): void {
  // no-op: ExecutionRepo does not use module-level cache
}
