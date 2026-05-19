Please update me when files in this folder change

orch/ — Orchestration layer. Coordinates platform message routing, per-channel queue, agent lifecycle
and plan approval state. Depends on core / store / events / domain / platform, must not be imported by domain layer.

| filename | role | function |
|---|---|---|
| `channel-queue.ts` | singleton | per-channel serial Promise queue (channelQueues Map + enqueue(), [S6-B]) |
| `superseded-edits.ts` | singleton | Message edit supersede marker (mark/check/clear API, [S6-B]) |
| `interactions/plan-approvals.ts` | singleton | Unified requestId-keyed plan approval state (merges pendingPlans + pendingHookPlans, publishes plan.approved [S6-A]) |
| `busy-tracker.ts` | singleton | activeLlmCount tracking + publish llm.active-count-delta + IPC busy/idle signaling ([S6-C], S13 subscriber-as-source-of-truth) |
| `orchestrator.ts` | orchestration | Two-branch decision tree (thread-match / default), message-router.ts sole routing exit ([S8]) |
| `agent-runner.ts` | orchestration | Wraps mode-manager.runAgent + lifecycle (default-agent path), message-router.ts default branch sole execution path ([S8]) |
| `thread-executor.ts` | orchestration | Wraps thread routing (thread-add / thread-continue / thread-start), message-router.ts thread branch sole execution path ([S8]) |
| `dispatch-reconciler.ts` | background | stale dispatch cleanup timer (S13: extracted from entry/app.ts) |
| `routing/hook-bridge-subscribers.ts` | subscription | ask-user.requested / plan.submitted handler bodies (S13: extracted from entry/app.ts) |
| `status-helpers.ts` | helper | execution / status-message / streaming-VM helpers (migrated from entry/, dep-cruiser cleanup); pure formatting has been sunk to `core/status-format.ts` |
