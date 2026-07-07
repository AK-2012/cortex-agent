// Compile-time drift guard (no runtime effect). Asserts that each zod input
// schema's inferred type is mutually assignable to the corresponding
// QueryParamMap / MutateArgsMap entry in agent-server. If the backend contract
// changes (a field added/removed/retyped) and a schema is not updated in
// lock-step, `pnpm typecheck` fails here. This is the anti-drift test for the
// contract package.

import type { z } from 'zod';
import type { QueryParamMap, MutateArgsMap, ExecutionsLogParams } from './dto.js';
import type {
  projectsListInput,
  sessionsListInput,
  threadsListInput,
  threadsGetInput,
  tasksListInput,
  schedulesListInput,
  executionsListInput,
  executionsGetInput,
  memoryTreeInput,
  memoryFileInput,
  costSummaryInput,
  threadsCancelInput,
  executionsCancelInput,
  scheduleActionInput,
  taskActionInput,
  taskCompleteInput,
  taskBlockInput,
  executionsLogInput,
  configGetInput,
  configSetInput,
} from './schemas.js';

// Mutual assignability: true only when A and B are structurally equivalent.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type QueryParity<S extends keyof QueryParamMap, Schema extends z.ZodType> = Exact<
  z.infer<Schema>,
  QueryParamMap[S]
>;
type MutateParity<O extends keyof MutateArgsMap, Schema extends z.ZodType> = Exact<
  z.infer<Schema>,
  MutateArgsMap[O]
>;

// ── Query scopes ──────────────────────────────────────────────────
const _projectsList: QueryParity<'projects.list', typeof projectsListInput> = true;
const _sessionsList: QueryParity<'sessions.list', typeof sessionsListInput> = true;
const _threadsList: QueryParity<'threads.list', typeof threadsListInput> = true;
const _threadsGet: QueryParity<'threads.get', typeof threadsGetInput> = true;
const _tasksList: QueryParity<'tasks.list', typeof tasksListInput> = true;
const _schedulesList: QueryParity<'schedules.list', typeof schedulesListInput> = true;
const _executionsList: QueryParity<'executions.list', typeof executionsListInput> = true;
const _executionsGet: QueryParity<'executions.get', typeof executionsGetInput> = true;
const _memoryTree: QueryParity<'memory.tree', typeof memoryTreeInput> = true;
const _memoryFile: QueryParity<'memory.file', typeof memoryFileInput> = true;
const _costSummary: QueryParity<'cost.summary', typeof costSummaryInput> = true;
const _configGet: QueryParity<'config.get', typeof configGetInput> = true;

// ── Mutate ops ────────────────────────────────────────────────────
const _threadsCancel: MutateParity<'threads.cancel', typeof threadsCancelInput> = true;
const _executionsCancel: MutateParity<'executions.cancel', typeof executionsCancelInput> = true;
const _schedulesPause: MutateParity<'schedules.pause', typeof scheduleActionInput> = true;
const _schedulesResume: MutateParity<'schedules.resume', typeof scheduleActionInput> = true;
const _schedulesRemove: MutateParity<'schedules.remove', typeof scheduleActionInput> = true;
const _tasksClaim: MutateParity<'tasks.claim', typeof taskActionInput> = true;
const _tasksUnclaim: MutateParity<'tasks.unclaim', typeof taskActionInput> = true;
const _tasksComplete: MutateParity<'tasks.complete', typeof taskCompleteInput> = true;
const _tasksBlock: MutateParity<'tasks.block', typeof taskBlockInput> = true;
const _tasksUnblock: MutateParity<'tasks.unblock', typeof taskActionInput> = true;
const _configSet: MutateParity<'config.set', typeof configSetInput> = true;

// ── Subscriptions ─────────────────────────────────────────────────
// Subscriptions have no query/mutate map entry; guard the input schema against its backend
// param type directly (B2-C executions.log).
const _executionsLog: Exact<z.infer<typeof executionsLogInput>, ExecutionsLogParams> = true;

// Reference the guards so noUnusedLocals (if enabled) stays quiet and the
// checks are not tree-shaken away by the type checker.
export const _contractParityChecked = [
  _projectsList, _sessionsList, _threadsList, _threadsGet, _tasksList, _schedulesList,
  _executionsList, _executionsGet, _memoryTree, _memoryFile, _costSummary, _configGet, _threadsCancel, _executionsCancel,
  _schedulesPause, _schedulesResume, _schedulesRemove, _tasksClaim,
  _tasksUnclaim, _tasksComplete, _tasksBlock, _tasksUnblock, _configSet, _executionsLog,
] as const;
