import type { ProjectConduitInfo, SessionInfo } from '@cortex-agent/ui-contract';

// Pure state logic for the cross-pane "current project" (task 569c). The current project is either an
// explicit user selection (override, set by the LeftRail project switcher) or, absent one, the derived
// default — the project of the most-recently-used session, else the first listed project. Extracted
// verbatim from the former inline LeftRail derivation so LeftRail (writer) and the panes that read the
// shared state resolve identically.

/** Derived default: most-recently-used session's project, else the first listed project, else null. */
export function deriveActiveProjectId(
  sessions: SessionInfo[],
  projects: ProjectConduitInfo[],
): string | null {
  if (sessions.length) {
    const latest = [...sessions].sort(
      (a, b) => Date.parse(b.lastUsedAt || b.createdAt) - Date.parse(a.lastUsedAt || a.createdAt),
    )[0];
    if (latest?.projectId) return latest.projectId;
  }
  return projects[0]?.id ?? null;
}

/** Effective current project: an explicit override wins, else the derived default. */
export function resolveCurrentProjectId(
  override: string | null,
  sessions: SessionInfo[],
  projects: ProjectConduitInfo[],
): string | null {
  return override ?? deriveActiveProjectId(sessions, projects);
}
