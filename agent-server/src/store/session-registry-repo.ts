// input:  session-registry.json + JsonRepository
// output: SessionRegistryRepo (async generateSessionName / registerSession / updateSession / lookupSession / lookupBySessionId / listRecentSessions / getActiveSessionName)
// pos:    cortex-XXXX short name ↔ session UUID registry persistence layer (Pattern A, JsonRepository)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JsonRepository } from './json-repository.js';
import { STORE_DIR } from '@core/paths.js';
import { CHANNEL_REGISTRY_FILE } from './channel-repo.js';
import { sessionRepo } from './session-repo.js';

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
    const registry = await this._repo.read();
    for (const record of Object.values(registry)) {
      if (record.name === name) return record;
    }
    return null;
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
