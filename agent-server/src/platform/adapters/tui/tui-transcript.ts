// input:  sessionStore, conversationLedger, protocol types
// output: buildTranscriptReplay() — assemble transcript replay for session attach
// pos:    TUI adapter — replays prior chat messages as TranscriptReplay frames
// >>> If I am updated, update the folder's CORTEX.md <<<

import type {
  ChatPost,
  ChatUpdate,
  InteractivePost,
  TranscriptReplay,
} from '../../tui/protocol.js';
import { sessionStore } from '@store/session-registry-repo.js';
import { conversationLedger } from '@store/conversation-ledger-repo.js';
import { createLogger } from '@core/log.js';
import type { MessageRef, MessageContent, RichBlock, ActionElement } from '../../types.js';

const log = createLogger('tui-transcript');

/**
 * Build a TranscriptReplay frame for the given session.
 * Fetches conversation ledger turns and converts them to replay items.
 * Returns null if the session has no recorded conversation.
 */
export async function buildTranscriptReplay(
  sessionId: string,
): Promise<TranscriptReplay | null> {
  // Find the session record
  const sessionName = await sessionStore.lookupBySessionId(sessionId);
  if (!sessionName) return null;

  // Find the session's channel from the registry
  const session = await sessionStore.getById(sessionId);
  if (!session) return null;

  const channel = session.channel;
  const conv = await conversationLedger.getConversation(channel);
  if (!conv || conv.turns.length === 0) return null;

  const items: Array<ChatPost | ChatUpdate | InteractivePost> = [];
  let seq = 0;

  for (const turn of conv.turns) {
    // Skip processing turns
    if (turn.status === 'processing') continue;

    // The user message turn: render as a ChatPost
    const userRef: MessageRef = {
      conduit: channel,
      messageId: turn.userMessageTs,
      threadId: null,
    };
    items.push({
      type: 'chat.post',
      ref: userRef,
      content: { text: `**You:** ${turn.userMessageText}` },
      seq: ++seq,
    });

    // Response messages
    for (const responseTs of turn.responseMessageTimestamps) {
      const responseRef: MessageRef = {
        conduit: channel,
        messageId: responseTs,
        threadId: null,
      };
      items.push({
        type: 'chat.post',
        ref: responseRef,
        content: { text: `*(response)*` },
        seq: ++seq,
      });
    }
  }

  if (items.length === 0) return null;

  return {
    type: 'transcript.replay',
    sessionId,
    items,
    seqStart: 1,
    seqEnd: seq,
    isCatchUp: true,
  };
}
