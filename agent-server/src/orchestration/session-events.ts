// input:  session-message payload + the shared EventBus (via job-registry ctx)
// output: publishSessionMessage — emits a `session.message` CortexEvent for the S4 chat live stream
// pos:    orch/ — published at the conversation-history append points in agent-runner. Reads the
//         bus from the shared job-registry ctx (same seam thread-callback uses), so the repo stays
//         bus-free (L1) and the publish lives in the orchestration layer. No-op if no bus is wired.

import { ctx as jobCtx } from '@domain/scheduling/job-registry.js';

export interface SessionMessagePayload {
  sessionId: string;
  channel: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  toolInput?: string;
}

export function publishSessionMessage(p: SessionMessagePayload): void {
  jobCtx.bus?.publish({
    type: 'session.message',
    sessionId: p.sessionId,
    channel: p.channel,
    role: p.role,
    text: p.text,
    ...(p.toolName !== undefined ? { toolName: p.toolName } : {}),
    ...(p.toolInput !== undefined ? { toolInput: p.toolInput } : {}),
  });
}
