// input:  UiServiceDeps + ExecutionsListParams
// output: handleExecutionsList → ExecutionInfo[]
// pos:    query handler for 'executions.list'

import type { UiServiceDeps, ExecutionInfo, ExecutionsListParams } from '../types.js';

export async function handleExecutionsList(
  deps: UiServiceDeps,
  params: ExecutionsListParams,
): Promise<ExecutionInfo[]> {
  const { status, limit } = params;

  let executions = deps.executionRegistry.getAll();

  if (status && status.length > 0) {
    const statusSet = new Set(status);
    executions = executions.filter((e: any) => statusSet.has(e.status));
  }

  // Sort by startedAt descending
  executions.sort((a: any, b: any) =>
    (b.runtime?.startedAt || '').localeCompare(a.runtime?.startedAt || ''),
  );

  if (limit && limit > 0) {
    executions = executions.slice(0, limit);
  }

  return executions.map((e: any): ExecutionInfo => {
    const startedAt = e.runtime?.startedAt || '';
    const finishedAt = e.runtime?.endedAt || null;
    const startMs = new Date(startedAt).getTime();
    const endMs = finishedAt ? new Date(finishedAt).getTime() : null;

    return {
      id: e.id,
      type: e.kind === 'dispatch' ? 'dispatch' : 'local',
      status: e.status,
      taskId: e.dispatch?.taskId ?? null,
      sessionId: e.session?.sessionId ?? null,
      projectId: e.project ?? null,
      machine: e.dispatch?.machine ?? null,
      startedAt,
      finishedAt,
      durationMs: endMs ? endMs - startMs : null,
      cost: e.metrics?.costUsd ?? null,
    };
  });
}
