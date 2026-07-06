# features/workbench/ — Workbench app-shell frame + Left Rail + Center Chat + Right Panel (Stage-R RB)

The `/workbench` route is the app-shell **frame** — the load-bearing seam every workbench pane
composes into (plan §8.6 RB). Rebuilt 1:1 from `design/ref/prototype.dc.html` L39–100: a single
`display:flex;height:100vh;min-width:1180px;overflow:hidden` row holding three panes — **240px**
LeftRail (flex:none) / **fluid** CenterChat (flex:1;min-width:0) / **400px** RightPanel (flex:none).
LeftRail (f528) + CenterChat (89e7) + RightPanel (1e96) are all real 1:1 — the RB frame is complete.

## Active (RB frame)

| path | role |
|---|---|
| `WorkbenchPage.tsx` | Route `/workbench`. The outer flex frame (prototype L39) assembling `<LeftRail/> <CenterChat/> <RightPanel/>`. |
| `LeftRail.tsx` | **Real Left Rail 1:1** (prototype L42–100). Exact inline styles/px/hex/font/weight/EN copy; real `projects.list` + `sessions.list` (+ `cost.summary`) substituted into the design's structure. cx logo + daemon dot · project card (active project = most-recent session's project; avatar initials; cost-only sub-line) · + New session (⌘N, inert — no create scope) · session groups TODAY/YESTERDAY/EARLIER · approval banner (hidden, GAP-1) · EN/中 (EN active) · Settings→`/settings`. |
| `CenterChat.tsx` | **Real CENTER CHAT 1:1** (prototype L103–395, task 89e7, RB sibling B). Same `export function CenterChat()`. Fills the fluid center pane; composes `ChatHeader` + `MessageStream` + `Composer` (morning-session default, running=true). |
| `ChatHeader.tsx` | Chat header (prototype L107–130): session title · profile chip · running/idle pill · ⌘K (dispatches the global palette keydown). |
| `MessageStream.tsx` | Message stream (prototype L131–357): TODAY divider · right-aligned user bubble · `ToolCallsRow` · assistant text+result chips · `InlineThreadCardProto` (LIVE) · `ApprovalCard`. Static representative transcript (GAP-A). |
| `ToolCallsRow.tsx` | Collapsed/expanded tool-call row (prototype L152–172); local toggle. |
| `ApprovalCard.tsx` | Inline approval-required card (prototype L247–276, pending·unarmed); INERT Approve/Deny (GAP-B). |
| `Composer.tsx` | Composer (prototype L359–395): slash palette (local) · running/idle status line · input · `/ commands` chip · stop/send (INERT, GAP-C). |
| `InlineThreadCardProto.tsx` | **LIVE inline thread card** (prototype L180–246) bound to REAL `threads.get` (B1): picks the first running/waiting thread from `threads.list`, maps `ThreadDetail`→prototype rows via `thread-card-proto`, re-flows live via `useThreadGetLiveSync`. The one live-data surface of the chat. |
| `thread-card-proto.ts` | **Pure** (TDD): `threadPill` (status→prototype pill pair) + `buildThreadCard` (`ThreadDetail`→vertical rows; only the running step expands its subthread cards + nested rows; done/pending collapse). |
| `thread-card-proto.test.ts` | vitest for `thread-card-proto.ts` (4 tests). |
| `chat-content.ts` | **Pure** (TDD): `fmtClock`/`moneyLabel`/`toolCallsLabel` + `MORNING` representative transcript constants + `SLASH_COMMANDS` (verbatim from the prototype script). |
| `chat-content.test.ts` | vitest for `chat-content.ts` (9 tests). |
| `RightPanel.tsx` | **Real Right Panel 1:1** (prototype L1091–1276, task 1e96). Same export `RightPanel(): JSX.Element` (replaced the f528 STUB). Exact inline styles/px/hex/font/weight/EN copy; real tRPC data. Tab bar Threads/Tasks/Machines + counts (real `threads.list` active len · `tasks.list` open actionable count · Machines `0` GAP-M) · cost/budget bar (real `cost.summary.today`; budget denominator GAP-B) · Active/History toggle (`scope.ts`) · Threads tab = `RightThreadCard` list · Tasks tab = reused `features/tasks/TasksPanel` · Machines tab = `RightMachinesTab` stub. |
| `RightThreadCard.tsx` | One thread card 1:1 (prototype L1115–1185). Header (node icon · mono templateName · status pill · meta line · depth dots) + collapsible step-tree body (running/opened cards fetch `threads.get`; dot+tail grid, active-step dispatch/subthread sub-cards) + footer (Pause · Cancel · Detail · Σcost). Cancel = real `threads.cancel` mutation → invalidates `threads.list`/`threads.get` (live). Pause inert (GAP-P). |
| `RightMachinesTab.tsx` | Machines tab **structural stub** (prototype L1237–1274). GAP-M: no machines tRPC scope (Stage 7). |
| `right-panel-vm.ts` | **Pure** VM helpers (TDD): `threadPill` (verbatim prototype `pill()` hexes) · `stepDotKind` · `formatCost`/`formatDurationS`/`stepMeta` · `formatAge`/`threadMetaLine` · `depthInfo` (reuses `thread/nested-threads` `treeMaxLevel`) · `actionableCount`. |
| `right-panel-vm.test.ts` | vitest for `right-panel-vm.ts` (19 tests). |
| `session-groups.ts` | **Pure** helpers (TDD): `groupSessions` (local-day TODAY/YESTERDAY/EARLIER partition, recent-first), `sessionMeta` (HH:MM + `· from schedule`), `projectInitials`. |
| `session-groups.test.ts` | vitest for `session-groups.ts` (10 tests). |
| `scope.ts` / `scope.test.ts` | Active/History → query-filter mapping (`threadScopeFilter` status[] · `taskScopeFilter` open\|done). Reused by RightPanel. |
| `useThreadsLiveSync.ts` | One SSE subscription on thread lifecycle events → invalidate `threads.list` (Threads tab live-sync). |

