# features/workbench/ — Workbench app-shell frame + Left Rail + Right Panel (Stage-R RB)

The `/workbench` route is the app-shell **frame** — the load-bearing seam every workbench pane
composes into (plan §8.6 RB). Rebuilt 1:1 from `design/ref/prototype.dc.html` L39–100: a single
`display:flex;height:100vh;min-width:1180px;overflow:hidden` row holding three panes — **240px**
LeftRail (flex:none) / **fluid** CenterChat (flex:1;min-width:0) / **400px** RightPanel (flex:none).
LeftRail (f528) + RightPanel (1e96) are real 1:1; CenterChat is a STUB slot (Stage-R sibling B).

## Active (RB frame)

| path | role |
|---|---|
| `WorkbenchPage.tsx` | Route `/workbench`. The outer flex frame (prototype L39) assembling `<LeftRail/> <CenterChat/> <RightPanel/>`. |
| `LeftRail.tsx` | **Real Left Rail 1:1** (prototype L42–100). Exact inline styles/px/hex/font/weight/EN copy; real `projects.list` + `sessions.list` (+ `cost.summary`) substituted into the design's structure. cx logo + daemon dot · project card (active project = most-recent session's project; avatar initials; cost-only sub-line) · + New session (⌘N, inert — no create scope) · session groups TODAY/YESTERDAY/EARLIER · approval banner (hidden, GAP-1) · EN/中 (EN active) · Settings→`/settings`. |
| `CenterChat.tsx` | **STUB** slot. `export function CenterChat()` renders only the center pane container (prototype L103). Sibling B replaces. |
| `RightPanel.tsx` | **Real Right Panel 1:1** (prototype L1091–1276, task 1e96). Same export `RightPanel(): JSX.Element` (replaced the f528 STUB). Exact inline styles/px/hex/font/weight/EN copy; real tRPC data. Tab bar Threads/Tasks/Machines + counts (real `threads.list` active len · `tasks.list` open actionable count · Machines `0` GAP-M) · cost/budget bar (real `cost.summary.today`; budget denominator GAP-B) · Active/History toggle (`scope.ts`) · Threads tab = `RightThreadCard` list · Tasks tab = reused `features/tasks/TasksPanel` · Machines tab = `RightMachinesTab` stub. |
| `RightThreadCard.tsx` | One thread card 1:1 (prototype L1115–1185). Header (node icon · mono templateName · status pill · meta line · depth dots) + collapsible step-tree body (running/opened cards fetch `threads.get`; dot+tail grid, active-step dispatch/subthread sub-cards) + footer (Pause · Cancel · Detail · Σcost). Cancel = real `threads.cancel` mutation → invalidates `threads.list`/`threads.get` (live). Pause inert (GAP-P). |
| `RightMachinesTab.tsx` | Machines tab **structural stub** (prototype L1237–1274). GAP-M: no machines tRPC scope (Stage 7). |
| `right-panel-vm.ts` | **Pure** VM helpers (TDD): `threadPill` (verbatim prototype `pill()` hexes) · `stepDotKind` · `formatCost`/`formatDurationS`/`stepMeta` · `formatAge`/`threadMetaLine` · `depthInfo` (reuses `thread/nested-threads` `treeMaxLevel`) · `actionableCount`. |
| `right-panel-vm.test.ts` | vitest for `right-panel-vm.ts` (19 tests). |
| `session-groups.ts` | **Pure** helpers (TDD): `groupSessions` (local-day TODAY/YESTERDAY/EARLIER partition, recent-first), `sessionMeta` (HH:MM + `· from schedule`), `projectInitials`. |
| `session-groups.test.ts` | vitest for `session-groups.ts` (10 tests). |
| `scope.ts` / `scope.test.ts` | Active/History → query-filter mapping (`threadScopeFilter` status[] · `taskScopeFilter` open\|done). Reused by RightPanel. |
| `useThreadsLiveSync.ts` | One SSE subscription on thread lifecycle events → invalidate `threads.list` (Threads tab live-sync). |

**Data gaps rendered structurally + flagged** (paired stage). Left rail (f528): GAP-1 approvals
banner — no tRPC approvals scope (**Stage 5**); GAP-2 `SessionInfo` no turns/cost/running fields;
GAP-3 `ProjectConduitInfo` no phase/milestone (**Stage 6**). Right panel (1e96): **GAP-M** Machines
tab — no machines tRPC scope (**Stage 7**); **GAP-P** Pause — no `threads` pause MutateOp (inert
affordance); **GAP-B** budget denominator — `CostSummary` has `today` only, no budget scope
(rendered `today` real, `/ —` + empty bar; **Stage 7** config surface).

## Legacy (superseded — KEPT, not route-reachable)

`SessionList` · `ChatPlaceholder` (token-summary 3a, task 5b0f; center-chat sibling B may salvage).
The old right-panel `RightPanelTabs`/`ThreadsPanel`/`MachinesPanel` were **removed** by 1e96 (replaced
1:1). `features/thread/InlineThreadCard` is now unreferenced (its ThreadsPanel host was removed) but
kept valid for the Stage-4 chat host.

## Notes

- **No backend change** — existing ui-service contract only (`projects.list`, `sessions.list`,
  `cost.summary`). Web-only.
- **Verified live** (task f528): real dist ui-http-server + real `ProjectStore`/`sessionStore`/
  `getCostSummary` (real ~/.cortex data) serving built `web/dist` behind `x-cortex-token`;
  headless-Chrome CDP (token via `Network.setExtraHTTPHeaders`) at 1440×900 → frame **240/800/400**,
  **759 real sessions** grouped, real project card, stubs mounted, **0 console errors**. Side-by-side
  vs `proto-shots/00-workbench.png` committed at `design/build-shots/f528-leftrail-compare.png`.
- **Right panel verified live** (task 1e96): same real dist ui-http harness with real `threadStore`
  (122)/`taskStore`/`executionRegistry`/`getCostSummary`; headless-Chrome CDP at 1440×900 → frame
  **240/800/400**, tab bar **Threads 5 / Tasks 20 / Machines 0**, cost bar (real `cost.summary.today`),
  Active/History toggle, real thread cards with `threads.get` step-tree + Pause/Cancel/Detail + Σcost,
  History + Tasks tab switches, **0 console errors**. Side-by-side committed at
  `design/build-shots/1e96-rightpanel-compare.png`. `threads.cancel` live Active→History proven in an
  isolated `CORTEX_HOME` harness over the browser's `httpBatchLink` transport (synthetic thread; zero
  production impact).
