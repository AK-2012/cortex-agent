// input:  AgentHandle-like kill function, EventBus
// output: RunningExecutions singleton — unified execution registry with byKey/byThreadId/byExecutionId indices
// pos:    orch/ layer, encapsulates three-index registry + publishes agent.* lifecycle events
//         Pure additive — no existing call points are replaced by this file.

import type { EventBus } from '@events/index.js';

export interface RunningExecution {
  threadId: string | null;
  channel: string | null;
  registryKey: string;
  agentSlotId: string | null;
  executionId: string | null;
  kill: () => boolean;
  startTime: number;
  backend: string;
  /** Agent process reference — used by PI backend to route extension_ui_response for plan/ask interactions. */
  agentProcess?: unknown;
  /** Claude session ID — saved on cancel so the next message can resume the same session. */
  sessionId?: string | null;
}

export type RunningExecutionInput = Omit<RunningExecution, 'registryKey' | 'startTime'>;

export class RunningExecutions {
  /** Primary index: key is channel or hookHandleKey (arbitrary string). */
  private byKey = new Map<string, RunningExecution>();
  /** Secondary index: threadId → RunningExecution, only if threadId is non-null. */
  private byThreadId = new Map<string, RunningExecution>();
  /** Secondary index: executionId → RunningExecution, only if executionId is non-null. */
  private byExecutionId = new Map<string, RunningExecution>();
  /** EventBus for publishing agent.* lifecycle events. May be set after construction. */
  private _bus: EventBus | null = null;

  constructor(bus?: EventBus) {
    if (bus) this._bus = bus;
  }

  setBus(bus: EventBus): void {
    this._bus = bus;
  }

  /**
   * Register a new execution under an arbitrary key.
   * Silently replaces any existing entry at the same key.
   * Secondary indices (byThreadId / byExecutionId) are kept in sync.
   * Publishes agent.started if executionId is non-null and bus is wired.
   */
  register(key: string, exec: RunningExecutionInput): void {
    // Clean up old entry at this key, if any, to keep secondary indices consistent
    const existing = this.byKey.get(key);
    if (existing) {
      this._removeFromIndices(existing);
    }

    const entry: RunningExecution = {
      ...exec,
      registryKey: key,
      startTime: Date.now(),
    };

    this.byKey.set(key, entry);
    if (entry.threadId) this.byThreadId.set(entry.threadId, entry);
    if (entry.executionId) this.byExecutionId.set(entry.executionId, entry);

    if (this._bus && entry.executionId) {
      this._bus.publish({
        type: 'agent.started',
        channel: entry.channel ?? key,
        executionId: entry.executionId,
        backend: entry.backend,
      });
    }
  }

  /** Look up an execution by its primary registry key. Returns null if not found. */
  getByKey(key: string): RunningExecution | null {
    return this.byKey.get(key) ?? null;
  }

  /** Look up an execution by threadId. Returns null if not found or threadId was null at registration. */
  getByThreadId(threadId: string): RunningExecution | null {
    return this.byThreadId.get(threadId) ?? null;
  }

  /** Look up an execution by executionId. Returns null if not found. */
  getByExecutionId(executionId: string): RunningExecution | null {
    return this.byExecutionId.get(executionId) ?? null;
  }

  /** Returns true if an execution is registered under the given key. */
  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * Kill the execution for a key, remove it from all indices, and return the result of kill().
   * Returns false if no entry is registered for the key.
   */
  killByKey(key: string): boolean {
    const entry = this.byKey.get(key);
    if (!entry) return false;
    const killed = entry.kill();
    this._removeFromIndices(entry);
    this.byKey.delete(key);
    return killed;
  }

  /**
   * Kill the execution for a threadId, remove it from all indices, and return true.
   * Resolves through byThreadId secondary index.
   * Returns false if no entry has that threadId.
   */
  killByThreadId(threadId: string): boolean {
    const entry = this.byThreadId.get(threadId);
    if (!entry) return false;
    entry.kill();
    this._removeFromIndices(entry);
    this.byKey.delete(entry.registryKey);
    return true;
  }

  /**
   * Remove an execution by key without calling kill() or publishing events.
   * No-op if the key is not registered.
   */
  remove(key: string): void {
    const entry = this.byKey.get(key);
    if (!entry) return;
    this._removeFromIndices(entry);
    this.byKey.delete(key);
  }

  /** Return all registered executions (snapshot of the primary index). */
  getAll(): RunningExecution[] {
    return Array.from(this.byKey.values());
  }

  /**
   * Mark the execution for a key as completed and publish agent.completed.
   * Returns false if no entry is registered for the key (e.g., already removed).
   * Publishes agent.completed only if executionId is non-null and bus is wired.
   */
  complete(key: string, costUsd = 0): boolean {
    const entry = this.byKey.get(key);
    if (!entry) return false;
    this._removeFromIndices(entry);
    this.byKey.delete(key);
    if (this._bus && entry.executionId) {
      this._bus.publish({
        type: 'agent.completed',
        executionId: entry.executionId,
        cost: costUsd,
        durationMs: Date.now() - entry.startTime,
      });
    }
    return true;
  }

  /**
   * Mark the execution for a key as failed and publish agent.failed.
   * Returns false if no entry is registered for the key (e.g., already removed by supersede).
   * Publishes agent.failed only if executionId is non-null and bus is wired.
   */
  fail(key: string, error: string): boolean {
    const entry = this.byKey.get(key);
    if (!entry) return false;
    this._removeFromIndices(entry);
    this.byKey.delete(key);
    if (this._bus && entry.executionId) {
      this._bus.publish({
        type: 'agent.failed',
        executionId: entry.executionId,
        error,
      });
    }
    return true;
  }

  /**
   * Kill the execution for a key, remove it, and publish agent.superseded.
   * Returns false if no entry is registered for the key.
   * Publishes agent.superseded only if executionId is non-null and bus is wired.
   */
  supersede(key: string, reason: string): boolean {
    const entry = this.byKey.get(key);
    if (!entry) return false;
    entry.kill();
    this._removeFromIndices(entry);
    this.byKey.delete(key);
    if (this._bus && entry.executionId) {
      this._bus.publish({
        type: 'agent.superseded',
        executionId: entry.executionId,
        reason,
      });
    }
    return true;
  }

  /**
   * Remove an entry from secondary indices (byThreadId / byExecutionId).
   * Guards each delete with identity check: only clears the index if it still points
   * to this entry.  This prevents corruption when a stale entry (whose threadId/executionId
   * has been claimed by a newer entry) is removed.
   */
  private _removeFromIndices(entry: RunningExecution): void {
    if (entry.threadId && this.byThreadId.get(entry.threadId) === entry)
      this.byThreadId.delete(entry.threadId);
    if (entry.executionId && this.byExecutionId.get(entry.executionId) === entry)
      this.byExecutionId.delete(entry.executionId);
  }
}

/** Singleton instance of RunningExecutions. */
export const runningExecutions = new RunningExecutions();
