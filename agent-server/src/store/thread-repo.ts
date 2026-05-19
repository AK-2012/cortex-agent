// input:  threads.json persistence file
// output: { threadStore } — Thread state in-memory cache + atomic persistence
// pos:    Thread system persistence layer. Based on JsonRepository abstraction, reads/writes threads.json, provides CRUD + query interfaces
// >>> If I am updated, update my header comment and CORTEX.md <<<

import * as path from 'path';
import * as crypto from 'crypto';
import { readFileSync, rmSync } from 'fs';
import { JsonRepository } from './json-repository.js';
import { createLogger } from '@core/log.js';
import { AsyncMutex } from '@core/async-mutex.js';
import { STORE_DIR } from '@core/paths.js';

const log = createLogger('thread-store');
import type { ThreadRecord, ThreadId, ThreadStatus } from '@core/types/thread-types.js';

const THREADS_FILE = path.join(STORE_DIR, 'threads.json');

class ThreadRepo {
  /** In-memory source of truth for all thread records. All sync reads come from here. */
  private map = new Map<string, ThreadRecord>();
  private repo = new JsonRepository<Record<string, ThreadRecord>>({
    filePath: THREADS_FILE,
    defaultValue: () => ({}),
  });
  /** Serializes all persist operations (set, delete, mutate, lifecycle). */
  private mutex = new AsyncMutex();
  /** Promise chain for `set()`/`delete()`-initiated persists, guarded by this.mutex. */
  private _pendingPersist: Promise<void> = Promise.resolve();

  // --- Lifecycle ---

  /** Load threads from disk into memory. Populates the Map from threads.json. */
  load(): void {
    try {
      const data = JSON.parse(readFileSync(THREADS_FILE, 'utf8'));
      this.map.clear();
      for (const [id, record] of Object.entries(data)) {
        this.map.set(id, record as ThreadRecord);
      }
      log.info(`Loaded ${this.map.size} threads`);
    } catch {
      this.map.clear();
    }
  }

  // --- ID generation ---

  generateId(): ThreadId {
    const rand = crypto.randomBytes(4).toString('hex');
    return `thr_${rand}`;
  }

  // --- CRUD ---

  get(id: ThreadId): ThreadRecord | null {
    return this.map.get(id) || null;
  }

  /**
   * Insert or replace a thread record. Updates `updatedAt` and queues a persist.
   * Map update is synchronous; disk write is queued through the mutex.
   * Returns the persist promise for callers that need to await it.
   */
  set(record: ThreadRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    this.map.set(record.id, record);
    return this.queuePersist();
  }

  /** Remove a thread and queue a persist. */
  delete(id: ThreadId): Promise<void> {
    this.map.delete(id);
    return this.queuePersist();
  }

  /**
   * Mutate a single thread's record in-place, updating `updatedAt` and persisting.
   * Awaits any pending `set()`/`delete()` persists, then acquires the mutex for
   * a serialized read-modify-write.
   */
  async mutate(id: ThreadId, fn: (t: ThreadRecord) => void): Promise<void> {
    await this._pendingPersist;
    await this.mutex.run(async () => {
      const thread = this.map.get(id);
      if (!thread) return;
      fn(thread);
      thread.updatedAt = new Date().toISOString();
      this.map.set(id, thread);
      await this.persist();
    });
  }

  /** Await all pending `set()`/`delete()` disk writes AND any in-flight `mutate()`.
   *  For graceful SIGTERM drain and test cleanup.
   *  Two awaits because set/delete queue through _pendingPersist while mutate/cleanup/
   *  markRunningAsFailedOnStartup acquire this.mutex directly after awaiting the chain. */
  async flush(): Promise<void> {
    await this._pendingPersist;
    await this.mutex.run(async () => { /* acquire-release: waits for any in-flight mutate */ });
  }

  // --- Queries ---

  findByChannel(channel: string): ThreadRecord[] {
    const results: ThreadRecord[] = [];
    for (const record of this.map.values()) {
      if (record.channel === channel) results.push(record);
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  findByPlatformThread(channel: string, platformThreadId: string): ThreadRecord | null {
    for (const record of this.map.values()) {
      if (record.channel === channel && record.platformThreadId === platformThreadId) {
        return record;
      }
    }
    return null;
  }

  findActive(channel: string): ThreadRecord | null {
    for (const record of this.map.values()) {
      if (record.channel === channel && (record.status === 'running' || record.status === 'waiting')) {
        return record;
      }
    }
    return null;
  }

  getAll(): ThreadRecord[] {
    return Array.from(this.map.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --- Lifecycle helpers ---

  async markRunningAsFailedOnStartup(): Promise<number> {
    await this._pendingPersist;
    return this.mutex.run(async () => {
      let count = 0;
      for (const record of this.map.values()) {
        if (record.status === 'running' || record.status === 'waiting') {
          record.status = 'failed';
          record.error = 'Interrupted by server restart';
          record.endedAt = new Date().toISOString();
          record.updatedAt = new Date().toISOString();
          count++;
        }
      }
      if (count > 0) {
        await this.persist();
        log.info(`Marked ${count} interrupted threads as failed`);
      }
      return count;
    });
  }

  /** Remove threads older than maxAge (default 7 days), including workspace directories.
   *  Auto-records (no workspace) use a shorter 24h TTL since they only need to
   *  survive long enough for !thread add chaining. */
  async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    await this._pendingPersist;
    return this.mutex.run(async () => {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      const autoRecordCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let count = 0;
      for (const [id, record] of this.map) {
        const isTerminal = record.status === 'completed' || record.status === 'failed'
          || record.status === 'cancelled' || record.status === 'aborted';
        const isAutoRecord = !record.workspacePath;
        const effectiveCutoff = isAutoRecord ? autoRecordCutoff : cutoff;
        if (isTerminal && record.updatedAt < effectiveCutoff) {
          if (record.workspacePath) {
            try {
              rmSync(record.workspacePath, { recursive: true, force: true });
            } catch {}
          }
          this.map.delete(id);
          count++;
        }
      }
      if (count > 0) {
        await this.persist();
        log.info(`Cleaned up ${count} old threads (including workspaces)`);
      }
      return count;
    });
  }

  /** Queue a persist through the mutex, chaining off any prior persist. Returns the promise.
   *  Errors are caught at the chain level so a single I/O failure does not poison all subsequent
   *  writes (returning a rejected chain would short-circuit every follow-up `.then`). */
  queuePersist(): Promise<void> {
    this._pendingPersist = this._pendingPersist
      .catch(() => {})
      .then(() => this.mutex.run(() => this.persist()))
      .catch((err) => { log.error('persist failed:', err); });
    return this._pendingPersist;
  }

  /** Atomically persist the entire Map to disk. Uses `repo.write()` (no read-modify-write needed). */
  private async persist(): Promise<void> {
    const obj: Record<string, ThreadRecord> = {};
    for (const [id, record] of this.map) {
      obj[id] = record;
    }
    await this.repo.write(obj);
  }
}

export const threadStore = new ThreadRepo();
