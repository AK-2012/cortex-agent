# ui-service/ — M3 Cortex UI Service

Transport-agnostic facade over domain modules providing `query`, `mutate`, and `subscribe` primitives.
This module is `@trpc`-free (facade only): the tRPC binding (`trpc.ts` + `app-router.ts`) and the
HTTP/SSE transport-host moved to the optional `@cortex-agent/ui-server` package in Stage 9 §9.1, so
Slack/TUI-only core carries no @trpc weight. Consumed directly by the M5 TUI dashboard (createUiService),
and — via the AppRouter that ui-server builds over this facade — by the Web UI.

| filename | role | function |
|---|---|---|
| `types.ts` | types | Result, QueryScope, MutateOp, SubscribeFilter, UiEvent, UiService interface, DTOs |
| `input-schemas.ts` | schemas | Source-of-truth zod input schema per QueryScope / MutateOp + `queryInputSchemas` / `mutateInputSchemas` keyed maps. Consumed by `@cortex-agent/ui-server`'s AppRouter (deep-imports the built dist) + re-exported (runtime) by `@cortex-agent/ui-contract` for the browser. Kept here (not in ui-contract) so the router can consume it without agent-server importing ui-contract, which would close a workspace build cycle |
| `ui-service.ts` | facade | createUiService(deps) — routes scope/op strings to per-module handlers; `subscribeExecutionLog(executionId)` (B2-C) resolves the run's log location, ref-counts the tailer, streams `execution.log` over the bounded queue |
| `subscribe.ts` | subscribe | EventBus → AsyncIterable&lt;UiEvent&gt; with bounded queue (cap 256, drop-oldest + synthetic `ui-subscribe.dropped`); post-filters by projectId, (B2-C) executionId, and (S4) sessionId — scopes `session.message` to one session (no cross-session leak) |
| `index.ts` | barrel | re-exports createUiService and public types |
| `query/projects.ts` | query | projects.list handler |
| `query/sessions.ts` | query | sessions.list + sessions.transcript (S4 chat: wraps `conversationHistory.getHistory`, groups user/assistant/tool events into turns) handlers |
| `query/threads.ts` | query | threads.list + threads.get (detail: steps/agent-flow/dispatches/child-tree≤5/artifacts, DR-0018 §6.3 B1) handlers |
| `query/tasks.ts` | query | tasks.list handler |
| `query/schedules.ts` | query | schedules.list handler |
| `query/executions.ts` | query | executions.list + executions.get handlers |
| `query/memory.ts` | query | memory.tree (project memory tree: top-level files + memory dirs w/ entry counts) + memory.file (raw file content + metadata) handlers — read-only, path-restricted to the project root; rejects `..` traversal / absolute paths / symlink escape |
| `query/approvals.ts` | query | approvals.list handler + pure `parseApprovals` (PENDING_APPROVALS.md → ApprovalInfo[], missing fields null, status filter); path via `deps.approvalsPath` |
| `query/cost.ts` | query | cost.summary handler |
| `query/config.ts` | query | config.get handler — redacted snapshot of `~/.cortex/config` (budget/profiles/machines/mcp/thread-templates/hooks/.env) for the settings panel (Stage 7); pure `readConfigSnapshot(configDir, hooksDir)` + thin handler. SECURITY: `.env` values + machine `ssh` are never returned, only redacted markers |
| `mutate/projects.ts` | mutate | projects.create handler (reuses ProjectStore.createProject; maps invalid-name/already-exists → Err) |
| `mutate/sessions.ts` | mutate | sessions.send handler (S4 chat: resolve session→channel, inject a genuine user turn via the injected `sendSessionMessage` dep; fire-and-forget `{accepted:true}` — assistant output returns over the `session.message` stream, not this return) |
| `mutate/threads.ts` | mutate | threads.cancel handler |
| `mutate/executions.ts` | mutate | executions.cancel handler |
| `mutate/schedules.ts` | mutate | schedules.{pause,resume,remove,add} handlers (add: reuses injected scheduler.add + schedule-repo backfill of target/fallback, returns the created ScheduleInfo) |
| `mutate/tasks.ts` | mutate | tasks.{claim,unclaim,complete,block,unblock} handlers |
| `mutate/config.ts` | mutate | config.set handler — safe atomic write of the whitelisted `budget` section only (Stage 7); pure `writeBudget(configDir, value)` (zod-validate + atomicWrite) + thin handler (safeParse→invalid-args, IO→internal). Non-budget sections rejected |
| `mutate/approvals.ts` | mutate | approvals.{approve,reject} handlers + pure `applyApprovalDecision` (flips only the target entry's Status line w/ timestamp + reject feedback; idempotent; unknown id → not-found; NO underlying execution) |
