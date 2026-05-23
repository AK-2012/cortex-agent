// input:  executions.json (Record<string, ExecutionRecord>)
// output: { executionRepo } — ExecutionRepo singleton with sync read + async persist (Pattern B)
//         stale methods (markMissingRunningExecutionsStale / reconcileStaleDispatches) return affected IDs for lock-release side effect
// pos:    Execution truth layer persistence layer. Based on JsonRepository abstraction, reads/writes executions.json
// >>> If I am updated, update my header comment and CORTEX.md <<<

import * as path from 'path';
import { readFileSync } from 'fs';
import { JsonRepository } from '@core/json-repository.js';
import { createLogger } from '@core/log.js';
import { AsyncMutex } from '@core/async-mutex.js';
import { STORE_DIR } from '@core/paths.js';

const log = createLogger('execution-repo');

export interface DispatchInfo {
  taskId: string;
  taskHash: string | null;
  machine: string | null;
  scheduleTaskId: string | null;
  sessionName: string | null;
  tmuxName: string | null;
  pid: string | null;
}

export interface ExecutionRecord {
  id: string;
  kind: string;
  status: string;
  channel: string | null;
  project: string;
  source: { trigger: string };
  backend: string;
  billingMode: string;
  session: { sessionId: string | null };
  thread: { threadId: string | null; agentSlotId: string | null } | null;
  dispatch: DispatchInfo | null;
  scheduleTaskId: string | null;
  runtime: { startedAt: string; updatedAt: string; endedAt: string | null };
  metrics: { costUsd: number | null; numTurns: number | null; durationS: number | null };
  text: { label: string | null; finalOutput: string | null; error: string | null };
}

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stale', 'cancelled']);

type ExecutionsData = Record<string, ExecutionRecord>;

interface ExecutionRepoOptions {
  /** Optional file path override. Defaults to $CORTEX_EXECUTIONS_FILE or DATA_DIR/executions.json */
  filePath?: string;
}

