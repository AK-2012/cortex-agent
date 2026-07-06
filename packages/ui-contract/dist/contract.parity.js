// Compile-time drift guard (no runtime effect). Asserts that each zod input
// schema's inferred type is mutually assignable to the corresponding
// QueryParamMap / MutateArgsMap entry in agent-server. If the backend contract
// changes (a field added/removed/retyped) and a schema is not updated in
// lock-step, `pnpm typecheck` fails here. This is the anti-drift test for the
// contract package.
// ── Query scopes ──────────────────────────────────────────────────
const _projectsList = true;
const _sessionsList = true;
const _threadsList = true;
const _tasksList = true;
const _schedulesList = true;
const _executionsList = true;
const _costSummary = true;
// ── Mutate ops ────────────────────────────────────────────────────
const _threadsCancel = true;
const _executionsCancel = true;
const _schedulesPause = true;
const _schedulesResume = true;
const _schedulesRemove = true;
const _tasksClaim = true;
const _tasksUnclaim = true;
const _tasksComplete = true;
const _tasksBlock = true;
const _tasksUnblock = true;
// Reference the guards so noUnusedLocals (if enabled) stays quiet and the
// checks are not tree-shaken away by the type checker.
export const _contractParityChecked = [
    _projectsList, _sessionsList, _threadsList, _tasksList, _schedulesList,
    _executionsList, _costSummary, _threadsCancel, _executionsCancel,
    _schedulesPause, _schedulesResume, _schedulesRemove, _tasksClaim,
    _tasksUnclaim, _tasksComplete, _tasksBlock, _tasksUnblock,
];
