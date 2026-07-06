// Re-exported ui-service contract types (zero-duplication, DR-0018 §2).
// Source of truth: agent-server/src/domain/ui-service/types.ts. We import the
// BUILT declarations so the frontend shares one definition and cannot drift.
// All re-exports are type-only → fully erased at build, no runtime coupling to
// agent-server (the frontend never bundles backend code).

export type {
  // Result envelope
  Result,
  Ok,
  Err,
  // Scope / op unions
  QueryScope,
  MutateOp,
  // Subscribe
  SubscribeFilter,
  UiEvent,
  // Query params
  SessionsListParams,
  ThreadsListParams,
  TasksListParams,
  SchedulesListParams,
  ExecutionsListParams,
  CostSummaryParams,
  // Mutate args
  ThreadsCancelArgs,
  ExecutionsCancelArgs,
  ScheduleActionArgs,
  TaskActionArgs,
  TaskCompleteArgs,
  TaskBlockArgs,
  // Output DTOs
  ProjectConduitInfo,
  SessionInfo,
  ThreadInfo,
  TaskInfo,
  ScheduleInfo,
  ExecutionInfo,
  ThreadsCancelReturn,
  ExecutionsCancelReturn,
  // Mapped contract
  QueryParamMap,
  QueryReturnMap,
  MutateArgsMap,
  MutateReturnMap,
  QueryParams,
  QueryReturn,
  MutateArgs,
  MutateReturn,
} from '@cortex-agent/server/dist/domain/ui-service/types.js';

// CostSummary is the cost.summary return DTO; it is defined in the costs domain
// and pulled into the ui-service contract there, not re-exported by the barrel.
export type { CostSummary } from '@cortex-agent/server/dist/domain/costs/cost-tracker.js';
