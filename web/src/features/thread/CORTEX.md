# features/thread/ — inline thread card 11a (F1) + thread detail 11b + nested 2b (F2)

Stage-3 tasks 065f (F1) + 0f25 (F2). Renders a **real `threads.get` (`ThreadDetail`, B1 task 58f3)** as a
vertical step pipeline: completed/pending steps collapse to one line; only the **active** (running)
step expands its children — machine dispatches (Execute) and/or subthreads (Review) — plus the live
agent flow. `ThreadStepList` is the shared primitive; the F2 detail page (11b) reuses it and layers
the 2b three-state nested-thread panel into the active step's SUB-THREADS region.

| path | role |
|---|---|
| `thread-steps.ts` | **Pure** selectors/formatters (TDD): `selectActiveStep` (the running step), `dispatchesForStep` (join dispatches to a step by `agentSlotId` — the only per-step link in the DTO), `activeStepChildren` (bundle active-step dispatches + thread subthreads + agentFlow; null when terminal), `stepSummaryParts` (collapsed-line chunks: stage · $cost · duration). Framework-free. |
| `thread-steps.test.ts` | vitest unit tests for the pure logic (TDD — written first, 10 tests). |
| `nested-threads.ts` | **Pure** (F2, TDD): `nodeLevel` (child `depth`→display level, root=1 / direct child=2), `isMaxLevel` (level≥5 or `truncated`), `countDescendants`, `treeMaxLevel` (deepest level, clamped to `MAX_LEVEL`=5), `flattenOutline` (pre-order one-row-per-thread for the Outline state), `INLINE_MAX_VISIBLE_LEVEL`=3. |
| `nested-threads.test.ts` | vitest unit tests for the pure tree logic (TDD — written first, 14 tests). |
| `ThreadStepList.tsx` | **Shared presentational primitive**: `{ detail, renderSubthreads? }` → vertical `<ol>` of steps; collapsed rows for completed/pending, an expanded block for the active step (agent flow + Dispatches + Subthreads). The optional `renderSubthreads` slot (F2) replaces the default flat subthread list — 11a leaves it undefined (unchanged); 11b passes `NestedThreadsPanel`. `data-step-index`/`data-step-status`/`data-active-step` for E2E. |
| `InlineThreadCard.tsx` | **11a card** (data-bound): `{ threadId }` → `trpc.threads.get` query + `useThreadGetLiveSync` + loading/error states → `Card` header (`StatusPill`·`ID`·template·$cost) + `ThreadStepList`. `data-inline-thread-id` for E2E. |
| `ThreadDetailPage.tsx` | **11b page** (F2, route `/threads/:threadId`): `threads.get` + `useThreadGetLiveSync` → header (`StatusPill`·`ID`·template·$cost·depth `x/5` meter·ancestor breadcrumb) + two columns: left `ThreadStepList` (single-column pipeline; `renderSubthreads`→`NestedThreadsPanel`), right persistent `ThreadArtifactsPanel`. Breadcrumb trail rides in React Router `location.state.trail`. `data-thread-detail`/`data-pipeline`/`data-depth-levels` for E2E. |
| `NestedThreadsPanel.tsx` | **2b nested panel** (F2): the recursive `ThreadChildNode` subtree with three states — **A inline** (Tree: expand two levels in place, constant 14px indent, L3+ collapse to drill rows) / **C outline** (whole subtree flattened, one row per thread) via a Tree/Outline toggle, and **B drill-down** (`open ›` → `navigate('/threads/:id', { state:{ trail } })` re-roots `threads.get` on that child). `data-nested-panel`/`data-nested-thread-id`/`data-drill-thread-id`/`data-outline-thread-id`/`data-level` for E2E. |
| `ThreadArtifactsPanel.tsx` | **11b right rail** (F2): thread-level artifact **refs** (`ThreadArtifactRefs`: artifact/workspace path, task) persistent + `live` badge. Document content viewer + per-step write-trail deferred to Stage 6 (fs-read scope, plan §2.1). `data-thread-artifacts` for E2E. |
| `useThreadGetLiveSync.ts` | One SSE subscription on `thread.created/step.started/step.finished/completed/failed` → invalidate `threads.get` for this `threadId` → refetch. Mirrors `features/workbench/useThreadsLiveSync`. |
| `thread-render.test.tsx` | `react-dom/server` render checks (F2) for `ThreadArtifactsPanel`/`ThreadStepList` slot/`NestedThreadsPanel` — assert the real components' rendered markup (browser E2E is environment-blocked; see Notes). |

## Notes

- **Host**: chat (the design's ultimate host for 11a) is Stage 4 — until then `InlineThreadCard`
  mounts in the **workbench Threads tab** via row expand (`features/workbench/ThreadsPanel.tsx`).
  The **11b detail page** is reached via that tab's `open ›` link and the ⌘K palette (Thread items
  now route to `/threads/:id`), and internally via 2b drill-down.
- **No backend change**: consumes only the existing `threads.get` scope (B1) + `subscribe`.
- **Execute/Review = data-driven, not stage-name-string-matched**: the active step surfaces whatever
  children the DTO carries (dispatches when it dispatched to a machine, subthreads when it spawned
  children). `ThreadChildNode` has no owning-step field, so subthreads are attributed at thread level
  under the active step.
- Live re-flow needs a **daemon-routed** thread transition (bus events are in-process), same caveat
  as the tasks/threads-list slices.
- **Depth model / B1 off-by-one**: B1 caps its child tree at `depth` 0..4 (up to 5 descendant
  levels), so with `level = depth+2` a node can reach L6 while the design's model is ≤5 total
  (root=L1). The UI **clamps**: `treeMaxLevel`/the `x/5` meter cap at `MAX_LEVEL`=5 and anything at
  L5+ or `truncated` is marked **`max`** (never shows a numeric L6). Reconciling the actual cap
  (MAX_CHILD_DEPTH 4→3) is a B1 concern, not F2.
- **Drill-down re-roots**: descending into a child calls `threads.get` for that child (a fresh ≤5
  window), so arbitrarily deep / `truncated` trees stay navigable without an unbounded payload.
- **Verification honesty**: headless-Chrome E2E is blocked in this environment (the SPA's persistent
  SSE subscription defeats `--dump-dom`/virtual-time, and Chrome's remote-debugging server is killed
  by the sandbox). F2 is therefore verified by (a) a **real** ui-http-server + `createUiService` +
  B1 handler live check (token gate 401/200, real `ThreadDetail` with a ≤5-level `truncated` tree,
  drill re-root) and (b) `react-dom/server` render tests of the real components — not a browser click-through.
