// input:  nothing (leaf module)
// output: UiService types — Result, QueryScope, MutateOp, DTOs, UiService interface, UiServiceDeps
// pos:    leaf types module, depends only on domain types pulled in by query/mutate handlers
// >>> If I am updated, update CORTEX.md and the parent folder's CORTEX.md <<<

import type { Project } from '@domain/projects/index.js';
import type { CostSummary } from '@domain/costs/cost-tracker.js';
import type { EventBus } from '@events/index.js';
import type { RunningExecutions } from '@core/running-executions.js';
import type { PlatformAdapter } from '@platform/adapter.js';
import type { Session } from '@store/session-registry-repo.js';
import type { ScheduleTask } from '@store/schedule-repo.js';
import type { LogLocation } from '@domain/executions/log-tailer.js';

// ── Result ────────────────────────────────────────────────────────

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; code: string; message: string };
export type Result<T> = Ok<T> | Err;

// ── Query scopes ──────────────────────────────────────────────────

export type QueryScope =
  | 'projects.list'
  | 'sessions.list'
  | 'threads.list'
  | 'threads.get'
  | 'tasks.list'
  | 'schedules.list'
  | 'executions.list'
  | 'executions.get'
  | 'memory.tree'
  | 'memory.file'
  | 'cost.summary'
  | 'config.get';

// ── Mutate ops ────────────────────────────────────────────────────

export type MutateOp =
  | 'threads.cancel'
  | 'executions.cancel'
  | 'schedules.pause'
  | 'schedules.resume'
  | 'schedules.remove'
  | 'tasks.claim'
  | 'tasks.unclaim'
  | 'tasks.complete'
  | 'tasks.block'
  | 'tasks.unblock'
  | 'config.set';

// ── Subscribe ─────────────────────────────────────────────────────

export interface SubscribeFilter {
  events: string[];
  projectId?: string | null;
  /** Scope `execution.log` events to a single execution (B2-C live log stream). */
  executionId?: string | null;
}

export interface UiEvent {
  type: string;
  ts: string;
  payload: unknown;
}

/** Input for the `executions.log` subscription (B2-C). Parity-guarded in @cortex-agent/ui-contract. */
export interface ExecutionsLogParams {
  executionId: string;
}

// ── Query params / return types ───────────────────────────────────

export interface SessionsListParams {
  projectId?: string;
  resumable?: boolean;
}

export interface ThreadsListParams {
  projectId?: string;
  status?: string[];
}

export interface ThreadsGetParams {
  threadId: string;
}

export interface TasksListParams {
  projectId?: string;
  status?: 'open' | 'done';
  actionable?: boolean;
}

export interface SchedulesListParams {
  projectId?: string;
  paused?: boolean;
}

export interface ExecutionsListParams {
  status?: string[];
  limit?: number;
}

export interface ExecutionsGetParams {
  executionId: string;
}

export interface MemoryTreeParams {
  projectId: string;
}

export interface MemoryFileParams {
  projectId: string;
  /** Path relative to the project root. Absolute paths / `..` traversal / symlink escape are rejected. */
  path: string;
}

export interface CostSummaryParams {
  projectId?: string | null;
}

export type ConfigGetParams = Record<string, never>;

// ── Mutate args ───────────────────────────────────────────────────

export interface ThreadsCancelArgs {
  threadId: string;
}

export interface ExecutionsCancelArgs {
  executionId: string;
}

export interface ScheduleActionArgs {
  scheduleId: string;
}

export interface TaskActionArgs {
  projectId: string;
  taskId: string;
}

export interface TaskCompleteArgs extends TaskActionArgs {
  note?: string;
}

export interface TaskBlockArgs extends TaskActionArgs {
  reason: string;
}

// The only safely-writable config section exposed by config.set (Stage 7). Other sections are
// rejected by both the zod schema and the handler until they get their own validated write path.
export interface BudgetValue {
  daily_usd: number;
  monthly_usd: number;
}

export interface ConfigSetArgs {
  section: 'budget';
  value: BudgetValue;
}

// ── Query return types (DTOs) ─────────────────────────────────────

