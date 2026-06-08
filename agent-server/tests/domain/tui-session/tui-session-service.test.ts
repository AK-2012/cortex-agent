// input:  tui-session-service.ts createTuiSessionService
// output: Lock down resolveHandshake and switchSession behavior: fresh, resume-found, resume-not-found,
//         switch-found, switch-not-found, switch-no-sessionId — matching the exact gateway logic.
// pos:    Task B3 — TUI adapter layering refactor

import test from 'node:test';
import assert from 'node:assert/strict';
import type { TuiSessionDeps, TuiSessionService } from '../../../src/domain/tui-session/types.js';
import { createTuiSessionService } from '../../../src/domain/tui-session/tui-session-service.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeFakeDeps(overrides?: Partial<TuiSessionDeps>): TuiSessionDeps & { _calls: string[] } {
  const sessions = new Map<string, { name: string; channel: string; projectId: string }>();
  const calls: string[] = [];

  const defaults: TuiSessionDeps = {
    sessionStore: {
      lookupBySessionId: async (id: string) => {
        calls.push(`lookupBySessionId(${id})`);
        const s = sessions.get(id);
        return s?.name ?? null;
      },
      getById: async (id: string) => {
        calls.push(`getById(${id})`);
        const s = sessions.get(id);
        return s ? { channel: s.channel, projectId: s.projectId } : null;
      },
      generateSessionName: async () => {
        calls.push('generateSessionName');
        return 'cortex-abc123';
      },
      registerSession: async (name: string, opts: { sessionId: string; channel: string; backend: string; kind: string; projectId: string }) => {
        calls.push(`registerSession(${name},${opts.sessionId},${opts.channel},${opts.projectId})`);
        sessions.set(opts.sessionId, { name, channel: opts.channel, projectId: opts.projectId });
      },
    },
    conversationLedger: {
      initConversation: async (channel: string, opts: { sessionId: string; sessionName: string; backend: string }) => {
        calls.push(`initConversation(${channel},${opts.sessionId})`);
      },
      switchSession: async (channel: string, opts: { sessionId: string; sessionName: string; backend: string }) => {
        calls.push(`switchSession(${channel},${opts.sessionId})`);
      },
      getConversation: async (channel: string) => {
        calls.push(`getConversation(${channel})`);
        return null;
      },
    },
  };

  return {
    sessionStore: { ...defaults.sessionStore, ...overrides?.sessionStore },
    conversationLedger: { ...defaults.conversationLedger, ...overrides?.conversationLedger },
    // Expose call log for test assertions
    _calls: calls,
  } as TuiSessionDeps & { _calls: string[] };
}

/** Seed a session into the fake store and return its sessionId. */
function seedSession(deps: TuiSessionDeps & { _calls: string[] }, overrides?: { name?: string; channel?: string; projectId?: string }): string {
  const sid = 'seed-' + Math.random().toString(36).slice(2, 10);
  const name = overrides?.name ?? 'cortex-seed';
  const channel = overrides?.channel ?? 'tui-conduit';
  const projectId = overrides?.projectId ?? 'general';
  // Directly inject into the fake store's internal state
  (deps.sessionStore as any)._seed?.(sid, name, channel, projectId);
  return sid;
}

// ── Tests ────────────────────────────────────────────────────────

test('resolveHandshake: fresh (no resumeSessionId)', async () => {
  const deps = makeFakeDeps();
  const svc: TuiSessionService = createTuiSessionService(deps);

  const result = await svc.resolveHandshake({ conduitId: 'tui-conduit', projectId: 'general' });

  assert.equal(result.isFresh, true, 'isFresh must be true');
  assert.equal(result.emitNotFoundError, false, 'emitNotFoundError must be false');
  assert.equal(result.transcript, null, 'transcript must be null');
  assert.ok(result.sessionId, 'sessionId must be set');
  assert.equal(result.sessionName, 'cortex-abc123');
  assert.equal(result.projectId, 'general');

  // Verify store calls and ordering
  assert.ok(deps._calls[0].startsWith('generateSessionName'), 'first call: generateSessionName');
  assert.ok(deps._calls[1].startsWith('registerSession'), 'second call: registerSession');
  assert.ok(deps._calls[2].startsWith('initConversation'), 'third call: initConversation');
});

test('resolveHandshake: resume-found', async () => {
  const deps = makeFakeDeps();
  // Pre-register session via store method
  await deps.sessionStore.registerSession('cortex-resume', {
    sessionId: 'resume-session-1',
    channel: 'tui-conduit-orig',
    backend: 'tui',
    kind: 'local',
    projectId: 'proj-x',
  });

  const svc: TuiSessionService = createTuiSessionService(deps);

  const result = await svc.resolveHandshake({
    conduitId: 'tui-conduit',
    projectId: 'general',
    resumeSessionId: 'resume-session-1',
  });

  assert.equal(result.isFresh, false, 'isFresh must be false');
  assert.equal(result.emitNotFoundError, false, 'emitNotFoundError must be false');
  assert.equal(result.sessionId, 'resume-session-1');
  assert.equal(result.sessionName, 'cortex-resume');
  assert.equal(result.projectId, 'proj-x', 'projectId from session registry, not fallback');
  assert.equal(result.transcript, null, 'transcript null when no turns'); // No seeded turns
});

