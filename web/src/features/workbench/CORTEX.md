# features/workbench/ — Workbench three-pane shell (design 3a)

Stage-2 task 5b0f: the core workbench screen. Three panes rendered full-bleed inside the app
shell content area — **left** session list (`sessions.list`) · **center** chat placeholder
(read-only session metadata) · **right** Threads/Tasks/Machines tabs with an Active/History
filter. Renders real agent-server data over tRPC (sessions/threads/tasks); Tasks reuses 4a.

| path | role |
|---|---|
| `WorkbenchPage.tsx` | Route component for `/workbench`. Owns the selected-`SessionInfo` state shared left↔center; lays out SessionList · ChatPlaceholder · RightPanelTabs. |
| `SessionList.tsx` | Left pane. `sessions.list` query → selectable rows (label/name · project · kind). Selecting drives the center pane. Loading/error/empty states. `data-session-id` for E2E. |
| `ChatPlaceholder.tsx` | Center pane. **Placeholder** — the contract has no transcript/message scope (live chat = Stage 4, plan §2.1). Renders the selected session's metadata read-only (`Card` + `ID`/`MonoText`) + a "chat is read-only" note, or an empty prompt when none selected. |
| `RightPanelTabs.tsx` | Right pane. Radix `TabsRoot` (Threads/Tasks/Machines) + a shared Active/History `ScopeToggle`. The scope drives Threads (`status[]`) and Tasks (`open`/`done`); Machines ignores it. |
| `ThreadsPanel.tsx` | `threads.list` filtered by `threadScopeFilter(scope)` (server-side `status[]`), live-updating via `useThreadsLiveSync`. Rows: `ID` · template · step · `StatusPill`. `data-thread-id`/`data-status` for E2E. |
| `MachinesPanel.tsx` | Placeholder `EmptyState` — machines registry is a Stage-7 backend extension (§2.1). |
| `scope.ts` | **Pure** Active/History → filter mapping: `threadScopeFilter(scope) → string[]`, `taskScopeFilter(scope) → 'open'\|'done'`. Single source of truth for the filter semantics. |
| `scope.test.ts` | vitest unit test for `scope.ts` (TDD — the filter partition invariant). |
| `useThreadsLiveSync.ts` | One SSE subscription on `thread.created/step.started/step.finished/completed/failed` → invalidate `threads.list`. Mirrors `features/tasks/useTasksLiveSync`. |

## Notes

- **No backend change**: uses only the existing ui-service contract (`sessions.list`,
  `threads.list`, `tasks.list`, `subscribe`). Chat send/stream, thread detail, and machines data
  are later-stage backend extensions.
- **Active/History**: `active` = live (threads `running/waiting`, tasks `open`); `history` =
  terminal (threads `completed/failed/cancelled/aborted`, tasks `done`). `threads.list` filters
  by `status[]` server-side (`query/threads.ts`); `tasks.list` by `'open'|'done'`.
- **Reuse 4a**: the Tasks tab renders `features/tasks/TasksPanel` with `lifecycle={taskScopeFilter(scope)}`.
  `TasksPanel` (extracted from `TasksPage`) is the shared data-driven body — one source of truth.
- Live thread refresh needs a **daemon-routed** transition (bus events are in-process only), same
  caveat as the Tasks slice.
- The generic global `RightPanel` scaffold was removed from `AppShell` (task 5b0f) — the workbench
  owns its own right panel; other routes are nav + full-bleed content and add their own padding.
