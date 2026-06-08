// input:  protocol types + ports types
// output: buildTranscriptReplay — pure synchronous formatter, TranscriptData → TranscriptReplay | null
// pos:    TUI adapter — replays prior chat messages as TranscriptReplay frames
//         ZERO @store/@domain/@orch imports (see ports.ts for boundary types)
// >>> If I am updated, update the folder's CORTEX.md <<<

import type {
  ChatPost,
  ChatUpdate,
  InteractivePost,
  TranscriptReplay,
} from '../../tui/protocol.js';
import type { MessageRef } from '../../types.js';
import type { TranscriptData } from './ports.js';

/**
 * Build a TranscriptReplay frame from transcript data.
 * Pure synchronous formatter — no store/IO dependencies.
 * Returns null when there are no replayable items.
 */
export function buildTranscriptReplay(
  data: TranscriptData,
): TranscriptReplay | null {
  const { sessionId, channel, turns } = data;

  const items: Array<ChatPost | ChatUpdate | InteractivePost> = [];
  let seq = 0;

  for (const turn of turns) {
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
