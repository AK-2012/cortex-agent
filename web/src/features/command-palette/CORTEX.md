# features/command-palette/ — ⌘K Command Palette (design 6c)

Stage-2 (DR-0018 §5) global command palette on `cmdk`. ⌘K / Ctrl+K opens a modal
palette that searches **real** sessions/threads/tasks over tRPC and navigates via
React Router. Keyboard-only reachable end-to-end. Mounted globally in `shell/AppShell`.

| path | role |
|---|---|
| `palette-items.ts` | Pure `buildPaletteItems({ sessions, threads, tasks }) → PaletteItem[]` — maps the three real tRPC query results into flat, searchable items (group `Sessions`→`/workbench`, `Threads`→`/threads`, `Tasks`→`/tasks`; `keywords` = id/text/name/project/status so cmdk can fuzzy-match by id, not just label; `focusId` = entity id carried in `location.state`). `NAV_COMMANDS` = static section-navigation command items. Stable input order; unique cmdk `value` per item. |
| `palette-items.test.ts` | vitest unit test for `buildPaletteItems` + `NAV_COMMANDS` (TDD — written first, watched fail). |
| `useCommandPalette.ts` | Global ⌘K/Ctrl+K keydown hook (one window listener, cleaned up on unmount) → controlled `{ open, setOpen }`. |
| `CommandPalette.tsx` | The cmdk `Command.Dialog`: fetches `sessions.list`/`threads.list`/`tasks.list` (`enabled` while open) via `useTRPC`, renders a Commands group (nav) + the three entity groups, and on select `navigate(route, { state: { focusId } })` + close. Token-only styling (no hex); overlay/zoom motion reuse the `tailwind.config.ts` animation tokens. |

## Notes

- **File search is intentionally absent.** No `files.*` tRPC query scope exists — the fs-read
  scope is Stage 6 (plan §2.1: each new data surface pairs with its backend task first).
  Adding file jump would require inventing a backend scope, out of this task's scope. The task
  title's "文件" leg is deferred to Stage 6; the done_when only requires sessions/threads/tasks.
- **Navigation targets the entity's section route, not a per-entity detail route** — detail
  routes (`/threads/:id`, chat/session surface) are Stage 3/4. The selected entity id rides in
  React Router `location.state.focusId` so a future detail surface can consume it without a
  speculative unread URL param.
- cmdk (`^1.1.1`) provides the ↑/↓/Enter selection + focus trap; the underlying Radix Dialog
  provides Esc/overlay close + focus restore. `Command.Input` autofocuses on open.
- Query plumbing reuses the task-5-verified `useQuery(trpc.<scope>.list.queryOptions({}, { enabled }))`
  pattern; typed directly against the real `AppRouter`.
