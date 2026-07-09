// Bottom Tab navigation model for the mobile shell (design 5a–5c bottom bar, scheme L2995-3000 /
// L3198). Pure logic — the presentational BottomTabBar binds real tRPC counts to it.
import { type Vocab } from '@/i18n';

export type MobileTabId = 'sessions' | 'threads' | 'tasks' | 'machines';

export interface MobileTab {
  id: MobileTabId;
  path: string;
  // Label comes from useVocab() — 会话/线程/任务/机器 on the mobile (zh) viewport.
  labelKey: keyof Vocab;
}

// Design order (scheme bottom bar): 会话 / 线程 / 任务 / 机器.
export const MOBILE_TABS: readonly MobileTab[] = [
  { id: 'sessions', path: '/m/sessions', labelKey: 'sessions' },
  { id: 'threads', path: '/m/threads', labelKey: 'threads' },
  { id: 'tasks', path: '/m/tasks', labelKey: 'tasks' },
  { id: 'machines', path: '/m/machines', labelKey: 'machines' },
];

/**
 * Which tab is highlighted for a pathname. Sub-paths of a tab (e.g. `/m/threads/thr_x`) count as
 * that tab. The approvals (10e) + overview (10f) sub-screens are reached from the 会话 context, so
 * they keep the sessions tab active. Anything else (incl. a desktop path after a resize) defaults to
 * sessions — the same target the mobile router's catch-all redirects to.
 */
export function activeTabId(pathname: string): MobileTabId {
  const found = MOBILE_TABS.find((t) => pathname === t.path || pathname.startsWith(t.path + '/'));
  return found ? found.id : 'sessions';
}

export interface TabBadge {
  count?: number;
  dot?: boolean;
}

/**
 * Whether a pathname belongs to one of the 4 bottom Tab screens. The mobile shell renders the
 * persistent BottomTabBar only for tab routes; the non-Tab sub-screens (10e approvals / 10f overview,
 * reached via a ‹ back header) hide the bar and own their own home-indicator gutter.
 */
export function isTabRoute(pathname: string): boolean {
  return MOBILE_TABS.some((t) => pathname === t.path || pathname.startsWith(t.path + '/'));
}

/**
 * Per-tab decoration: the active-thread count badge on 线程 (scheme #4655D4 pill) and the amber
 * pending-approval dot on 会话 (scheme #C99A2E). Everything else is undecorated.
 */
export function tabBadge(
  id: MobileTabId,
  data: { activeThreadCount: number; hasPendingApproval: boolean },
): TabBadge {
  if (id === 'threads' && data.activeThreadCount > 0) return { count: data.activeThreadCount };
  if (id === 'sessions' && data.hasPendingApproval) return { dot: true };
  return {};
}
