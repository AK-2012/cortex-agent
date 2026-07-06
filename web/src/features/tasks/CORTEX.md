# features/tasks/ — Tasks tab (design 4a)

Stage-1 task 5 vertical slice: renders the **real** `tasks.list` from a running agent-server
over tRPC, grouped by lifecycle · priority, and live-updates via the tRPC subscription (SSE)
when a task mutation is routed through the daemon. Proves the full stack end-to-end.

| path | role |
|---|---|
| `group-tasks.ts` | Pure `groupTasks(TaskInfo[]) → { open, done }` — splits by lifecycle (open before done), then by priority (high→medium→low), omitting empty groups, stable order. `PRIORITY_ORDER` canonical. |
| `group-tasks.test.ts` | vitest unit test for the grouping logic (TDD — written first). |
| `useTasksLiveSync.ts` | Opens one SSE subscription (`task.claimed/completed/blocked/dispatched`) via the vanilla tRPC client and invalidates the `tasks.list` query on each event → refetch → re-render. |
| `TasksPanel.tsx` | Reusable data-driven body: `tasks.list` query + live-sync + Claim/Complete mutations (`tasks.claim` / `tasks.complete`) + grouped render with loading/error/empty states. Optional `lifecycle?: 'open'\|'done'` restricts to one lifecycle (the workbench Active/History filter passes it; `/tasks` omits it → both). Consumed by `TasksPage` and `features/workbench/RightPanelTabs`. |
| `TasksPage.tsx` | Route component for `/tasks`: thin page wrapper (header + `<TasksPanel />`, both lifecycles). |
| `TaskRow.tsx` | One task row: id (mono) · text · claimed/blocked badges · priority/status pills · Claim (actionable) / Complete (open) action. Carries `data-task-id` / `data-status` for E2E driving. |
| `Pills.tsx` | `PriorityPill` / `StatusPill` — token-driven (tailwind §5 pill palette), no hard-coded hex. |

## Notes

- Live update requires a **daemon-routed** mutation: `taskMutator` publishes `task.claimed` /
  `task.completed` / `task.blocked` only in-process. An external `cortex-task` CLI mutation does
  NOT emit a bus event, so it will not drive a live refresh. `task.unclaimed` / `task.unblocked`
  events do not exist — unclaim/unblock are intentionally absent from this slice's actions.
- Typed against the real `AppRouter` (Stage-1 task 3); see `src/lib/trpc.ts` for why the old
  forward-compat conditional seam was removed (deferred conditionals do not auto-tighten).
