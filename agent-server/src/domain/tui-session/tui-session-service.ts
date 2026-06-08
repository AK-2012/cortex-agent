// input:  TuiSessionDeps
// output: createTuiSessionService(deps): TuiSessionService — transport-agnostic TUI session lifecycle
// pos:    owns session handshake/resume/switch logic formerly in tui-gateway.ts

import * as crypto from 'node:crypto';
import type { TuiSessionDeps, TuiSessionService, HandshakeResolution, SwitchResolution } from './types.js';
import type { TranscriptData, TranscriptTurn } from '@platform/adapters/tui/ports.js';

// ── Internal helpers ─────────────────────────────────────────────

async function createFresh(
  deps: TuiSessionDeps,
  conduitId: string,
  projectId: string,
): Promise<SwitchResolution> {
  const sessionName = await deps.sessionStore.generateSessionName();
  const sessionId = crypto.randomUUID();
  await deps.sessionStore.registerSession(sessionName, {
    sessionId,
    channel: conduitId,
    backend: 'tui',
    kind: 'local',
    projectId,
  });
  await deps.conversationLedger.initConversation(conduitId, {
    sessionId,
    sessionName,
    backend: 'tui',
  });
  return { sessionId, sessionName, projectId, isFresh: true, transcript: null };
}

async function assembleTranscript(
  deps: TuiSessionDeps,
  sessionId: string,
): Promise<TranscriptData | null> {
  const sessionName = await deps.sessionStore.lookupBySessionId(sessionId);
  if (!sessionName) return null;

  const session = await deps.sessionStore.getById(sessionId);
  if (!session) return null;

  const channel = session.channel;
  const conv = await deps.conversationLedger.getConversation(channel);
  if (!conv || conv.turns.length === 0) return null;

  const turns: TranscriptTurn[] = conv.turns.map((turn) => ({
    userMessageTs: turn.userMessageTs,
    userMessageText: turn.userMessageText,
    responseMessageTimestamps: turn.responseMessageTimestamps,
    status: turn.status,
  }));

  return { sessionId, channel, turns };
}

// ── Factory ──────────────────────────────────────────────────────

export function createTuiSessionService(deps: TuiSessionDeps): TuiSessionService {
  return {
    async resolveHandshake({ conduitId, projectId, resumeSessionId }): Promise<HandshakeResolution> {
      if (resumeSessionId) {
        const sessionName = await deps.sessionStore.lookupBySessionId(resumeSessionId);
        if (sessionName) {
          // Session found — attach with replay
          const session = await deps.sessionStore.getById(resumeSessionId);
          const activeProjectId = session?.projectId ?? projectId;
          const transcript = await assembleTranscript(deps, resumeSessionId);
          return {
            sessionId: resumeSessionId,
            sessionName,
            projectId: activeProjectId,
            isFresh: false,
            emitNotFoundError: false,
            transcript,
          };
        } else {
          // Session not found — fresh fallback with error
          const fresh = await createFresh(deps, conduitId, projectId);
          return { ...fresh, emitNotFoundError: true };
        }
      }
      // Fresh session
      const fresh = await createFresh(deps, conduitId, projectId);
      return { ...fresh, emitNotFoundError: false };
    },

    async switchSession({ conduitId, projectId, sessionId }): Promise<SwitchResolution> {
      if (sessionId) {
        const sessionName = await deps.sessionStore.lookupBySessionId(sessionId);
        const session = await deps.sessionStore.getById(sessionId);
        const resolvedProjectId = session?.projectId ?? projectId;

        if (sessionName) {
          // Attach to existing session — switch clears turns before assemble
          await deps.conversationLedger.switchSession(conduitId, {
            sessionId,
            sessionName,
            backend: 'tui',
          });
          const transcript = await assembleTranscript(deps, sessionId);
          return {
            sessionId,
            sessionName,
            projectId: resolvedProjectId,
            isFresh: false,
            transcript,
          };
        } else {
          // Session not found — create fresh (uses incoming projectId, not resolvedProjectId)
          const fresh = await createFresh(deps, conduitId, projectId);
          return { ...fresh };
        }
      }
      // No sessionId — fresh
      const fresh = await createFresh(deps, conduitId, projectId);
      return { ...fresh };
    },
  };
}
