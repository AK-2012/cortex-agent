// input:  nothing (leaf module)
// output: UiService types — Result, QueryScope, MutateOp, DTOs, UiService interface, UiServiceDeps
// pos:    leaf types module, depends only on domain types pulled in by query/mutate handlers
// >>> If I am updated, update CORTEX.md and the parent folder's CORTEX.md <<<

import type { Project, CreateProjectResult } from '@domain/projects/index.js';
import type { CostSummary } from '@domain/costs/cost-tracker.js';
import type { EventBus } from '@events/index.js';
import type { RunningExecutions } from '@core/running-executions.js';
import type { PlatformAdapter } from '@platform/adapter.js';
import type { Session } from '@store/session-registry-repo.js';
import type { ScheduleTask, ScheduleTarget } from '@store/schedule-repo.js';
import type { LogLocation } from '@domain/executions/log-tailer.js';
import type { SessionHistory } from '@store/conversation-history-repo.js';

// ── Result ────────────────────────────────────────────────────────

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; code: string; message: string };
export type Result<T> = Ok<T> | Err;

// ── Query scopes ──────────────────────────────────────────────────

export type QueryScope =
  | 'projects.list'
  | 'sessions.list'
  | 'sessions.transcript'
  | 'threads.list'
  | 'threads.get'
  | 'tasks.list'
  | 'schedules.list'
  | 'executions.list'
  | 'executions.get'
  | 'memory.tree'
  | 'memory.file'
  | 'approvals.list'
  | 'cost.summary'
  | 'config.get';

// ── Mutate ops ────────────────────────────────────────────────────

export type MutateOp =
  | 'projects.create'
  | 'sessions.send'
  | 'threads.cancel'
  | 'executions.cancel'
  | 'schedules.pause'
  | 'schedules.resume'
  | 'schedules.remove'
  | 'schedules.add'
  | 'tasks.claim'
  | 'tasks.unclaim'
  | 'tasks.complete'
  | 'tasks.block'
  | 'tasks.unblock'
  | 'approvals.approve'
  | 'approvals.reject'
  | 'config.set';

// ── Subscribe ─────────────────────────────────────────────────────

export interface SubscribeFilter {
  events: string[];
  projectId?: string | null;
  /** Scope `execution.log` events to a single execution (B2-C live log stream). */
  executionId?: string | null;
  /** Scope `session.message` events to a single session (S4 chat live stream). */
  sessionId?: string | null;
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
  /** Restrict to a single initiation origin. The workbench left rail passes 'direct' so
   *  only user conversations show; thread/scheduled sessions live in their own views. */
  origin?: 'direct' | 'thread' | 'scheduled';
}

