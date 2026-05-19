// input:  session-registry.json + session metadata
// output: thin re-export — all functionality delegated to store/session-registry-repo.ts
// pos:    cortex-XXXX short name ↔ session UUID registry (thin re-export layer)
// TODO: S12 — delete this file after physical move to store/ directory.
//       All callers in src/ have been migrated to store/session-registry-repo.ts.
//       This file is kept only so any external tooling that still imports this path
//       continues to compile until the S12 git-mv sweep.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { sessionRegistryRepo } from '@store/session-registry-repo.js';
export { sessionRegistryRepo, type SessionRecord, type SessionRegistryData } from '@store/session-registry-repo.js';

export function generateSessionName(): Promise<string> {
  return sessionRegistryRepo.generateSessionName();
}

export function registerSession(name: string, opts: { sessionId: string; channel: string; backend: string; kind: 'local' | 'scheduled'; label?: string | null; profileName?: string | null }): Promise<void> {
  return sessionRegistryRepo.registerSession(name, opts);
}

export function updateSession(name: string, updates: { sessionId?: string; lastUsedAt?: string; label?: string | null }): Promise<void> {
  return sessionRegistryRepo.updateSession(name, updates);
}

export function lookupSession(name: string) {
  return sessionRegistryRepo.lookupSession(name);
}

export function lookupBySessionId(sessionId: string) {
  return sessionRegistryRepo.lookupBySessionId(sessionId);
}

export function listRecentSessions(limit = 10) {
  return sessionRegistryRepo.listRecentSessions(limit);
}

export function getActiveSessionName(channel: string, backend: string) {
  return sessionRegistryRepo.getActiveSessionName(channel, backend);
}
