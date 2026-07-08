// input:  UiServiceDeps + { sessionId, text }
// output: handleSendSession → Ok<{accepted:true}> | Err
// pos:    mutate handler for 'sessions.send' (S4 chat)
//
// Injects a genuine user turn into an existing session. Resolves the session's conduit/channel
// (via sessionStore) and hands off to the injected `sendSessionMessage` callback, which is wired
// in the entry layer to the orchestration send path (agentRunner.route). Fire-and-forget: the
// assistant reply returns over the `session.message` stream event, NOT this return.

import type { UiServiceDeps, Result, SessionsSendArgs, SessionsSendReturn } from '../types.js';

export async function handleSendSession(
  deps: UiServiceDeps,
  args: SessionsSendArgs,
): Promise<Result<SessionsSendReturn>> {
  const session = await deps.sessionStore.getById(args.sessionId);
  if (!session) {
    return { ok: false, code: 'not-found', message: `Session not found: ${args.sessionId}` };
  }
  deps.sendSessionMessage({ sessionId: args.sessionId, channel: session.channel, text: args.text });
  return { ok: true, data: { accepted: true } };
}