**Data gaps rendered structurally + flagged** (paired stage). Left Rail (f528): GAP-1 approvals
banner — no tRPC approvals scope → conditionally hidden (**Stage 5**); GAP-2 `SessionInfo` no
turns/cost/running fields (session-detail backend, later); GAP-3 `ProjectConduitInfo` no
phase/milestone → project sub-line cost-only (**Stage 6**). Center Chat (89e7): GAP-A chat transcript
body — no session-transcript tRPC scope → divider/user/tool-call/assistant blocks are the prototype's
representative morning content, static (**Stage 4**); GAP-B approval card — no approvals scope →
representative APR-0007, inert buttons (**Stage 5**); GAP-C composer send — no session-send mutate →
input + slash palette local-only, send/stop inert (**Stage 4**). The one LIVE center surface is the
inline thread card (`threads.get`). Right Panel (1e96): **GAP-M** Machines tab — no machines tRPC
scope (**Stage 7**); **GAP-P** Pause — no `threads` pause MutateOp (inert affordance); **GAP-B**
budget denominator — `CostSummary` has `today` only, no budget scope (rendered `today` real, `/ —` +
empty bar; **Stage 7**).

## Legacy (superseded — KEPT, not route-reachable)

`SessionList` · `ChatPlaceholder` (token-summary 3a, task 5b0f). The old right-panel
`RightPanelTabs`/`ThreadsPanel`/`MachinesPanel` were **removed** by 1e96 (replaced 1:1).
`features/thread/InlineThreadCard` (the design/*-primitive Stage-3 card) is now unreferenced — the
Center Chat uses its own 1:1 `InlineThreadCardProto`; kept valid for any future reuse.

## Notes

- **No backend change** — existing ui-service contract only (`projects.list`, `sessions.list`,
  `cost.summary`, + `threads.list`/`threads.get`/`threads.cancel`/`subscribe` for the center inline
  card + right panel). Web-only.
- **Verified live** (task f528): real dist ui-http-server + real `ProjectStore`/`sessionStore`/
  `getCostSummary` (real ~/.cortex data) serving built `web/dist` behind `x-cortex-token`;
  headless-Chrome CDP (token via `Network.setExtraHTTPHeaders`) at 1440×900 → frame **240/800/400**,
  **759 real sessions** grouped, real project card, stubs mounted, **0 console errors**. Side-by-side
  vs `proto-shots/00-workbench.png` committed at `design/build-shots/f528-leftrail-compare.png`.
- **Verified live** (task 89e7, Center Chat): same real dist ui-http harness + real `threadStore`/
  `executionRegistry` (122 real threads) + headless-Chrome CDP at 1440×900 → center pane renders the
  chat surface 1:1 (header/divider/user/tool-calls/assistant+chips/approval/composer all asserted);
  the inline thread card bound to **REAL `threads.get`** (live thread `thr_716d87f1` coder-review),
  **0 console errors**. Side-by-side vs `proto-shots/00-workbench.png` (center region) committed at
  `design/build-shots/89e7-centerchat-compare.png`. Real-data differences vs the mock (flagged): the
  live thread card shows the actual thread's steps (no persisted subthreads locally; B1 `x/N`
  off-by-one → `Step 2/1`); status-line clock is the static default `42:13` (prototype's live tick
  reads `42:14`).
- **Right panel verified live** (task 1e96): same real dist ui-http harness with real `threadStore`
  (122)/`taskStore`/`executionRegistry`/`getCostSummary`; headless-Chrome CDP at 1440×900 → frame
  **240/800/400**, tab bar **Threads 5 / Tasks 20 / Machines 0**, cost bar (real `cost.summary.today`),
  Active/History toggle, real thread cards with `threads.get` step-tree + Pause/Cancel/Detail + Σcost,
  History + Tasks tab switches, **0 console errors**. Side-by-side committed at
  `design/build-shots/1e96-rightpanel-compare.png`. `threads.cancel` live Active→History proven in an
  isolated `CORTEX_HOME` harness over the browser's `httpBatchLink` transport (synthetic thread; zero
  production impact).
