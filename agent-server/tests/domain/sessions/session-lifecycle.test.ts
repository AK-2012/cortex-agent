import '../../_test-home.js';
import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import { registerNamedSession, attachExistingSession, resetChannelSession, SESSION_BACKENDS } from '@domain/sessions/session-lifecycle.js';
import type { SessionRegistryWriter } from '@domain/sessions/session-lifecycle.js';
import { setSessionAsync, getSessionAsync } from '@domain/sessions/session.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import { getActiveProfile } from '@domain/agents/index.js';

// ── registerNamedSession ────────────────────────────────────────

describe('registerNamedSession', () => {
  it('calls generateSessionName and registerSession with kind:local by default, label/profileName null when omitted', async () => {
    let generateCount = 0;
    let registered: any = null;

    const fakeStore: SessionRegistryWriter = {
      generateSessionName: async () => { generateCount++; return 'cortex-fake'; },
      registerSession: async (name, opts) => { registered = { name, ...opts }; },
    };

    const name = await registerNamedSession(fakeStore, {
      sessionId: 'sid-1',
      channel: 'c1-reg-default',
      backend: 'claude',
      projectId: 'proj-x',
    });

    assert.strictEqual(generateCount, 1, 'generateSessionName called once');
    assert.strictEqual(name, 'cortex-fake', 'returns generated name');
    assert.ok(registered, 'registerSession was called');
    assert.strictEqual(registered.name, 'cortex-fake');
    assert.strictEqual(registered.sessionId, 'sid-1');
    assert.strictEqual(registered.channel, 'c1-reg-default');
    assert.strictEqual(registered.backend, 'claude');
    assert.strictEqual(registered.kind, 'local', 'default kind is local');
    assert.strictEqual(registered.projectId, 'proj-x');
    assert.strictEqual(registered.label, null, 'default label is null');
    assert.strictEqual(registered.profileName, null, 'default profileName is null');
  });

  it('passes through label and profileName when provided', async () => {
    let registered: any = null;

    const fakeStore: SessionRegistryWriter = {
      generateSessionName: async () => 'cortex-labeld',
      registerSession: async (name, opts) => { registered = { name, ...opts }; },
    };

    await registerNamedSession(fakeStore, {
      sessionId: 'sid-2',
      channel: 'c1-reg-label',
      backend: 'pi',
      projectId: 'proj-y',
      kind: 'scheduled',
      label: 'my-label',
      profileName: 'my-profile',
    });

    assert.strictEqual(registered.kind, 'scheduled');
    assert.strictEqual(registered.label, 'my-label');
    assert.strictEqual(registered.profileName, 'my-profile');
  });
});

// ── attachExistingSession ───────────────────────────────────────

describe('attachExistingSession', () => {
  it('switches session in sessions.json and conversation ledger (profileName null)', async () => {
    const channel = 'c1-attach';
    const opts = { sessionId: 'sid-attach', sessionName: 'cortex-y', backend: 'claude', profileName: null };

    await attachExistingSession(channel, opts);

    const storedId = await getSessionAsync(channel, 'claude');
    assert.strictEqual(storedId, 'sid-attach', 'sessions.json points at the session');

    const conv = await conversationLedger.getConversation(channel);
    assert.ok(conv, 'conversation ledger has an entry');
    assert.strictEqual(conv!.sessionId, 'sid-attach');
    assert.strictEqual(conv!.sessionName, 'cortex-y');
    assert.strictEqual(conv!.backend, 'claude');
  });

  it('restores the active profile when profileName is provided', async () => {
    const channel = 'c1-attach-profile';
    await attachExistingSession(channel, {
      sessionId: 'sid-attach-p', sessionName: 'cortex-p', backend: 'claude', profileName: 'qa',
    });

    assert.strictEqual(getActiveProfile(channel), 'qa', 'active profile restored to the session profile');
    const conv = await conversationLedger.getConversation(channel);
    assert.strictEqual(conv!.profileName, 'qa', 'ledger carries the restored profile');
  });
});

// ── resetChannelSession ─────────────────────────────────────────

describe('resetChannelSession', () => {
  it('clears all backend sessions, cleans backups, and clears conversation ledger', async () => {
    const channel = 'c1-reset';

    // Seed: write sessions for all backends + init conversation
    await setSessionAsync(channel, 'sid-reset-claude', 'claude');
    await setSessionAsync(channel, 'sid-reset-pi', 'pi');
    await setSessionAsync(channel, 'sid-reset-codex', 'codex');
    await conversationLedger.initConversation(channel, {
      sessionId: 'sid-reset-claude',
      sessionName: 'cortex-reset',
      backend: 'claude',
    });

    // Confirm seeded state
    for (const b of SESSION_BACKENDS) {
      const sid = await getSessionAsync(channel, b);
      assert.ok(sid, `session exists for backend ${b} before reset`);
    }
    const convBefore = await conversationLedger.getConversation(channel);
    assert.ok(convBefore, 'conversation exists before reset');

    await resetChannelSession(channel);

    // Assert: all backends cleared
    for (const b of SESSION_BACKENDS) {
      const sid = await getSessionAsync(channel, b);
      assert.strictEqual(sid, undefined, `session cleared for backend ${b}`);
    }

    // Assert: conversation cleared
    const convAfter = await conversationLedger.getConversation(channel);
    assert.strictEqual(convAfter, null, 'conversation cleared');
  });
});
