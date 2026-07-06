# features/thread/ — inline thread card 11a + shared ThreadStepList (design 11a, DR-0018 §6.3 F1)

Stage-3 task 065f (F1). Renders a **real `threads.get` (`ThreadDetail`, B1 task 58f3)** as a
vertical step pipeline: completed/pending steps collapse to one line; only the **active** (running)
step expands its children — machine dispatches (Execute) and/or subthreads (Review) — plus the live
agent flow. Card re-flows live as the thread advances. `ThreadStepList` is the shared primitive that
the Stage-3 F2 thread-detail page (11b / nested 2b) reuses.

| path | role |
|---|---|
| `thread-steps.ts` | **Pure** selectors/formatters (TDD): `selectActiveStep` (the running step), `dispatchesForStep` (join dispatches to a step by `agentSlotId` — the only per-step link in the DTO), `activeStepChildren` (bundle active-step dispatches + thread subthreads + agentFlow; null when terminal), `stepSummaryParts` (collapsed-line chunks: stage · $cost · duration). Framework-free. |
| `thread-steps.test.ts` | vitest unit tests for the pure logic (TDD — written first, 9 tests). |
| `ThreadStepList.tsx` | **Shared presentational primitive**: `{ detail: ThreadDetail }` → vertical `<ol>` of steps; collapsed rows for completed/pending, an expanded block for the active step (agent flow + Dispatches + Subthreads sections). Token-only, no data fetching. `data-step-index`/`data-step-status`/`data-active-step` for E2E. |
| `InlineThreadCard.tsx` | **11a card** (data-bound): `{ threadId }` → `trpc.threads.get` query + `useThreadGetLiveSync` + loading/error states → `Card` header (`StatusPill`·`ID`·template·$cost) + `ThreadStepList`. `data-inline-thread-id` for E2E. |
| `useThreadGetLiveSync.ts` | One SSE subscription on `thread.created/step.started/step.finished/completed/failed` → invalidate `threads.get` for this `threadId` → refetch. Mirrors `features/workbench/useThreadsLiveSync`. |

## Notes

- **Host**: chat (the design's ultimate host for 11a) is Stage 4 — until then `InlineThreadCard`
  mounts in the **workbench Threads tab** via row expand (`features/workbench/ThreadsPanel.tsx`).
- **No backend change**: consumes only the existing `threads.get` scope (B1) + `subscribe`.
- **Execute/Review = data-driven, not stage-name-string-matched**: the active step surfaces whatever
  children the DTO carries (dispatches when it dispatched to a machine, subthreads when it spawned
  children). `ThreadChildNode` has no owning-step field, so subthreads are attributed at thread level
  under the active step.
- Live re-flow needs a **daemon-routed** thread transition (bus events are in-process), same caveat
  as the tasks/threads-list slices.
