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

export type { ExecutionRecord, DispatchInfo } from '@store/execution-repo.js';
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
