import type { ProjectConduitInfo, ThreadInfo } from '@cortex-agent/ui-contract';

// Pure view-model helpers for the project-card dropdown (prototype.dc.html L1565–1607, task c3ce).
// projects.list carries no status/phase/cost — but ThreadInfo has projectId + status, so per-project
// running counts ARE derivable; cost.summary.today is wired in LeftRail. Phase labels
// ("M3.1 · idle"/"paused") have no backing field (GAP) → meta = real running count, else "idle".

const ACTIVE_THREAD_STATUSES: ReadonlySet<ThreadInfo['status']> = new Set(['running', 'waiting']);

export function runningCountByProject(threads: ThreadInfo[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of threads) {
    if (ACTIVE_THREAD_STATUSES.has(t.status)) {
      counts[t.projectId] = (counts[t.projectId] ?? 0) + 1;
    }
  }
  return counts;
}

export interface SwitchProjectRow {
  id: string;
  running: number;
  isRunning: boolean;
  meta: string;
}

export function switchRowMeta(running: number): string {
  return running > 0 ? running + ' running' : 'idle';
}

// SWITCH PROJECT list = the real projects minus the active one (the active project is the popover
// header). Order preserved from projects.list.
export function buildSwitchList(
  projects: ProjectConduitInfo[],
  activeId: string | null,
  runningCounts: Record<string, number>,
): SwitchProjectRow[] {
  return projects
    .filter((p) => p.id !== activeId)
    .map((p) => {
      const running = runningCounts[p.id] ?? 0;
      return { id: p.id, running, isRunning: running > 0, meta: switchRowMeta(running) };
    });
}

// Header sub-line, mirroring the prototype's `projMenuSub` ("2 threads running · $4.21 today").
export function projMenuSubLabel(activeRunning: number, todayCost: number | undefined): string {
  const threadPart =
    activeRunning + ' ' + (activeRunning === 1 ? 'thread' : 'threads') + ' running';
  if (typeof todayCost === 'number') {
    return threadPart + ' · $' + todayCost.toFixed(2) + ' today';
  }
  return threadPart;
}