export interface ProjectConduitInfo {
  id: string;
  kind: 'research' | 'general';
  contextDir: string;
  hasMission: boolean;
  conduits: Record<string, string>;
}

export interface SessionInfo {
  sessionId: string;
  name: string;
  projectId: string;
  backend: string;
  kind: 'local' | 'scheduled';
  createdAt: string;
  lastUsedAt: string;
  resumable: boolean;
  label: string | null;
}

export interface ThreadInfo {
  id: string;
  templateName: string;
  currentStep: { index: number; name: string } | null;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'aborted';
  projectId: string;
  createdAt: string;
  updatedAt: string;
  totalSteps: number;
  artifactPath: string | null;
}

// ── threads.get detail DTO (DR-0018 §6.3 B1) ─────────────────────

export interface ThreadStepDetail {
  stepIndex: number;
  agentSlotId: string;
  stage: string | null;
  status: 'completed' | 'running' | 'pending';
  executionId: string | null;
  sessionId: string | null;
  sessionName: string | null;
  costUsd: number | null;
  numTurns: number | null;
  durationS: number | null;
  startedAt: string | null;
  endedAt: string | null;
  outputSummary: string | null;
}

export interface ThreadAgentFlow {
  slotId: string;
  profile: string;
  status: 'idle' | 'running' | 'completed';
  stage: string | null;
  sessionId: string | null;
  sessionName: string | null;
  lastOutput: string | null;
}

export interface ThreadDispatchInfo {
  executionId: string;
  status: string;
  machine: string | null;
  type: 'local' | 'dispatch';
  agentSlotId: string | null;
  taskId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  cost: number | null;
}

export interface ThreadChildNode {
  id: string;
  templateName: string | null;
  status: ThreadInfo['status'];
  activeAgent: string | null;
  costUsd: number;
  depth: number;
  createdAt: string;
  taskId: string | null;
  children: ThreadChildNode[];
  truncated: boolean;
}

export interface ThreadArtifactRefs {
  artifactPath: string | null;
  workspacePath: string | null;
  taskId: string | null;
  taskProject: string | null;
}

export interface ThreadDetail {
  id: string;
  templateName: string;
  currentStep: { index: number; name: string } | null;
  status: ThreadInfo['status'];
  projectId: string;
  createdAt: string;
  updatedAt: string;
  totalSteps: number;
  artifactPath: string | null;
  endedAt: string | null;
  error: string | null;
  abortReason: string | null;
  activeAgent: string | null;
  activeStage: string | null;
  totalCostUsd: number;
  steps: ThreadStepDetail[];
  agentFlow: ThreadAgentFlow | null;
  dispatches: ThreadDispatchInfo[];
  children: ThreadChildNode[];
  artifacts: ThreadArtifactRefs;
}

export interface TaskInfo {
  id: string;
  text: string;
  project: string;
  status: 'open' | 'done';
  priority: 'high' | 'medium' | 'low';
  actionable: boolean;
  claimedBy: string | null;
  blockedBy: string | null;
  dependsOn: string[];
  plan: string | null;
  template: string;
}

export interface ScheduleInfo {
  id: string;
  type: 'interval' | 'daily' | 'weekly' | 'once';
  message: string;
  projectId: string;
  nextRun: string | null;
  lastRun: string | null;
  paused: boolean;
  pausedBy: string | null;
}

export interface ExecutionInfo {
  id: string;
  type: 'local' | 'dispatch';
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'stale';
  taskId: string | null;
  sessionId: string | null;
  projectId: string | null;
  machine: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  cost: number | null;
}

// Full single-execution detail for the execution detail screen (F3/8b right pane).
// Superset of ExecutionInfo's identifying fields plus nested lifecycle / dispatch /
// metrics / text. `gpu` is the real per-execution GPU captured by the cortex-run watcher
// and delivered via task-callback (DR-0018 §6.3 B2-followup); null when unknown / not captured
// (e.g. `--gpu none`, nvidia-smi unavailable, or a non-task-linked run).
export interface ExecutionDetailInfo {
  id: string;
  type: 'local' | 'dispatch';
  kind: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'stale';
  projectId: string | null;
  sessionId: string | null;
  threadId: string | null;
  runtime: { startedAt: string; updatedAt: string; endedAt: string | null };
  dispatch: {
    taskId: string | null;
    machine: string | null;
    pid: string | null;
    tmuxName: string | null;
    sessionName: string | null;
    scheduleTaskId: string | null;
    /** cortex-run `--name`; non-null ⇒ a live `execution.log` stream is subscribable (B2-C 8b). */
    runName: string | null;
  } | null;
  metrics: { costUsd: number | null; numTurns: number | null; durationS: number | null };
  gpu: { indices: number[]; memoryMb: number | null } | null;
  text: { label: string | null; finalOutput: string | null; error: string | null };
}

