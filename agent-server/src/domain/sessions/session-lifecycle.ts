// input:  session-registry-repo (sessionStore), session-repo (sessions.json), conversation-ledger-repo, session-backup, setActiveProfile
// output: registerNamedSession / attachExistingSession / resetChannelSession — shared session lifecycle primitives
// pos:    domain/sessions — centralized session lifecycle for agent-runner, tui-session-service, and commands/session

import { setSessionAsync, deleteSessionAsync } from './session.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import { setActiveProfile } from '@domain/agents/index.js';
import * as sessionBackup from './session-backup.js';

export const SESSION_BACKENDS = ['claude', 'pi', 'codex'] as const;

export interface SessionRegistryWriter {
  generateSessionName(): Promise<string>;
  registerSession(name: string, opts: {
    sessionId: string; channel: string; backend: string;
    kind: 'local' | 'scheduled'; projectId: string;
    label?: string | null; profileName?: string | null;
  }): Promise<void>;
}

export interface RegisterNamedSessionOpts {
  sessionId: string;
  channel: string;
  backend: string;
  projectId: string;
  kind?: 'local' | 'scheduled';
  label?: string | null;
  profileName?: string | null;
}

/** Generate a fresh session name and register a registry record for sessionId. Returns the name.
 *  Centralizes the generateSessionName + registerSession pairing used by inbound-message session
 *  creation (agent-runner) and TUI fresh-session creation. */
export async function registerNamedSession(store: SessionRegistryWriter, opts: RegisterNamedSessionOpts): Promise<string> {
  const name = await store.generateSessionName();
  await store.registerSession(name, {
    sessionId: opts.sessionId,
    channel: opts.channel,
    backend: opts.backend,
    kind: opts.kind ?? 'local',
    projectId: opts.projectId,
    label: opts.label ?? null,
    profileName: opts.profileName ?? null,
  });
  return name;
}

export interface AttachExistingSessionOpts {
  sessionId: string;
  sessionName: string;
  backend: string;
  profileName?: string | null;
}

/** Attach a channel to an existing session: restore its profile (if any), point sessions.json at it,
 *  and switch the conversation ledger. Mirrors the !resume switch sequence. */
export async function attachExistingSession(channel: string, opts: AttachExistingSessionOpts): Promise<void> {
  if (opts.profileName) setActiveProfile(opts.profileName, channel);
  await setSessionAsync(channel, opts.sessionId, opts.backend);
  await conversationLedger.switchSession(channel, {
    sessionId: opts.sessionId, sessionName: opts.sessionName, backend: opts.backend, profileName: opts.profileName,
  });
}

/** Clear a channel's session state: drop sessions.json keys for every backend, clean session
 *  backups, and clear the conversation ledger. Mirrors the store-level half of !new. */
export async function resetChannelSession(channel: string): Promise<void> {
  const conv = await conversationLedger.getConversation(channel);
  if (conv) {
    sessionBackup.cleanupAllBackups(conv.sessionId);
    await conversationLedger.clearConversation(channel);
  }
  await Promise.all(SESSION_BACKENDS.map(b => deleteSessionAsync(channel, b).catch(() => {})));
}
