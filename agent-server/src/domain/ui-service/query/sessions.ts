// input:  UiServiceDeps + SessionsListParams
// output: handleSessionsList → SessionInfo[]
// pos:    query handler for 'sessions.list'

import type { UiServiceDeps, SessionInfo, SessionsListParams } from '../types.js';

export async function handleSessionsList(
  deps: UiServiceDeps,
  params: SessionsListParams,
): Promise<SessionInfo[]> {
  const { projectId, resumable } = params;

  let sessions: any[];
  if (resumable) {
    sessions = await deps.sessionStore.listResumable(projectId);
  } else if (projectId) {
    sessions = await deps.sessionStore.listByProject(projectId);
  } else {
    // list all — iterate through listByProject for each known project
    // or fall back to listing all sessions via the store
    const allProjects = deps.projectStore.list();
    const results: any[] = [];
    for (const p of allProjects) {
      const projectSessions = await deps.sessionStore.listByProject(p.id);
      results.push(...projectSessions);
    }
    sessions = results;
  }

  return sessions.map((s: any): SessionInfo => ({
    sessionId: s.sessionId,
    name: s.name,
    projectId: s.projectId,
    backend: s.backend,
    kind: s.kind,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    resumable: s.kind !== 'scheduled',
    label: s.label ?? null,
  }));
}