// ── config.get snapshot DTO (Stage 7 settings 12a–g) ──────────────
// Redacted read of ~/.cortex/config for the settings panel. Every field is null / [] when its
// source file is absent. SECURITY INVARIANT: `.env` values are NEVER returned — only the key,
// a present flag, and a fixed mask string. `machines[].ssh` is a presence flag, not the raw
// user@host string. No secret / credential ever appears in this DTO.

export interface ConfigBudget {
  daily_usd: number | null;
  monthly_usd: number | null;
}

export interface ConfigProfileEntry {
  name: string;
  model: string | null;
  backend: string | null;
  mode: string | null;
}

export interface ConfigProfiles {
  defaultProfile: string | null;
  profiles: ConfigProfileEntry[];
}

export interface ConfigMachine {
  name: string;
  cortexPath: string | null;
  gpuCount: number | null;
  ssh: boolean;
  win: boolean;
}

export interface ConfigMcp {
  servers: string[];
}

export interface ConfigThreadTemplates {
  agents: string[];
  templates: string[];
  shells: string[];
}

export interface ConfigEnvEntry {
  key: string;
  present: boolean;
  masked: string;
}

export interface ConfigSnapshot {
  budget: ConfigBudget | null;
  profiles: ConfigProfiles | null;
  machines: ConfigMachine[];
  mcp: ConfigMcp | null;
  threadTemplates: ConfigThreadTemplates;
  hooks: string[];
  env: ConfigEnvEntry[];
}

// ── memory read-only fs DTOs (DR-0018 §6 Stage-6 memory viewer 7b) ─────────
// A project's memory tree: top-level files + memory dirs with entry counts. Read-only;
// the underlying handler restricts all paths to the project root under PROJECTS_DIR.

export interface MemoryFileEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface MemoryDirEntry {
  name: string;
  /** Number of `*.md` entry files, excluding the auto-generated `index.md` and `CORTEX.md`. */
  entryCount: number;
}

export interface MemoryTree {
  projectId: string;
  files: MemoryFileEntry[];
  dirs: MemoryDirEntry[];
}

export interface MemoryFile {
  projectId: string;
  /** Project-root-relative path echoed back. */
  path: string;
  content: string;
  sizeBytes: number;
  modifiedAt: string;
}

// ── Mutate return types ───────────────────────────────────────────

export interface ThreadsCancelReturn {
  cancelled: boolean;
}

export interface ExecutionsCancelReturn {
  cancelled: boolean;
}

export interface ConfigSetReturn {
  written: true;
  section: 'budget';
}

// ── Mapped types ──────────────────────────────────────────────────

export interface QueryParamMap {
  'projects.list': Record<string, never>;
  'sessions.list': SessionsListParams;
  'threads.list': ThreadsListParams;
  'threads.get': ThreadsGetParams;
  'tasks.list': TasksListParams;
  'schedules.list': SchedulesListParams;
  'executions.list': ExecutionsListParams;
  'executions.get': ExecutionsGetParams;
  'memory.tree': MemoryTreeParams;
  'memory.file': MemoryFileParams;
  'cost.summary': CostSummaryParams;
  'config.get': ConfigGetParams;
}

export interface QueryReturnMap {
  'projects.list': ProjectConduitInfo[];
  'sessions.list': SessionInfo[];
  'threads.list': ThreadInfo[];
  'threads.get': ThreadDetail;
  'tasks.list': TaskInfo[];
  'schedules.list': ScheduleInfo[];
  'executions.list': ExecutionInfo[];
  'executions.get': ExecutionDetailInfo;
  'memory.tree': MemoryTree;
  'memory.file': MemoryFile;
  'cost.summary': CostSummary;
  'config.get': ConfigSnapshot;
}

