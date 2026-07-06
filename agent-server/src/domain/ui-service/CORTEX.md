# ui-service/ — M3 Cortex UI Service

Transport-agnostic facade over domain modules providing `query`, `mutate`, and `subscribe` primitives.
No transport coupling (no ws/http imports; the tRPC router uses @trpc/server CORE only — HTTP/SSE adapters
live in the transport-host). Consumed by M5 TUI dashboard and the Web UI (tRPC AppRouter below).

| filename | role | function |
|---|---|---|
| `types.ts` | types | Result, QueryScope, MutateOp, SubscribeFilter, UiEvent, UiService interface, DTOs |
| `input-schemas.ts` | schemas | Source-of-truth zod input schema per QueryScope / MutateOp + `queryInputSchemas` / `mutateInputSchemas` keyed maps. Consumed by the AppRouter; re-exported (runtime) by `@cortex-agent/ui-contract` for the browser. Kept here (not in ui-contract) so the router can consume it without agent-server importing ui-contract, which would close a workspace build cycle |
| `trpc.ts` | tRPC init | Shared `initTRPC.create()` — exports `router` / `publicProcedure` / `createCallerFactory` (transport-agnostic) |
| `app-router.ts` | tRPC router | `createAppRouter(uiService): AppRouter` — mirrors the full contract (7 query + 10 mutation + 1 subscription) over the injected UiService; unwraps `Result`, maps `Err`→`TRPCError`. `AppRouter` type re-exported by `@cortex-agent/ui-contract` |
| `ui-service.ts` | facade | createUiService(deps) — routes scope/op strings to per-module handlers |
| `subscribe.ts` | subscribe | EventBus → AsyncIterable&lt;UiEvent&gt; with bounded queue |
| `index.ts` | barrel | re-exports createUiService and public types |
| `query/projects.ts` | query | projects.list handler |
| `query/sessions.ts` | query | sessions.list handler |
| `query/threads.ts` | query | threads.list handler |
| `query/tasks.ts` | query | tasks.list handler |
| `query/schedules.ts` | query | schedules.list handler |
| `query/executions.ts` | query | executions.list handler |
| `query/cost.ts` | query | cost.summary handler |
| `mutate/threads.ts` | mutate | threads.cancel handler |
| `mutate/executions.ts` | mutate | executions.cancel handler |
| `mutate/schedules.ts` | mutate | schedules.{pause,resume,remove} handlers |
| `mutate/tasks.ts` | mutate | tasks.{claim,unclaim,complete,block,unblock} handlers |