export interface SessionsTranscriptParams {
  sessionId: string;
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

export interface ApprovalsListParams {
  /** Filter to a single approval status. Omitted → all entries. */
  status?: ApprovalStatus;
}

export interface CostSummaryParams {
  projectId?: string | null;
}

export type ConfigGetParams = Record<string, never>;

// ── Mutate args ───────────────────────────────────────────────────

export interface ProjectCreateArgs {
  name: string;
}

export interface SessionsSendArgs {
  sessionId: string;
  text: string;
}

export interface ThreadsCancelArgs {
  threadId: string;
}

export interface ExecutionsCancelArgs {
  executionId: string;
}

export interface ScheduleActionArgs {
  scheduleId: string;
}

// Args for `schedules.add` (DR-0018 §2.1 7c). Per-type required fields are enforced by the zod
// `scheduleAddInput` schema at the router boundary AND re-checked in the handler (so a direct
// facade/unit call is rejected too). intervalMs/delay are raw ms numbers; dayOfWeek is 0..6.
export interface ScheduleAddArgs {
  type: 'interval' | 'daily' | 'weekly' | 'once';
  message: string;
  projectId?: string;
  profile?: string;
  intervalMs?: number;
  time?: string;
  dayOfWeek?: number;
  delay?: number;
  target?: ScheduleTarget;
  fallback?: 'fresh' | 'skip' | 'wait';
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

export interface ApprovalsApproveArgs {
  id: string;
}

export interface ApprovalsRejectArgs {
  id: string;
  feedback?: string;
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
  /** How the session was initiated: 'direct' (user chat), 'thread' (pipeline/dispatch
   *  step), or 'scheduled' (scheduled job). The workbench session list shows only 'direct'. */
  origin: 'direct' | 'thread' | 'scheduled';
  createdAt: string;
  lastUsedAt: string;
  resumable: boolean;
  label: string | null;
}

// ── sessions.transcript DTO (S4 chat) ─────────────────────────────
// Wraps conversation-history's per-session event stream, grouped into turns (each `user`
// event opens a turn). Streaming assistant partials are already collapsed at the source
// (conversationHistory.getHistory). An absent/empty history maps to `{ sessionId, turns: [] }`.

export interface TranscriptMessage {
  type: 'user' | 'assistant' | 'tool';
  /** user / assistant text; null for tool events. */
  text: string | null;
  /** tool name (tool events only). */
  toolName: string | null;
  /** compact tool input summary (tool events only). */
  toolInput: string | null;
  ts: string;
}

export interface TranscriptTurn {
  turnIndex: number;
  messages: TranscriptMessage[];
}

export interface SessionTranscript {
  sessionId: string;
  turns: TranscriptTurn[];
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
  /** The task's rationale (task store `why`). Null when absent/empty (null-safe). */
  why: string | null;
  /** The task's completion criteria (task store `done-when`). Null when absent/empty (null-safe). */
  doneWhen: string | null;
}

export interface ScheduleInfo {
  id: string;
  type: 'interval' | 'daily' | 'weekly' | 'once';
  message: string;
  projectId: string;
  /** The agent profile this schedule runs under, from the schedule config source.
   *  null for legacy records that never recorded a profile (honest placeholder — no fabrication). */
  profile: string | null;
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

/** Real per-file line-level diff counts vs HEAD (`git diff --numstat`). */
export interface MemoryLineDiff {
  added: number;
  removed: number;
}

export interface MemoryFile {
  projectId: string;
  /** Project-root-relative path echoed back. */
  path: string;
  content: string;
  sizeBytes: number;
  modifiedAt: string;
  /**
   * Working-tree-vs-HEAD line counts from `git diff --numstat`. `null` (honest placeholder, never
   * fabricated) when the project dir is not in a git work tree, git is unavailable, or the diff is
   * binary/unresolvable.
   */
  lineDiff: MemoryLineDiff | null;
}

// ── approvals DTO (DR-0018 §2.1 approval center 7a) ────────────────
// Parsed from <CORTEX_HOME>/context/PENDING_APPROVALS.md. One entry per `## <date> <title>`
// heading. The queue is a markdown store; approve/reject only flip the Status line (no execution).

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'failed';

export interface ApprovalInfo {
  /** Stable id derived from the heading line (no explicit id exists in the markdown). */
  id: string;
  title: string;
  operation: string | null;
  reason: string | null;
  impact: string | null;
  /** From the `Command/Action` bullet. */
  command: string | null;
  status: ApprovalStatus;
  /** Date from the `## <YYYY-MM-DD> <title>` heading, null if unparseable. */
  queuedAt: string | null;
  /** Timestamp parsed from an approved/rejected Status line, null otherwise. */
  decidedAt: string | null;
  /** Parenthetical feedback captured from a rejected Status line, null otherwise. */
  feedback: string | null;
}

// ── Mutate return types ───────────────────────────────────────────

export interface ProjectCreateReturn {
  /** The id of the newly created project (equals its directory name). */
  id: string;
}

export interface SessionsSendReturn {
  /** The message was accepted and routed. Assistant output returns via the `session.message`
   *  stream event, NOT this return (fire-and-forget). */
  accepted: boolean;
}

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

export interface ApprovalMutateReturn {
  id: string;
  status: ApprovalStatus;
}

// ── Mapped types ──────────────────────────────────────────────────

export interface QueryParamMap {
  'projects.list': Record<string, never>;
  'sessions.list': SessionsListParams;
  'sessions.transcript': SessionsTranscriptParams;
  'threads.list': ThreadsListParams;
  'threads.get': ThreadsGetParams;
  'tasks.list': TasksListParams;
  'schedules.list': SchedulesListParams;
  'executions.list': ExecutionsListParams;
  'executions.get': ExecutionsGetParams;
  'memory.tree': MemoryTreeParams;
  'memory.file': MemoryFileParams;
  'approvals.list': ApprovalsListParams;
  'cost.summary': CostSummaryParams;
  'config.get': ConfigGetParams;
}

export interface QueryReturnMap {
  'projects.list': ProjectConduitInfo[];
  'sessions.list': SessionInfo[];
  'sessions.transcript': SessionTranscript;
  'threads.list': ThreadInfo[];
  'threads.get': ThreadDetail;
  'tasks.list': TaskInfo[];
  'schedules.list': ScheduleInfo[];
  'executions.list': ExecutionInfo[];
  'executions.get': ExecutionDetailInfo;
  'memory.tree': MemoryTree;
  'memory.file': MemoryFile;
  'approvals.list': ApprovalInfo[];
  'cost.summary': CostSummary;
  'config.get': ConfigSnapshot;
}

export interface MutateArgsMap {
  'projects.create': ProjectCreateArgs;
  'sessions.send': SessionsSendArgs;
  'threads.cancel': ThreadsCancelArgs;
  'executions.cancel': ExecutionsCancelArgs;
  'schedules.pause': ScheduleActionArgs;
  'schedules.resume': ScheduleActionArgs;
  'schedules.remove': ScheduleActionArgs;
  'schedules.add': ScheduleAddArgs;
  'tasks.claim': TaskActionArgs;
  'tasks.unclaim': TaskActionArgs;
  'tasks.complete': TaskCompleteArgs;
  'tasks.block': TaskBlockArgs;
  'tasks.unblock': TaskActionArgs;
  'approvals.approve': ApprovalsApproveArgs;
  'approvals.reject': ApprovalsRejectArgs;
  'config.set': ConfigSetArgs;
}

export interface MutateReturnMap {
  'projects.create': ProjectCreateReturn;
  'sessions.send': SessionsSendReturn;
  'threads.cancel': ThreadsCancelReturn;
  'executions.cancel': ExecutionsCancelReturn;
  'schedules.pause': void;
  'schedules.resume': void;
  'schedules.remove': void;
  'schedules.add': ScheduleInfo;
  'tasks.claim': void;
  'tasks.unclaim': void;
  'tasks.complete': void;
  'tasks.block': void;
  'tasks.unblock': void;
  'approvals.approve': ApprovalMutateReturn;
  'approvals.reject': ApprovalMutateReturn;
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
    createProject(name: string): CreateProjectResult;
  };
  sessionStore: {
    listByProject(projectId: string): Promise<Session[]>;
    listByOrigin(origin: 'direct' | 'thread' | 'scheduled', projectId?: string): Promise<Session[]>;
    listResumable(projectId?: string): Promise<Session[]>;
    getById(sessionId: string): Promise<Session | null>;
  };
  /** Backend-independent conversation history — read source for `sessions.transcript` (S4 chat). */
  conversationHistory: {
    getHistory(sessionId: string): Promise<SessionHistory | null>;
  };
  /**
   * Inject a genuine user turn into a session and route it through the agent (S4 chat send).
   * Fire-and-forget: assistant output returns via the `session.message` stream event, not here.
   * Wired in the entry layer (app.ts) to the orchestration send path — kept as an injected
   * callback so the ui-service domain never imports orchestration (layer safety / depcruise).
   */
  sendSessionMessage: (opts: { sessionId: string; channel: string; text: string }) => void;
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
    /** Create a schedule (schedules.add). The injected impl (app.ts) composes the real
     *  scheduler.add + schedule-repo backfill of target/fallback, returning the final task. */
    add(
      type: ScheduleTask['type'],
      options: {
        message: string;
        projectId: string;
        profile?: string | null;
        intervalMs?: number;
        time?: string;
        dayOfWeek?: number;
        delay?: number;
        target?: ScheduleTarget;
        fallback?: 'fresh' | 'skip' | 'wait';
      },
    ): Promise<ScheduleTask>;
  };
  executionRegistry: {
    getExecution(id: string): any | null;
    getAll(): any[];
    cancelExecution(id: string, metrics?: any): any | null;
  };
  /** Absolute path to PENDING_APPROVALS.md (the approval-center 7a markdown queue). */
  approvalsPath: string;
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
