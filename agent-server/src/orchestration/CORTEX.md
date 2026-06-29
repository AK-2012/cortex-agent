Please update me when files in this folder change

orch/ — Orchestration layer. Coordinates platform message routing, per-channel queue, agent lifecycle
and plan approval state. Depends on core / store / events / domain / platform, must not be imported by domain layer.

| filename | role | function |
|---|---|---|
| `conduit-queue.ts` | singleton | per-conduit serial Promise queue (conduitQueues Map + enqueue(), [S6-B]) |
| `superseded-edits.ts` | singleton | Message edit supersede marker (mark/check/clear API, [S6-B]) |
| `interactions/plan-approvals.ts` | singleton | Unified requestId-keyed plan approval state (merges pendingPlans + pendingHookPlans, publishes plan.approved [S6-A]) |
| `busy-tracker.ts` | singleton | activeLlmCount tracking + publish llm.active-count-delta + IPC busy/idle signaling ([S6-C], S13 subscriber-as-source-of-truth) |
| `orchestrator.ts` | orchestration | Two-branch decision tree (thread-match / default), message-router.ts sole routing exit ([S8]) |
| `agent-runner.ts` | orchestration | Plain user-message path: session/status/ledger/callbacks + runConversation (no thread), message-router.ts default branch sole execution path ([S8]) |
| `conversation-runner.ts` | orchestration | runConversation — executes a single plain user turn against the default agent WITHOUT a thread (replaces the legacy default-thread wrapper); register/complete under channel key, executionId-scoped Cancel |
| `bg-continuation.ts` | helper | CC background-task continuation (default ON; opt out via CORTEX_BG_CONTINUATION=0/false): buildContinuationSink (merge follow-up into the same reply), isBgContinuationEnabled / isInteractiveChannel gates. lifecycle.ts holds the status in a "waiting" state when a run_in_background task is pending and seals it on continuation |
| `turn-notify.ts` | helper | Push a NEW message (Slack + Feishu via PlatformAdapter) when a long-running user turn finishes — the sealed "✓ Done" status is an edit and does not notify. Gated by isTurnNotifyEnabled (default ON; opt out CORTEX_TURN_NOTIFY=0/false/off/no), isInteractiveChannel scope, and getTurnNotifyThresholdS (CORTEX_TURN_NOTIFY_THRESHOLD_S, default 60s). Called from lifecycle.ts on success (handleAgentSuccess / finalizeBackgroundContinuation) and on hard error (handleAgentError); never throws |
| `thread-executor.ts` | orchestration | Wraps thread routing (thread-add / thread-continue / thread-start), message-router.ts thread branch sole execution path ([S8]) |
| `dispatch-reconciler.ts` | background | stale dispatch cleanup timer (S13: extracted from entry/app.ts) |
| `thread-callback.ts` | callback | fireThreadCallback / notifyThreadParent / notifyTaskParentThreads / reconcileWaitingTasks / recoverWaitingThreads / registerTaskTreeSubscribers + resumeManagerForQuestion (DR-0016 wake a waiting manager to answer a subtask) — DR-0014 child-completion delivery + resident-manager wake-up (thread children via settle chain, task children via task.completed/task.blocked events) |
| `manager-qa.ts` | up-ask channel | DR-0016: askManager / submitAnswer / getAnswer / tryAnswerFromHuman / buildQuestionNotice / buildOriginSessionNotice — a subtask asks its manager (woken via resumeManagerForQuestion); at the top of the tree (no manager thread) the ORIGIN session — the agent that dispatched the work — is woken as an agent (wakeSession → agentRunner.route) and answers via answer_subtask, only consulting the human (still-armed channelIndex + tryAnswerFromHuman backstop) if it cannot. Central question state is an in-memory Map (synchronous model, no persistence). Driven by the `/webhook/manager-qa` route and the ask_manager/answer_subtask MCP tools |
| `routing/hook-bridge-subscribers.ts` | subscription | ask-user.requested / plan.submitted handler bodies (S13: extracted from entry/app.ts) |
| `status-helpers.ts` | helper | execution / status-message / streaming-VM helpers (migrated from entry/, dep-cruiser cleanup); pure formatting has been sunk to `core/status-format.ts`. `sealThreadStatus` is the single terminal seal for the interactive `!thread` (thread-executor) and background/resume (thread-callback.sealSuspendedStatusMsg) paths — buildThreadSummary text ± sealed action blocks; the dispatch seal `finalizeThreadSuccess` stays separate (domain layer, task-framed durable text) |