test('resolveHandshake: resume-not-found', async () => {
  const deps = makeFakeDeps();
  const svc: TuiSessionService = createTuiSessionService(deps);

  const result = await svc.resolveHandshake({
    conduitId: 'tui-conduit',
    projectId: 'general',
    resumeSessionId: 'nonexistent-session',
  });

  assert.equal(result.isFresh, true, 'isFresh must be true');
  assert.equal(result.emitNotFoundError, true, 'emitNotFoundError must be true — resume not found creates fresh with error flag');
  assert.equal(result.sessionName, 'cortex-abc123');
  assert.equal(result.projectId, 'general');
  assert.ok(result.sessionId, 'sessionId must be set (fresh)');
  assert.equal(result.transcript, null, 'transcript null for fresh');
});

test('switchSession: found', async () => {
  const deps = makeFakeDeps();
  // Pre-register a session
  await deps.sessionStore.registerSession('cortex-switch', {
    sessionId: 'switch-session-1',
    channel: 'tui-conduit-other',
    backend: 'tui',
    kind: 'local',
    projectId: 'proj-y',
  });

  const svc: TuiSessionService = createTuiSessionService(deps);

  const result = await svc.switchSession({
    conduitId: 'tui-conduit',
    projectId: 'general',
    sessionId: 'switch-session-1',
  });

  assert.equal(result.isFresh, false, 'isFresh must be false');
  assert.equal(result.sessionId, 'switch-session-1');
  assert.equal(result.sessionName, 'cortex-switch');
  assert.equal(result.projectId, 'proj-y', 'projectId from session registry');
  assert.equal(result.transcript, null, 'transcript null when no turns');

  // switchSession must be called BEFORE assembleTranscript
  const switchCallIdx = deps._calls.findIndex(c => c.startsWith('switchSession'));
  assert.ok(switchCallIdx >= 0, 'switchSession must have been called');
  const getConvCallIdx = deps._calls.findIndex(c => c.startsWith('getConversation'));
  assert.ok(getConvCallIdx >= 0, 'getConversation must have been called');
  assert.ok(switchCallIdx < getConvCallIdx, 'switchSession must be called BEFORE getConversation (assembleTranscript)');

  // Ensure no emitNotFoundError on result
  assert.equal((result as any).emitNotFoundError, undefined, 'emitNotFoundError must not be present on SwitchResolution');
});

test('switchSession: not-found', async () => {
  const deps = makeFakeDeps();
  const svc: TuiSessionService = createTuiSessionService(deps);

  const result = await svc.switchSession({
    conduitId: 'tui-conduit',
    projectId: 'general',
    sessionId: 'nonexistent-switch',
  });

  assert.equal(result.isFresh, true, 'isFresh must be true');
  assert.equal(result.sessionName, 'cortex-abc123');
  assert.equal(result.projectId, 'general', 'switch-not-found uses raw projectId, not resolvedProjectId');
  assert.ok(result.sessionId, 'sessionId must be set (fresh)');
  assert.equal(result.transcript, null);

  // No emitNotFoundError
  assert.equal((result as any).emitNotFoundError, undefined, 'emitNotFoundError must not be present on SwitchResolution');
});

test('switchSession: no sessionId (fresh fallback)', async () => {
  const deps = makeFakeDeps();
  const svc: TuiSessionService = createTuiSessionService(deps);

  const result = await svc.switchSession({
    conduitId: 'tui-conduit',
    projectId: 'general',
    sessionId: null,
  });

  assert.equal(result.isFresh, true, 'isFresh must be true');
  assert.equal(result.sessionName, 'cortex-abc123');
  assert.equal(result.projectId, 'general');
  assert.ok(result.sessionId, 'sessionId must be set (fresh)');
  assert.equal(result.transcript, null);
  assert.equal((result as any).emitNotFoundError, undefined);
});

test('resolveHandshake: resume-found with transcript assembly', async () => {
  const deps = makeFakeDeps({
    conversationLedger: {
      initConversation: async () => {},
      switchSession: async () => {},
      getConversation: async (_channel: string) => {
        return {
          turns: [
            {
              userMessageTs: 'ts-1',
              userMessageText: 'hello',
              responseMessageTimestamps: ['ts-1a'],
              status: 'completed' as const,
            },
            {
              userMessageTs: 'ts-2',
              userMessageText: 'world',
              responseMessageTimestamps: ['ts-2a', 'ts-2b'],
              status: 'completed' as const,
            },
          ],
        };
      },
    },
  });
  // Register session
  await deps.sessionStore.registerSession('cortex-resume', {
    sessionId: 'resume-session-2',
    channel: 'tui-conduit',
    backend: 'tui',
    kind: 'local',
    projectId: 'proj-z',
  });

  const svc: TuiSessionService = createTuiSessionService(deps);
  const result = await svc.resolveHandshake({
    conduitId: 'tui-conduit',
    projectId: 'general',
    resumeSessionId: 'resume-session-2',
  });

  assert.equal(result.isFresh, false);
  assert.equal(result.sessionId, 'resume-session-2');
  assert.equal(result.sessionName, 'cortex-resume');

  assert.ok(result.transcript !== null, 'transcript must be populated');
  assert.equal(result.transcript!.sessionId, 'resume-session-2');
  assert.equal(result.transcript!.channel, 'tui-conduit');
  assert.equal(result.transcript!.turns.length, 2);
  assert.equal(result.transcript!.turns[0].userMessageText, 'hello');
  assert.equal(result.transcript!.turns[1].userMessageText, 'world');
  assert.deepEqual(result.transcript!.turns[0].responseMessageTimestamps, ['ts-1a']);
  assert.equal(result.transcript!.turns[0].status, 'completed');
});
