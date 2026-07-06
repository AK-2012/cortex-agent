# features/execution/ — execution detail 8b (F3)

Stage-3 task 2198 (DR-0018 §6.3 F3). Renders a **real `executions.get` (`ExecutionDetailInfo`,
B2-A)** for one execution — lifecycle / watchdog / GPU / cost right rail — with a **live-scrolling
`cortex-run` log stream** (B2-C `executions.log` SSE subscription) on the left, a working **Stop**
(`executions.cancel`), and an **Extend-cap** affordance. Reached from a thread dispatch row
(`features/thread/ThreadStepList` → `/executions/:executionId`); chat is the ultimate host (Stage 4).

| path | role |
|---|---|
| `log-buffer.ts` | **Pure** bounded-log reducer (TDD): `appendLog(state, frame, cap)` accumulates `execution.log` frames into a ring capped at `cap` lines; folds backend flood drops (`frame.dropped`) + client cap eviction into one `dropped` total; ignores replayed frames (`seq ≤ lastSeq`). `EMPTY_LOG` seed. Framework-free. |
| `log-buffer.test.ts` | vitest unit tests for the reducer (TDD — written first, 8 tests). |
| `execution-detail.ts` | **Pure** presentational derivations (TDD): `isStoppable` (running only), `logStreamEnabled` (dispatch.runName present), `formatGpu` (null→"—"; always null today — B2 followup 032e), `formatCost`/`formatNum`/`formatDuration`. |
| `execution-detail.test.ts` | vitest unit tests for the derivations (TDD — written first, 8 tests). |
| `useExecutionLogStream.ts` | Thin React/SSE glue: opens one `executions.log` subscription (gated on `enabled`), reads each UiEvent's `payload.{lines,seq,dropped}`, folds into `appendLog` (`LOG_CAP`=2000). Resets on executionId change; closes on unmount. |
| `LogStreamView.tsx` | **Presentational** log viewer: mono scroll pane, sticky-bottom auto-scroll (unless the user scrolled up), "…N lines dropped" marker, `EmptyState` when no `runName`, waiting placeholder while running. `data-log-stream` for E2E. |
| `ExecutionDetailRail.tsx` | **Presentational** right rail: Lifecycle / Watchdog / GPU / Cost `Card`s + Stop (danger, disabled unless running) + Extend-cap (disabled affordance). `data-execution-rail` / `data-action` for E2E. |
| `execution-render.test.tsx` | `react-dom/server` render checks for the two presentational components (browser E2E is environment-blocked — see `features/thread/CORTEX.md`; 8 tests). |
| `ExecutionDetailPage.tsx` | **Route component** (`/executions/:executionId`): `executions.get` query (refetchInterval 3s while running — no lifecycle bus event exists to invalidate on) + `useExecutionLogStream` + `executions.cancel` mutation (invalidates on settle) → header + two-column (log left, rail right). `data-execution-detail` for E2E. |

## Notes

- **Backend**: B2 (task dd2b) — `executions.get` (B2-A), `ExecutionLogTailer` + `execution.log`
  event (B2-B), `executions.log` subscribe wiring (B2-C). No backend change in this task.
- **UiEvent wrapper**: log frames arrive as `{ type:'execution.log', ts, payload:{ lines, seq,
  dropped? } }` — the log data is on `event.payload`, not the top level (`subscribe.ts`).
- **Live log only for cortex-run launches**: a stream is subscribable only when the daemon
  registered a `runName` for the dispatch (`logStreamEnabled`). Otherwise the location can't be
  resolved and the rail shows a "No live log" empty state.
- **Extend-cap has no backend op** (`MutateOp` = `*.cancel` / `tasks.*` / `schedules.*`): rendered
  as a disabled affordance with a native-title explanation. Real cap extension is a follow-up
  (same class as B2 gpu / 032e). done_when requires only Stop (`executions.cancel`), which is real.
- **gpu is always null today** (no per-execution GPU persisted — B2 followup task 032e) → renders "—".
- **Status/metrics live-refresh** is a poll (`refetchInterval` while running), not a subscription:
  no `execution.*` lifecycle event exists (only `execution.log`). The log itself is push (SSE).
