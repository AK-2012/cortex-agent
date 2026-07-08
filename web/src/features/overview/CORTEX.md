# features/overview/ — Project Overview 6a center view (Stage-R R2)

The `/overview` route: the project **Overview** as a center-column view inside the workbench frame,
rebuilt 1:1 from `design/ref/prototype.dc.html` L525–655 (plan §8.5 Overview row, task df67). Reuses
the 1:1 `LeftRail` (f528) + `RightPanel` (1e96); only the center pane swaps to `OverviewView`,
mirroring the prototype's `isOverview` state. Diffed vs `proto-shots/10-overview.png`.

## Layout

| path | role |
|---|---|
| `OverviewPage.tsx` | Route `/overview`. The 240/fluid/400 flex frame (same as `WorkbenchPage`) assembling `<LeftRail/> <OverviewView/> <RightPanel/>`. |
| `OverviewView.tsx` | The center pane 1:1 (prototype L525–655): header bar (‹ back → `/workbench` · projName · Overview · Adjust-budget · ⋯) + cost summary bar + 2-col card grid (Last-14-days · Project memory · Where-it-goes · Schedules · Executions span-2). Exact inline styles/px/hex/font/weight/EN copy; real tRPC data substituted. |
| `overview-vm.ts` | **Pure** VM helpers (TDD): `formatMoney` · `deriveActiveProjectId` (mirrors LeftRail) · `scheduleIntervalLabel` · `nextRunLabel`/`lastRunLabel` (relative humanize) · `execDurationMs`/`formatDuration` · `execMachine`/`execCost`/`execStatusPill` (verbatim §5 pill hexes)/`execSummary`. |
| `overview-vm.test.ts` | vitest for `overview-vm.ts` (19 tests, written first). |

## Real data vs data-gap placeholders

- **REAL**: cost header today/week/month = `cost.summary({projectId})` (project-scoped); **Schedules** =
  `schedules.list({projectId})` (name · interval-label · next-in/last · paused badge + **Resume** =
  real `schedules.resume` mutation → invalidate `schedules.list`); **Executions** = `executions.list`
  filtered client-side by project (id · summary · machine · dur · cost · status pill · Logs →
  `useExecutionLogDrawer().open(id)`, the b963 execution-log drawer overlay). Active project =
  most-recent session's project (`deriveActiveProjectId`).
- **EXPLICIT placeholder** (mandated): **Project memory** — no fs-read tRPC scope → placeholder note
  (**Stage 6**), not fabricated file rows.
- **Structural chrome 1:1 + neutral placeholder (flagged, no fabricated numbers)**: budget bar +
  `budget /day` + `forecast today` — `CostSummary` has no budget/forecast field (**Stage 7**); **Last
  14 days** — no per-day cost series → structural bar skeleton + real `today` label, `avg —/day`
  (**Stage 7**); **Where it goes** — `byTrigger` is free-form + global, no threads/sessions/schedules
  breakdown → empty bars + `—` (**Stage 7**). Adjust-budget + ⋯ are inert (no budget mutate scope).
  The Schedules `+ New` now opens the New-schedule overlay (`features/schedule`, real `schedules.add`).

## Notes

- **No backend change** — existing ui-service contract only (`projects.list`/`sessions.list`/
  `cost.summary`/`schedules.list`/`schedules.resume`/`executions.list`). Web-only.
