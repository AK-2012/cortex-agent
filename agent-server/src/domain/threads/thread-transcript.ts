// input:  conversation-history-repo (summarizeToolInputForHistory), a thread step's streamed events
// output: createStepTranscriptBuffer + flushStepTranscript + HistoryWriter/StepTranscriptEvent types
// pos:    records a thread step's FULL conversation transcript into conversation-history, so thread
//         sessions render in the UI (sessions.transcript). A thread step's sessionId is only known
//         AFTER the agent runs, so events are buffered during the step and flushed keyed by the
//         resolved sessionId. Mirrors the direct path's per-event appends (agent-runner).
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { summarizeToolInputForHistory } from '@store/conversation-history-repo.js';

/** The subset of ConversationHistoryRepo the flush needs — injectable for tests. */
export interface HistoryWriter {
  appendUser(sessionId: string, opts: { text: string }): Promise<void>;
  appendAssistant(sessionId: string, opts: { text: string }): Promise<void>;
  appendTool(sessionId: string, opts: { toolName: string; toolInput?: string }): Promise<void>;
}

/** A buffered step event (assistant text or a tool call). */
export interface StepTranscriptEvent {
  role: 'assistant' | 'tool';
  text?: string;
  toolName?: string;
  toolInput?: string;
}

/** One persisted transcript event, passed to the optional live-publish callback. */
export interface PersistedTranscriptEvent {
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  toolName?: string;
  toolInput?: string;
}

export interface StepTranscriptBuffer {
  readonly events: StepTranscriptEvent[];
  recordAssistant(text: string): void;
  recordTool(name: string, input: any): void;
}

/** Create an in-memory buffer for a single thread step. The step's streamed assistant messages
 *  and tool calls are appended here (in emission order) and flushed once the step's sessionId is
 *  known. Tool inputs are summarized on capture (same rule as the direct path). */
export function createStepTranscriptBuffer(): StepTranscriptBuffer {
  const events: StepTranscriptEvent[] = [];
  return {
    events,
    recordAssistant(text: string): void {
      events.push({ role: 'assistant', text });
    },
    recordTool(name: string, input: any): void {
      events.push({ role: 'tool', toolName: name, toolInput: summarizeToolInputForHistory(input) });
    },
  };
}

/** Persist a completed step's transcript keyed by its resolved sessionId. The step prompt opens
 *  the turn (appendUser), then the buffered assistant/tool events flush in emission order. The
 *  optional onEvent callback fires per persisted event (incl. the opening user turn) for live UI
 *  publishing. Writes are awaited in order so the JSONL line order matches emission order. */
export async function flushStepTranscript(
  history: HistoryWriter,
  sessionId: string,
  prompt: string,
  buffer: StepTranscriptBuffer,
  onEvent?: (ev: PersistedTranscriptEvent) => void,
): Promise<void> {
  await history.appendUser(sessionId, { text: prompt });
  onEvent?.({ role: 'user', text: prompt });

  for (const ev of buffer.events) {
    if (ev.role === 'assistant') {
      await history.appendAssistant(sessionId, { text: ev.text ?? '' });
      onEvent?.({ role: 'assistant', text: ev.text ?? '' });
    } else {
      await history.appendTool(sessionId, { toolName: ev.toolName ?? '', toolInput: ev.toolInput ?? '' });
      onEvent?.({ role: 'tool', toolName: ev.toolName ?? '', toolInput: ev.toolInput ?? '' });
    }
  }
}
