# ui-service/ — M3 Cortex UI Service

Transport-agnostic facade over domain modules providing `query`, `mutate`, and `subscribe` primitives.
No transport coupling (no ws/http imports; the tRPC router uses @trpc/server CORE only — HTTP/SSE adapters
live in the transport-host). Consumed by M5 TUI dashboard and the Web UI (tRPC AppRouter below).

| filename | role | function |
|---|---|---|
| `types.ts` | types | Result, QueryScope, MutateOp, SubscribeFilter, UiEvent, UiService interface, DTOs |
| `input-schemas.ts` | schemas | Source-of-truth zod input schema per QueryScope / MutateOp + `queryInputSchemas` / `mutateInputSchemas` keyed maps. Consumed by the AppRouter; re-exported (runtime) by `@cortex-agent/ui-contract` for the browser. Kept here (not in ui-contract) so the router can consume it without agent-server importing ui-contract, which would close a workspace build cycle |
| `trpc.ts` | tRPC init | Shared `initTRPC.create()` — exports `router` / `publicProcedure` / `createCallerFactory` (transport-agnostic) |
| `app-router.ts` | tRPC router | `createAppRouter(uiService): AppRouter` — mirrors the full contract (12 query + 11 mutation + 2 subscriptions: generic `subscribe` + `executions.log`; `subscribeFilterInput` carries `sessionId` for the S4 `session.message` stream) over the injected UiService; unwraps `Result`, maps `Err`→`TRPCError`. `AppRouter` type re-exported by `@cortex-agent/ui-contract` |
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
| `query/cost.ts` | query | cost.summary handler |
| `mutate/sessions.ts` | mutate | sessions.send handler (S4 chat: resolve session→channel, inject a genuine user turn via the injected `sendSessionMessage` dep; fire-and-forget `{accepted:true}` — assistant output returns over the `session.message` stream, not this return) |
| `mutate/threads.ts` | mutate | threads.cancel handler |
| `mutate/executions.ts` | mutate | executions.cancel handler |
| `mutate/schedules.ts` | mutate | schedules.{pause,resume,remove} handlers |
| `mutate/tasks.ts` | mutate | tasks.{claim,unclaim,complete,block,unblock} handlers |
