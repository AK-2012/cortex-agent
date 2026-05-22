// input:  session-registry.json + JsonRepository
// output: SessionRegistryRepo (async generateSessionName / registerSession / updateSession / lookupSession / lookupBySessionId / getById / listRecentSessions / listByProject / listResumable / markUsed / pruneStale / getActiveSessionName)
// pos:    cortex-XXXX short name ↔ session UUID registry persistence layer (Pattern A, JsonRepository)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JsonRepository } from './json-repository.js';
import { STORE_DIR } from '@core/paths.js';
import { CHANNEL_REGISTRY_FILE } from './channel-repo.js';
import { sessionRepo } from './session-repo.js';
import { executionRepo } from './execution-repo.js';
import { threadStore } from './thread-repo.js';

export const REGISTRY_FILE = path.join(STORE_DIR, 'session-registry.json');

export interface Session {
  name: string;
  sessionId: string;
  projectId: string;
  channel: string;
  backend: string;
  kind: 'local' | 'scheduled';
  createdAt: string;
  lastUsedAt: string;
  label: string | null;
  /** Profile name active when the session was created. Restored on !resume. */
  profileName: string | null;
}

export type SessionRegistryData = Record<string, Session>;  // keyed by sessionId (UUID)

export class SessionRegistryRepo {
  private readonly _repo: JsonRepository<SessionRegistryData>;
  /** name → sessionId index keeping lookupSession O(1). */
  private _nameIndex = new Map<string, string>();
  /** Optional callback invoked when a session is pruned. Receives the sessionId. */
  private _onPruneSession: ((sessionId: string) => void) | null = null;

  constructor(filePath: string = REGISTRY_FILE) {
    this._repo = new JsonRepository<SessionRegistryData>({
      filePath,
      defaultValue: () => ({}),
      migrate: (raw) => {
        if (typeof raw !== 'object' || raw === null) return {};
        const data = raw as Record<string, any>;
        const entries = Object.entries(data);
        if (entries.length === 0) return {};

        // Detect new format: first entry's value has 'name' field
        const firstVal = entries[0][1];
        if (firstVal && typeof firstVal === 'object' && 'name' in firstVal) {
          return data as SessionRegistryData;
        }

        // Old format: name-keyed (cortex-XXXX → SessionRecord), values lack 'name' field.
        // Build channel → project reverse map from channel-registry.json.
        const channelToProject: Record<string, string> = {};
        try {
          const channelRegistryRaw = fs.readFileSync(CHANNEL_REGISTRY_FILE, 'utf8');
          const channelRegistry = JSON.parse(channelRegistryRaw) as Record<string, string>;
          // channelRegistry is projectName → channelId; reverse to channelId → projectName.
          for (const [project, channel] of Object.entries(channelRegistry)) {
            channelToProject[channel] = project;
          }
        } catch {
          // channel-registry.json may not exist yet — all projectIds default to 'general'.
        }

        // Re-key from name → sessionId, deduplicate by lastUsedAt.
        const sessionMap = new Map<string, { name: string; record: any }>();
        for (const [name, record] of entries) {
          if (!record || typeof record !== 'object') continue;
          const sid: string = typeof record.sessionId === 'string' ? record.sessionId : '';
          if (!sid) continue;

          const existing = sessionMap.get(sid);
          if (existing && existing.record.lastUsedAt > record.lastUsedAt) continue;
          sessionMap.set(sid, { name, record });
        }

        // Build new format: sessionId-keyed, with name and projectId fields added.
        const result: Record<string, any> = {};
        for (const [sid, { name, record }] of sessionMap) {
          const channel: string = typeof record.channel === 'string' ? record.channel : '';
          result[sid] = {
            ...record,
            name,
            projectId: channelToProject[channel] || 'general',
          };
        }
        return result as SessionRegistryData;
      },
    });
  }

  // ── name→sessionId index ──────────────────────────────────────

  private _rebuildNameIndex(data: SessionRegistryData): void {
    this._nameIndex.clear();
    for (const [sid, record] of Object.entries(data)) {
      this._nameIndex.set(record.name, sid);
    }
  }

  /** Read registry data, rebuilding the name index from cache when empty. */
  private async _readWithIndex(): Promise<SessionRegistryData> {
    const data = await this._repo.read();
    if (this._nameIndex.size === 0) {
      this._rebuildNameIndex(data);
    }
    return data;
  }

  /** Rebuild the name index from the current cached data (zero I/O on cache hit). */
  private async _syncIndex(): Promise<void> {
    const data = await this._repo.read();
    this._rebuildNameIndex(data);
  }

  // ── Public API ────────────────────────────────────────────────

  async generateSessionName(): Promise<string> {
    const registry = await this._repo.read();
    const knownNames = new Set(Object.values(registry).map((s) => s.name));
    for (let i = 0; i < 100; i++) {
      const hex = crypto.randomBytes(3).toString('hex');
      const name = `cortex-${hex}`;
      if (!knownNames.has(name)) return name;
    }
    return `cortex-${crypto.randomBytes(4).toString('hex')}`;
  }

