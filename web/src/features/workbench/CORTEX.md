# features/workbench/ — Workbench app-shell frame + Left Rail (Stage-R RB, task f528)

The `/workbench` route is the app-shell **frame** — the load-bearing seam every workbench pane
composes into (plan §8.6 RB). Rebuilt 1:1 from `design/ref/prototype.dc.html` L39–100: a single
`display:flex;height:100vh;min-width:1180px;overflow:hidden` row holding three panes — **240px**
LeftRail (flex:none) / **fluid** CenterChat (flex:1;min-width:0) / **400px** RightPanel (flex:none).
CenterChat + RightPanel are STUB slots (Stage-R siblings B/C replace them behind fixed exports).

## Active (RB frame)

| path | role |
|---|---|
| `WorkbenchPage.tsx` | Route `/workbench`. The outer flex frame (prototype L39) assembling `<LeftRail/> <CenterChat/> <RightPanel/>`. |
| `LeftRail.tsx` | **Real Left Rail 1:1** (prototype L42–100). Exact inline styles/px/hex/font/weight/EN copy; real `projects.list` + `sessions.list` (+ `cost.summary`) substituted into the design's structure. cx logo + daemon dot · project card (active project = most-recent session's project; avatar initials; cost-only sub-line) · + New session (⌘N, inert — no create scope) · session groups TODAY/YESTERDAY/EARLIER · approval banner (hidden, GAP-1) · EN/中 (EN active) · Settings→`/settings`. |
| `CenterChat.tsx` | **STUB** slot. `export function CenterChat()` renders only the center pane container (prototype L103). Sibling B replaces. |
| `RightPanel.tsx` | **STUB** slot. `export function RightPanel()` renders only the 400px right pane container (prototype L1093). Sibling C replaces. |
| `session-groups.ts` | **Pure** helpers (TDD): `groupSessions` (local-day TODAY/YESTERDAY/EARLIER partition, recent-first), `sessionMeta` (HH:MM + `· from schedule`), `projectInitials`. |
| `session-groups.test.ts` | vitest for `session-groups.ts` (10 tests). |

**Data gaps rendered structurally + flagged** (paired stage): GAP-1 approvals banner — no tRPC
approvals scope → conditionally hidden with real empty data (**Stage 5**); GAP-2 `SessionInfo` has
no turns/cost/running fields → session meta is time+kind, no running pulse dot (session-detail
backend, later); GAP-3 `ProjectConduitInfo` has no phase/milestone field → project sub-line is
cost-only (**Stage 6**).

## Legacy (superseded Stage-2 3a — KEPT, not route-reachable; for sibling-C reuse)

`SessionList` · `ChatPlaceholder` · `RightPanelTabs` · `ThreadsPanel` · `MachinesPanel` ·
`useThreadsLiveSync` · `scope.ts`/`scope.test.ts`. These were the token-summary three-pane build
(task 5b0f); WorkbenchPage no longer imports them. They still typecheck (kept so Stage-R sibling C
can salvage the Threads/Tasks/Machines panels + Active/History `scope` when it rebuilds the right
panel 1:1). Remove when sibling C lands.

## Notes

- **No backend change** — existing ui-service contract only (`projects.list`, `sessions.list`,
  `cost.summary`). Web-only.
- **Verified live** (task f528): real dist ui-http-server + real `ProjectStore`/`sessionStore`/
  `getCostSummary` (real ~/.cortex data) serving built `web/dist` behind `x-cortex-token`;
  headless-Chrome CDP (token via `Network.setExtraHTTPHeaders`) at 1440×900 → frame **240/800/400**,
  **759 real sessions** grouped, real project card, stubs mounted, **0 console errors**. Side-by-side
  vs `proto-shots/00-workbench.png` committed at `design/build-shots/f528-leftrail-compare.png`.
