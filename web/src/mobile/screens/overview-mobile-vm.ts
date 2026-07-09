import type { ScheduleInfo, ExecutionInfo } from '@cortex-agent/ui-contract';

// Pure ZH view-model helpers for the mobile 10f project Overview (scheme.dc.html L3249–3298, task
// 82ff). The mobile viewport renders zh, so these produce the scheme's Chinese magnitudes; no JSX,
// no fabricated data. Precedent: features/overview/overview-vm.ts (EN desktop analogue) +
// features/memory/memory-vm.ts (relTimeAgo).

/** `quad-nav-sim2real` → `QN`; single word → first two chars; null/empty → `—`. Uppercased. */
export function projectAvatarInitials(projectId: string | null): string {
  if (!projectId) return '—';
  const words = projectId.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return '—';
  const chars =
    words.length >= 2 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return chars.toUpperCase();
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Bare ZH magnitude for a past timestamp: `刚刚` / `N 分钟` / `N 小时` / `N 天` / `—`. */
export function relTimeZh(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const ms = Math.max(0, now - t);
  const m = Math.round(ms / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟`;
  const h = Math.round(ms / 3600000);
  if (h < 24) return `${h} 小时`;
  return `${Math.round(ms / 86400000)} 天`;
}

/**
 * Right-aligned interval label. `daily`/`weekly` carry the clock time derived from nextRun (scheme
 * `每天 07:30`). GAP: ScheduleInfo has no interval-period value, so `interval` cannot render a period
 * — the relative next-run (nextRunLabelZh) carries the actionable info instead. Flagged.
 */
export function intervalLabelZh(s: ScheduleInfo): string {
  if (s.nextRun && (s.type === 'daily' || s.type === 'weekly')) {
    const prefix = s.type === 'daily' ? '每天' : '每周';
    return `${prefix} ${hhmm(s.nextRun)}`;
  }
  return s.type;
}

function humanizeZh(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} 分钟`;
  const h = Math.round(ms / 3600000);
  if (h < 24) return `${h} 小时`;
  return `${Math.round(ms / 86400000)} 天`;
}

/** `19 小时后` / `10 分钟后` / `即将` / `—`. */
export function nextRunLabelZh(nextRun: string | null, now: number): string {
  if (!nextRun) return '—';
  const diff = Date.parse(nextRun) - now;
  if (Number.isNaN(diff)) return '—';
  if (diff <= 0) return '即将';
  return `${humanizeZh(diff)}后`;
}

/**
 * `上次 2 小时前` / `未运行`. The prototype's outcome text (`✓ 3 篇入库`) has no backend field, so it
 * is NOT fabricated — only the elapsed-since-last-run is surfaced. Flagged.
 */
export function lastRunLabelZh(lastRun: string | null, now: number): string {
  if (!lastRun) return '未运行';
  const diff = now - Date.parse(lastRun);
  if (Number.isNaN(diff)) return '未运行';
  return `上次 ${humanizeZh(Math.max(0, diff))}前`;
}

/** Count executions whose `startedAt` falls on the same local calendar day as `now`. */
export function countTodayExecutions(execs: ExecutionInfo[], now: number): number {
  const ref = new Date(now);
  const y = ref.getFullYear();
  const mo = ref.getMonth();
  const d = ref.getDate();
  return execs.filter((e) => {
    if (!e.startedAt) return false;
    const t = Date.parse(e.startedAt);
    if (Number.isNaN(t)) return false;
    const s = new Date(t);
    return s.getFullYear() === y && s.getMonth() === mo && s.getDate() === d;
  }).length;
}

/** Header sub-line: `N 线程运行中` (phase/milestone have no DTO field → omitted, not fabricated). */
export function activeThreadCountLabelZh(n: number): string {
  return `${n} 线程运行中`;
}
