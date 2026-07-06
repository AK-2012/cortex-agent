// Active/History scope → query-filter mapping for the workbench right panel (design 3a).
// Single source of truth for what "Active" vs "History" means per tab. The ui-service
// contract filters server-side: threads.list by status[], tasks.list by 'open'|'done'.

export const SCOPES = ['active', 'history'] as const;

export type Scope = (typeof SCOPES)[number];

// Thread status vocabulary (ui-service types.ts ThreadInfo.status):
// running | waiting | completed | failed | cancelled | aborted.
const THREAD_ACTIVE = ['running', 'waiting'] as const;
const THREAD_HISTORY = ['completed', 'failed', 'cancelled', 'aborted'] as const;

/** threads.list `status` filter for a scope: live threads vs terminal ones. */
export function threadScopeFilter(scope: Scope): string[] {
  return scope === 'active' ? [...THREAD_ACTIVE] : [...THREAD_HISTORY];
}

/** tasks.list `status` filter for a scope: open (active) vs done (history). */
export function taskScopeFilter(scope: Scope): 'open' | 'done' {
  return scope === 'active' ? 'open' : 'done';
}