  async registerSession(name: string, opts: { sessionId: string; channel: string; backend: string; kind: 'local' | 'scheduled'; projectId?: string; label?: string | null; profileName?: string | null }): Promise<void> {
    const now = new Date().toISOString();
    await this._repo.mutate((registry) => {
      registry[opts.sessionId] = {
        name,
        sessionId: opts.sessionId,
        projectId: opts.projectId ?? 'general',
        channel: opts.channel,
        backend: opts.backend,
        kind: opts.kind,
        createdAt: now,
        lastUsedAt: now,
        label: opts.label?.substring(0, 60) || null,
        profileName: opts.profileName ?? null,
      };
      this._nameIndex.set(name, opts.sessionId);
      return { next: registry, result: undefined };
    });
  }

  async updateSession(name: string, updates: Partial<Pick<Session, 'sessionId' | 'lastUsedAt' | 'label' | 'profileName'>>): Promise<void> {
    await this._repo.mutate((registry) => {
      // Records are keyed by sessionId; find the target by name.
      for (const record of Object.values(registry)) {
        if (record.name === name) {
          if (updates.sessionId !== undefined) record.sessionId = updates.sessionId;
          if (updates.lastUsedAt !== undefined) record.lastUsedAt = updates.lastUsedAt;
          if (updates.label !== undefined) record.label = updates.label?.substring(0, 60) || null;
          if (updates.profileName !== undefined) record.profileName = updates.profileName;
          break;
        }
      }
      return { next: registry, result: undefined };
    });
  }

  async lookupSession(name: string): Promise<Session | null> {
    const registry = await this._readWithIndex();
    const sid = this._nameIndex.get(name);
    if (!sid) return null;
    return registry[sid] ?? null;
  }

  async lookupBySessionId(sessionId: string): Promise<string | null> {
    const registry = await this._repo.read();
    const record = registry[sessionId];
    return record?.name ?? null;
  }

  async listRecentSessions(limit = 10): Promise<Session[]> {
    const registry = await this._repo.read();
    return Object.values(registry)
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, limit);
  }

  /** Return a session by sessionId, or null if not found. O(1) key lookup. */
  async getById(sessionId: string): Promise<Session | null> {
    const registry = await this._repo.read();
    return registry[sessionId] ?? null;
  }

  /** List sessions belonging to a project, most recently used first. */
  async listByProject(projectId: string): Promise<Session[]> {
    const registry = await this._repo.read();
    return Object.values(registry)
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  /** List resumable (non-scheduled) sessions, optionally filtered by projectId. */
  async listResumable(projectId?: string): Promise<Session[]> {
    const registry = await this._repo.read();
    return Object.values(registry)
      .filter((s) => s.kind !== 'scheduled')
      .filter((s) => projectId === undefined || s.projectId === projectId)
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  /** Touch the lastUsedAt timestamp of a session to now. No-op if sessionId not found. */
  async markUsed(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await this._repo.mutate((registry) => {
      const record = registry[sessionId];
      if (record) record.lastUsedAt = now;
      return { next: registry, result: undefined };
    });
  }

  /**
   * Remove sessions whose lastUsedAt is older than maxAgeMs from now,
   * and are not referenced by any executionRepo or threadStore record.
   * Invokes the onPruneSession callback (if set) for each removed session.
   * Returns the number of removed sessions.
   */
  async pruneStale(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;

    // Build set of sessionIds still referenced by active records.
    const referencedSessionIds = new Set<string>();
    for (const exec of executionRepo.getAll()) {
      if (exec.session.sessionId) referencedSessionIds.add(exec.session.sessionId);
    }
    for (const thread of threadStore.getAll()) {
      for (const agent of Object.values(thread.agents)) {
        if (agent.sessionId) referencedSessionIds.add(agent.sessionId);
      }
      for (const step of thread.steps) {
        if (step.sessionId) referencedSessionIds.add(step.sessionId);
      }
    }

    const count = await this._repo.mutate((registry) => {
      let removed = 0;
      for (const [sid, record] of Object.entries(registry)) {
        const usedAt = new Date(record.lastUsedAt).getTime();
        if (usedAt < cutoff && !referencedSessionIds.has(sid)) {
          this._onPruneSession?.(sid);
          this._nameIndex.delete(record.name);
          delete registry[sid];
          removed++;
        }
      }
      return { next: registry, result: removed };
    });

    return count;
  }

  /** Set a callback to invoke when a session is pruned (e.g. cleanup backup files). */
  setOnPruneSession(fn: ((sessionId: string) => void) | null): void {
    this._onPruneSession = fn;
  }

  async getActiveSessionName(channel: string, backend: string): Promise<string | null> {
    const sessionId = await sessionRepo.getSessionAsync(channel, backend);
    if (!sessionId) return null;
    return this.lookupBySessionId(sessionId);
  }

  /** Drop the in-memory cache so the next read() fetches from disk. Test hook. */
  invalidate(): void {
    this._repo.invalidate();
    this._nameIndex.clear();
  }

  /** Wait for any in-flight mutate() to complete. For graceful SIGTERM drain. */
  flush(): Promise<void> {
    return this._repo.flush();
  }
}

export const sessionStore = new SessionRegistryRepo();
/** @deprecated Use `sessionStore` instead. Alias for backward compatibility. */
export const sessionRegistryRepo = sessionStore;
