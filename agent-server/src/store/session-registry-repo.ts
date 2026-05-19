// input:  session-registry.json + JsonRepository
// output: SessionRegistryRepo (async generateSessionName / registerSession / updateSession / lookupSession / lookupBySessionId / listRecentSessions / getActiveSessionName)
// pos:    cortex-XXXX short name ↔ session UUID registry persistence layer (Pattern A, JsonRepository)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import * as crypto from 'crypto';
import { JsonRepository } from './json-repository.js';
import { STORE_DIR } from '@core/paths.js';
import { sessionRepo } from './session-repo.js';

export const REGISTRY_FILE = path.join(STORE_DIR, 'session-registry.json');

export interface SessionRecord {
  sessionId: string;
  channel: string;
  backend: string;
  kind: 'local' | 'scheduled';
  createdAt: string;
  lastUsedAt: string;
  label: string | null;
  /** Profile name active when the session was created. Restored on !resume. */
  profileName: string | null;
}

export type SessionRegistryData = Record<string, SessionRecord>;

export class SessionRegistryRepo {
  private readonly _repo: JsonRepository<SessionRegistryData>;

  constructor(filePath: string = REGISTRY_FILE) {
    this._repo = new JsonRepository<SessionRegistryData>({
      filePath,
      defaultValue: () => ({}),
      migrate: (raw) => (typeof raw === 'object' && raw !== null ? (raw as SessionRegistryData) : ({})),
    });
  }

  async generateSessionName(): Promise<string> {
    const registry = await this._repo.read();
    for (let i = 0; i < 100; i++) {
      const hex = crypto.randomBytes(3).toString('hex');
      const name = `cortex-${hex}`;
      if (!registry[name]) return name;
    }
    return `cortex-${crypto.randomBytes(4).toString('hex')}`;
  }

  async registerSession(name: string, opts: { sessionId: string; channel: string; backend: string; kind: 'local' | 'scheduled'; label?: string | null; profileName?: string | null }): Promise<void> {
    const now = new Date().toISOString();
    await this._repo.mutate((registry) => {
      registry[name] = {
        sessionId: opts.sessionId,
        channel: opts.channel,
        backend: opts.backend,
        kind: opts.kind,
        createdAt: now,
        lastUsedAt: now,
        label: opts.label?.substring(0, 60) || null,
        profileName: opts.profileName ?? null,
      };
      return { next: registry, result: undefined };
    });
  }

  async updateSession(name: string, updates: Partial<Pick<SessionRecord, 'sessionId' | 'lastUsedAt' | 'label' | 'profileName'>>): Promise<void> {
    await this._repo.mutate((registry) => {
      const record = registry[name];
      if (!record) return { next: registry, result: undefined };
      if (updates.sessionId !== undefined) record.sessionId = updates.sessionId;
      if (updates.lastUsedAt !== undefined) record.lastUsedAt = updates.lastUsedAt;
      if (updates.label !== undefined) record.label = updates.label?.substring(0, 60) || null;
      if (updates.profileName !== undefined) record.profileName = updates.profileName;
      return { next: registry, result: undefined };
    });
  }

  async lookupSession(name: string): Promise<SessionRecord | null> {
    const registry = await this._repo.read();
    return registry[name] || null;
  }

  async lookupBySessionId(sessionId: string): Promise<string | null> {
    const registry = await this._repo.read();
    for (const [name, record] of Object.entries(registry)) {
      if (record.sessionId === sessionId) return name;
    }
    return null;
  }

  async listRecentSessions(limit = 10): Promise<Array<{ name: string } & SessionRecord>> {
    const registry = await this._repo.read();
    return Object.entries(registry)
      .map(([name, record]) => ({ name, ...record }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
      .slice(0, limit);
  }

  async getActiveSessionName(channel: string, backend: string): Promise<string | null> {
    const sessionId = await sessionRepo.getSessionAsync(channel, backend);
    if (!sessionId) return null;
    return this.lookupBySessionId(sessionId);
  }

  /** Drop the in-memory cache so the next read() fetches from disk. Test hook. */
  invalidate(): void {
    this._repo.invalidate();
  }

  /** Wait for any in-flight mutate() to complete. For graceful SIGTERM drain. */
  flush(): Promise<void> {
    return this._repo.flush();
  }
}

export const sessionRegistryRepo = new SessionRegistryRepo();
