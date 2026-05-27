# ui-service/ — M3 Cortex UI Service

Transport-agnostic facade over domain modules providing `query`, `mutate`, and `subscribe` primitives.
No transport coupling (no ws/http imports). Consumed by M5 TUI dashboard and future web UI.

| filename | role | function |
|---|---|---|
| `types.ts` | types | Result, QueryScope, MutateOp, SubscribeFilter, UiEvent, UiService interface, DTOs |
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
