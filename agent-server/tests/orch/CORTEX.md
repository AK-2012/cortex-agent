Please update me when files in this folder change

tests/orch/ — Regression tests for the orch/ orchestration layer.
Covers API and event publication contracts for running-executions, channel-queue, superseded-edits, busy-tracker, and interactions/plan-approvals singletons (running-executions is in core/, tests are here, corresponding to Phase 1 Step 1).

| filename | role | function |
|---|---|---|
| `running-executions.test.ts` | Test | RunningExecutions three-index consistency, kill chain, event publication (Phase 1 Step 1) |
| `channel-queue.test.ts` | Test | conduitQueues Map + enqueue() serialization and auto-cleanup (S6-B) |
| `superseded-edits.test.ts` | Test | supersededEdits mark/check/clear API (S6-B) |
| `plan-approvals.test.ts` | Test | PlanApprovals register/lookup/resolve/reject/clearByChannel + plan.approved event (S6-A) |
| `busy-tracker.test.ts` | Test | BusyTracker +1/-1 publish+IPC, multi-publisher aggregate, re-entrant safety (S6-C) |
| `orchestrator.test.ts` | Test | Orchestrator two-branch decision tree: threadAddMatch / isActiveThread / threadStartMatch -> threadExecutor; no match -> agentRunner (S8-A) |
| `agent-runner.test.ts` | Test | AgentRunner hourglass reaction, +1/-1 trackPendingTask, enqueue channel, resolveDefaultAgent pure function, singleton contract (S8-A) |
| `thread-executor.test.ts` | Test | ThreadExecutor +1/-1 trackPendingTask, enqueue channel, hourglass reaction, singleton contract (S8-A) |
| `thread-detached.test.ts` | Test | runThreadDetached holds the busy gate for the whole fire-and-forget thread (sync +1, -1 in finally on success/reject, balanced) — regression for restart killing MCP `thread_start` background threads |
| `ask-user-question-pi.test.ts` | Test | PI ask-user-question branch: tryResolveHook extension_ui_response routing, multi-question join, incomplete does not resolve early (S3) |
