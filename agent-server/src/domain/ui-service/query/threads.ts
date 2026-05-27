// input:  UiServiceDeps + ThreadsListParams
// output: handleThreadsList → ThreadInfo[]
// pos:    query handler for 'threads.list'

import type { UiServiceDeps, ThreadInfo, ThreadsListParams } from '../types.js';

export async function handleThreadsList(
  deps: UiServiceDeps,
  params: ThreadsListParams,
): Promise<ThreadInfo[]> {
  const { projectId, status } = params;

  let threads = deps.threadStore.getAll();

  if (projectId) {
    threads = threads.filter((t: any) => t.projectId === projectId);
  }
  if (status && status.length > 0) {
    const statusSet = new Set(status);
    threads = threads.filter((t: any) => statusSet.has(t.status));
  }

  return threads.map((t: any): ThreadInfo => ({
    id: t.id,
    templateName: t.templateName || 'unknown',
    currentStep: t.currentStepIndex != null
      ? { index: t.currentStepIndex, name: t.currentStepName || `step-${t.currentStepIndex}` }
      : null,
    status: t.status,
    projectId: t.projectId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    totalSteps: (t.template?.agents?.length) || t.steps?.length || 0,
    artifactPath: t.artifactPath ?? null,
  }));
}
