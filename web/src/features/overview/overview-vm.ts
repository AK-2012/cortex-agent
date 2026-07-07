import type {
  ScheduleInfo,
  ExecutionInfo,
  SessionInfo,
  ProjectConduitInfo,
} from '@cortex-agent/ui-contract';

// Pure view-model helpers for the project Overview 6a center view (prototype.dc.html L525–655,
// task df67). No JSX, no hex outside the verbatim-prototype status-pill map. Precedent:
// features/workbench/right-panel-vm.ts.

/** `$4.21` — two decimals, null/undefined → `$0.00`. */
export function formatMoney(n: number | null | undefined): string {
  return '$' + (n ?? 0).toFixed(2);
}

/** Active project = project of the most-recently-used session, else the first listed project. */
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

function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Small right-aligned interval label. `daily`/`weekly` carry the clock time derived from nextRun.
 * GAP: ScheduleInfo has no interval-period value, so `interval` cannot render "every 15m" — the
 * relative next-run (nextRunLabel) carries the actionable info instead. Flagged.
 */
export function scheduleIntervalLabel(s: ScheduleInfo): string {
  if ((s.type === 'daily' || s.type === 'weekly') && s.nextRun) {
    return `${s.type} ${hhmm(s.nextRun)}`;
  }
  return s.type;
}

function humanizeShort(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.round(ms / 3600000);
  if (h < 24) return `${h}h`;
  return `${Math.round(ms / 86400000)}d`;
}

/** `next in 19h` / `next in 10m` / `due` / `—`. */
export function nextRunLabel(nextRun: string | null, now: number): string {
  if (!nextRun) return '—';
  const diff = Date.parse(nextRun) - now;
  if (diff <= 0) return 'due';
  return `next in ${humanizeShort(diff)}`;
}

/** `last 2h ago` / `never run`. Outcome text ("✓ 3 papers") is not exposed — flagged. */
export function lastRunLabel(lastRun: string | null, now: number): string {
  if (!lastRun) return 'never run';
  const diff = now - Date.parse(lastRun);
  return `last ${humanizeShort(Math.max(0, diff))} ago`;
}

/** Real elapsed: durationMs when finished, else (now − startedAt) for a live run. */
export function execDurationMs(e: ExecutionInfo, now: number): number | null {
  if (typeof e.durationMs === 'number') return e.durationMs;
  if (e.startedAt) return Math.max(0, now - Date.parse(e.startedAt));
  return null;
}

/** `5h 51m` / `2m` / `45s` / `—`. */
export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms >= 3600000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

export function execMachine(e: ExecutionInfo): string {
  return e.machine ?? 'local';
}

export function execCost(cost: number | null): string {
  return cost == null ? '—' : '$' + cost.toFixed(2);
}

export interface ExecPill {
  text: string;
  bg: string;
  color: string;
  dot: boolean;
}

/** Status → prototype pill tones (§5 state palette; verbatim hexes). */
export function execStatusPill(status: ExecutionInfo['status']): ExecPill {
  switch (status) {
    case 'running':
      return { text: 'running', bg: '#EEF0FA', color: '#4655D4', dot: true };
    case 'completed':
      return { text: 'done', bg: '#E9F4EE', color: '#23854F', dot: false };
    case 'failed':
      return { text: 'failed', bg: '#FBEDEB', color: '#C03D33', dot: false };
    case 'cancelled':
      return { text: 'cancelled', bg: '#F1F2F5', color: '#8A93A2', dot: false };
    case 'stale':
    default:
      return { text: 'stale', bg: '#F1F2F5', color: '#8A93A2', dot: false };
  }
}

/**
 * Best-effort summary. ExecutionInfo has no free-text summary field (the prototype's
 * "review step · thr_8f2c" is mock), so we surface the strongest identifier we have. Flagged.
 */
export function execSummary(e: ExecutionInfo): string {
  if (e.taskId) return `task ${e.taskId}`;
  if (e.sessionId) return `session ${e.sessionId}`;
  return `${e.type} execution`;
}