export interface MutateArgsMap {
  'threads.cancel': ThreadsCancelArgs;
  'executions.cancel': ExecutionsCancelArgs;
  'schedules.pause': ScheduleActionArgs;
  'schedules.resume': ScheduleActionArgs;
  'schedules.remove': ScheduleActionArgs;
  'tasks.claim': TaskActionArgs;
  'tasks.unclaim': TaskActionArgs;
  'tasks.complete': TaskCompleteArgs;
  'tasks.block': TaskBlockArgs;
  'tasks.unblock': TaskActionArgs;
  'config.set': ConfigSetArgs;
}

export interface MutateReturnMap {
  'threads.cancel': ThreadsCancelReturn;
  'executions.cancel': ExecutionsCancelReturn;
  'schedules.pause': void;
  'schedules.resume': void;
  'schedules.remove': void;
  'tasks.claim': void;
  'tasks.unclaim': void;
  'tasks.complete': void;
  'tasks.block': void;
  'tasks.unblock': void;
  'config.set': ConfigSetReturn;
}

export type QueryParams<S extends QueryScope> = S extends keyof QueryParamMap ? QueryParamMap[S] : never;
export type QueryReturn<S extends QueryScope> = S extends keyof QueryReturnMap ? QueryReturnMap[S] : never;
export type MutateArgs<O extends MutateOp> = O extends keyof MutateArgsMap ? MutateArgsMap[O] : never;
export type MutateReturn<O extends MutateOp> = O extends keyof MutateReturnMap ? MutateReturnMap[O] : never;

// ── UiService interface ───────────────────────────────────────────

export interface UiService {
  query<S extends QueryScope>(scope: S, params: QueryParams<S>): Promise<Result<QueryReturn<S>>>;
  mutate<O extends MutateOp>(op: O, args: MutateArgs<O>): Promise<Result<MutateReturn<O>>>;
  subscribe(filter: SubscribeFilter): AsyncIterable<UiEvent> & { close(): void };
  /**
   * Live `execution.log` stream for one running execution (B2-C). Resolves the log location from
   * the executionId, ref-counts the shared tailer (first subscriber starts it, last stops it), and
   * delivers lines over the same bounded queue as `subscribe`. A closed stream when unresolvable.
   */
  subscribeExecutionLog(executionId: string): AsyncIterable<UiEvent> & { close(): void };
}

// ── Deps ──────────────────────────────────────────────────────────

export interface UiServiceDeps {
  projectStore: {
    list(): Project[];
    get(id: string): Project | undefined;
    exists(id: string): boolean;
    getDefault(): Project;
  };
  sessionStore: {
    listByProject(projectId: string): Promise<Session[]>;
    listResumable(projectId?: string): Promise<Session[]>;
    getById(sessionId: string): Promise<Session | null>;
  };
  threadStore: {
    getAll(): any[];
    get(id: string): any | null;
  };
  taskStore: {
    getAll(project?: string): any[];
    getById(taskId: string): any | null;
    load(): void;
    refresh(): void;
  };
  scheduler: {
    list(): Promise<ScheduleTask[]>;
    get(id: string): Promise<ScheduleTask | null>;
    pause(id: string, pausedBy?: 'user' | 'rate-limit'): Promise<ScheduleTask | null>;
    resume(id: string): Promise<ScheduleTask | null>;
    remove(id: string): Promise<boolean>;
  };
  executionRegistry: {
    getExecution(id: string): any | null;
    getAll(): any[];
    cancelExecution(id: string, metrics?: any): any | null;
  };
  /** Ref-counted live log tailer (B2-C). Started/stopped around each execution.log subscription. */
  executionLogTailer: {
    startTail(executionId: string, location: LogLocation): void;
    stopTail(executionId: string): void;
    refCount(executionId: string): number;
  };
  runningExecutions: RunningExecutions;
  costSummary: (projectId?: string | null) => Promise<CostSummary>;
  bus: EventBus;
  adapter: PlatformAdapter;
}