function getExecutionsFile(override?: string): string {
  return override || process.env.CORTEX_EXECUTIONS_FILE || path.join(STORE_DIR, 'executions.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildExecutionId(kind: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `exec_${kind}_${stamp}_${rand}`;
}

function createBaseRecord({ kind, channel, project, trigger, backend, billingMode, sessionId, label, scheduleTaskId, threadId, agentSlotId }: {
  kind: string; channel?: string | null; project?: string; trigger?: string;
  backend?: string; billingMode?: string; sessionId?: string | null;
  label?: string | null; scheduleTaskId?: string | null;
  threadId?: string | null; agentSlotId?: string | null;
}): ExecutionRecord {
  const timestamp = nowIso();
  return {
    id: buildExecutionId(kind),
    kind,
    status: 'running',
    channel: channel || null,
    project: project || 'general',
    source: { trigger: trigger || kind },
    backend: backend || 'claude',
    billingMode: billingMode || 'api',
    session: { sessionId: sessionId || null },
    thread: (threadId || agentSlotId) ? { threadId: threadId || null, agentSlotId: agentSlotId || null } : null,
    dispatch: null,
    scheduleTaskId: scheduleTaskId || null,
    runtime: {
      startedAt: timestamp,
      updatedAt: timestamp,
      endedAt: null,
    },
    metrics: {
      costUsd: null,
      numTurns: null,
      durationS: null,
    },
    text: {
      label: label || null,
      finalOutput: null,
      error: null,
    },
  };
}

function finalizeExecution(record: ExecutionRecord, status: string, { costUsd, numTurns, durationS, finalOutput, error }: {
  costUsd?: number | null; numTurns?: number | null; durationS?: number | null;
  finalOutput?: string | null; error?: string | null;
} = {}): ExecutionRecord {
  const timestamp = nowIso();
  return {
    ...record,
    status,
    runtime: {
      ...record.runtime,
      updatedAt: timestamp,
      endedAt: timestamp,
    },
    metrics: {
      costUsd: costUsd ?? record.metrics.costUsd,
      numTurns: numTurns ?? record.metrics.numTurns,
      durationS: durationS ?? record.metrics.durationS,
    },
    text: {
      ...record.text,
      finalOutput: finalOutput ?? record.text.finalOutput,
      error: error ?? record.text.error,
    },
  };
}

class ExecutionRepo {
  /** In-memory source of truth for all execution records. All sync reads come from here. */
  private map = new Map<string, ExecutionRecord>();
  private repo: JsonRepository<ExecutionsData>;

  public readonly filePath: string;

  private mutex = new AsyncMutex();
  /** Promise chain for fire-and-forget persists, guarded by this.mutex. */
  private _pendingPersist: Promise<void> = Promise.resolve();

  constructor(opts?: ExecutionRepoOptions) {
    this.filePath = getExecutionsFile(opts?.filePath);
    this.repo = new JsonRepository<ExecutionsData>({
      filePath: this.filePath,
      defaultValue: () => ({}),
    });
  }

  // --- Lifecycle ---

  /** Load executions from disk into memory. Populates the Map from executions.json. */
  load(): void {
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      this.map.clear();
      for (const [id, record] of Object.entries(data)) {
        this.map.set(id, record as ExecutionRecord);
      }
      log.info(`Loaded ${this.map.size} executions`);
    } catch {
      this.map.clear();
    }
  }

  // --- Sync reads (fast path, no await) ---

  getExecution(id: string): ExecutionRecord | null {
    return this.map.get(id) || null;
  }

  getExecutionByTaskId(taskId: string | null | undefined): ExecutionRecord | null {
    if (!taskId) return null;
    const matches: ExecutionRecord[] = [];
    for (const record of this.map.values()) {
      if (record.dispatch?.taskId === taskId) matches.push(record);
    }
    // Prefer non-terminal record (running) over terminal ones when a task is re-dispatched
    return matches.find((r) => !TERMINAL_STATUSES.has(r.status)) || matches[0] || null;
  }

  getRunningExecutions(): ExecutionRecord[] {
    const results: ExecutionRecord[] = [];
    for (const record of this.map.values()) {
      if (record.status === 'running') results.push(record);
    }
    return results;
  }

  getAllExecutions(): ExecutionRecord[] {
    return Array.from(this.map.values());
  }

  findRunningDispatchMatch({ scheduleTaskId, taskHash, project, taskText }: {
    scheduleTaskId?: string | null; taskHash?: string | null; project?: string; taskText?: string;
  }): ExecutionRecord | null {
    const running = this.getRunningExecutions();
    return running.find((record) => {
      if (record.kind !== 'dispatch') return false;
      if (scheduleTaskId && record.scheduleTaskId !== scheduleTaskId) return false;
      if (taskHash && record.dispatch?.taskHash) return record.dispatch.taskHash === taskHash;
      return record.project === project && record.text?.label === taskText;
    }) || null;
  }

  getAll(): ExecutionRecord[] {
    return Array.from(this.map.values())
      .sort((a, b) => b.runtime.startedAt.localeCompare(a.runtime.startedAt));
  }

  // --- Sync create/mutate + fire-and-forget persist ---

  /** Internal: update a record in-place if not terminal, return updated or original. */
  private updateRecordInternal(id: string, updater: (record: ExecutionRecord) => ExecutionRecord): ExecutionRecord | null {
    const current = this.map.get(id);
    if (!current) return null;
    if (TERMINAL_STATUSES.has(current.status)) return current;
    const next = updater({ ...current });
    next.runtime = {
      ...current.runtime,
      ...next.runtime,
      updatedAt: nowIso(),
    };
    this.map.set(id, next);
    this.queuePersist();
    return next;
  }

  startLocalExecution({ kind = 'local', channel, project, trigger, backend, billingMode, sessionId, label, scheduleTaskId, threadId = null, agentSlotId = null }: {
    kind?: string; channel?: string | null; project?: string; trigger?: string;
    backend?: string; billingMode?: string; sessionId?: string | null;
    label?: string | null; scheduleTaskId?: string | null;
    threadId?: string | null; agentSlotId?: string | null;
  }): ExecutionRecord {
    const record = createBaseRecord({ kind, channel, project, trigger, backend, billingMode, sessionId, label, scheduleTaskId, threadId, agentSlotId });
    this.map.set(record.id, record);
    this.queuePersist();
    return record;
  }

  registerDispatchExecution({ taskId, machine, channel, project, scheduleTaskId, taskText, taskHash, sessionName, tmuxName, pid, backend, billingMode }: {
    taskId: string; machine?: string | null; channel?: string | null; project?: string;
    scheduleTaskId?: string | null; taskText?: string | null; taskHash?: string | null;
    sessionName?: string | null; tmuxName?: string | null; pid?: string | null;
    backend?: string; billingMode?: string;
  }): ExecutionRecord | null {
    const existing = this.getExecutionByTaskId(taskId);
    if (existing && !TERMINAL_STATUSES.has(existing.status)) {
      return this.updateRecordInternal(existing.id, (record) => ({
        ...record,
        status: 'running',
        channel: channel || record.channel,
        project: project || record.project,
        backend: backend || record.backend,
        billingMode: billingMode || record.billingMode,
        scheduleTaskId: scheduleTaskId || record.scheduleTaskId,
        text: { ...record.text, label: taskText || record.text.label },
        dispatch: {
          taskId,
          taskHash: taskHash || record.dispatch?.taskHash || null,
          machine: machine || record.dispatch?.machine || null,
          scheduleTaskId: scheduleTaskId || record.dispatch?.scheduleTaskId || null,
          sessionName: sessionName || record.dispatch?.sessionName || null,
          tmuxName: tmuxName || record.dispatch?.tmuxName || null,
          pid: pid || record.dispatch?.pid || null,
        },
      }));
    }

    const record = createBaseRecord({
      kind: 'dispatch',
      channel,
      project,
      trigger: 'dispatch',
      backend,
      billingMode,
      label: taskText,
      scheduleTaskId,
    });
    record.dispatch = {
      taskId,
      taskHash: taskHash || null,
      machine: machine || null,
      scheduleTaskId: scheduleTaskId || null,
      sessionName: sessionName || null,
      tmuxName: tmuxName || null,
      pid: pid || null,
    };
    this.map.set(record.id, record);
    this.queuePersist();
    return record;
  }

  touchExecution(id: string, patch: {
    metrics?: Partial<ExecutionRecord['metrics']>;
    text?: Partial<ExecutionRecord['text']>;
    dispatch?: Partial<DispatchInfo>;
    session?: Partial<ExecutionRecord['session']>;
    [key: string]: unknown;
  } = {}): ExecutionRecord | null {
    return this.updateRecordInternal(id, (record) => ({
      ...record,
      ...patch,
      metrics: { ...record.metrics, ...(patch.metrics || {}) },
      text: { ...record.text, ...(patch.text || {}) },
      dispatch: patch.dispatch ? { ...(record.dispatch || {} as DispatchInfo), ...patch.dispatch } : record.dispatch,
      session: patch.session ? { ...record.session, ...patch.session } : record.session,
    }));
  }

  completeExecution(id: string, metrics: { costUsd?: number | null; numTurns?: number | null; durationS?: number | null; finalOutput?: string | null; error?: string | null } = {}): ExecutionRecord | null {
    return this.updateRecordInternal(id, (record) => finalizeExecution(record, 'completed', metrics));
  }

  completeExecutionByTaskId(taskId: string, metrics?: { costUsd?: number | null; numTurns?: number | null; durationS?: number | null; finalOutput?: string | null; error?: string | null }): ExecutionRecord | null {
    const record = this.getExecutionByTaskId(taskId);
    if (!record) return null;
    return this.completeExecution(record.id, metrics);
  }

  failExecution(id: string, metrics: { costUsd?: number | null; numTurns?: number | null; durationS?: number | null; finalOutput?: string | null; error?: string | null } = {}): ExecutionRecord | null {
    return this.updateRecordInternal(id, (record) => finalizeExecution(record, 'failed', metrics));
  }

  failExecutionByTaskId(taskId: string, metrics?: { costUsd?: number | null; numTurns?: number | null; durationS?: number | null; finalOutput?: string | null; error?: string | null }): ExecutionRecord | null {
    const record = this.getExecutionByTaskId(taskId);
    if (!record) return null;
    return this.failExecution(record.id, metrics);
  }

  cancelExecution(id: string, metrics: { costUsd?: number | null; numTurns?: number | null; durationS?: number | null; finalOutput?: string | null; error?: string | null } = {}): ExecutionRecord | null {
    return this.updateRecordInternal(id, (record) => finalizeExecution(record, 'cancelled', metrics));
  }

  cancelExecutionByTaskId(taskId: string, metrics?: { costUsd?: number | null; numTurns?: number | null; durationS?: number | null; finalOutput?: string | null; error?: string | null }): ExecutionRecord | null {
    const record = this.getExecutionByTaskId(taskId);
    if (!record) return null;
    return this.cancelExecution(record.id, metrics);
  }

  /** Insert or replace a record by ID (used by tests for backdating). */
  set(id: string, record: ExecutionRecord): void {
    this.map.set(id, record);
    this.queuePersist();
  }

  // --- Async operations (need mutex for serialized access) ---

  /** Mark running executions not matching `keepRunning` as stale. Returns IDs of staled executions. */
  async markMissingRunningExecutionsStale(keepRunning?: (record: ExecutionRecord) => boolean): Promise<string[]> {
    await this._pendingPersist;
    const staled: string[] = [];
    await this.mutex.run(async () => {
      const timestamp = nowIso();

      for (const record of this.map.values()) {
        if (record.status !== 'running') continue;
        if (keepRunning && keepRunning(record)) continue;
        record.status = 'stale';
        record.runtime.updatedAt = timestamp;
        record.runtime.endedAt = timestamp;
        staled.push(record.id);
      }

      if (staled.length > 0) await this.persist();
    });
    return staled;
  }

  /** Reconcile stale dispatch executions: mark dispatches that are no longer pending and too old as stale.
   *  Returns { count, staled } where count is reconciled count and staled is the list of affected IDs. */
  async reconcileStaleDispatches({ isTaskPending, maxAgeMs }: {
    isTaskPending: (taskId: string) => boolean; maxAgeMs: number;
  }): Promise<{ count: number; staled: string[] }> {
    await this._pendingPersist;
    return this.mutex.run(async () => {
      const now = Date.now();
      const timestamp = nowIso();
      let reconciled = 0;
      const staled: string[] = [];

      for (const record of this.map.values()) {
        if (record.status !== 'running') continue;
        if (record.kind !== 'dispatch') continue;
        const taskId = record.dispatch?.taskId;
        if (taskId && isTaskPending(taskId)) continue;
        const startedAt = record.runtime?.startedAt ? new Date(record.runtime.startedAt).getTime() : 0;
        if (now - startedAt < maxAgeMs) continue;
        record.status = 'stale';
        record.runtime.updatedAt = timestamp;
        record.runtime.endedAt = timestamp;
        reconciled++;
        staled.push(record.id);
      }

      if (reconciled > 0) {
        await this.persist();
        log.info(`Reconciled ${reconciled} stale dispatch execution(s)`);
      }
      return { count: reconciled, staled };
    });
  }

  // --- Flush & persist ---

  /** Await all pending fire-and-forget disk writes AND any in-flight async operations. */
  async flush(): Promise<void> {
    await this._pendingPersist;
    await this.mutex.run(async () => { /* acquire-release: waits for any in-flight mutex operation */ });
  }

  /** Return the current _pendingPersist promise (for tests that want to await a specific persist batch). */
  queuePersist(): Promise<void> {
    this._pendingPersist = this._pendingPersist
      .catch(() => {})
      .then(() => this.mutex.run(() => this.persist()))
      .catch((err) => { log.error('persist failed:', err); });
    return this._pendingPersist;
  }

  /** Atomically persist the entire Map to disk. */
  private async persist(): Promise<void> {
    const obj: ExecutionsData = {};
    for (const [id, record] of this.map) {
      obj[id] = record;
    }
    await this.repo.write(obj);
  }
}

// ── Singleton ──────────────────────────────────────────────────────

export const executionRepo = new ExecutionRepo();

export { ExecutionRepo };
