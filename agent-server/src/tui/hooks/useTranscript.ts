// input:  src/platform/tui/protocol.js
// output: Transcript state hook — Map<messageId, RenderedMessage> for O(1) updates, parallel id[] for insertion order
// pos:    Core data model for M5 Ink client transcript rendering

import { useRef, useCallback, useState } from 'react';
import type {
  ChatPost, ChatUpdate, ChatDelete, ChatMarkQueued,
  StreamText, StreamMutableOpen, StreamMutableUpdate, StreamFlush,
  ModalOpen, ModalAck,
  TuiFrame,
} from '../../platform/tui/protocol.js';
import { isChatPost, isChatUpdate, isChatDelete, isChatMarkQueued,
  isStreamText, isStreamMutableOpen, isStreamMutableUpdate, isStreamFlush,
  isTranscriptReplay, isInteractivePost, isModalOpen, isModalAck } from '../../platform/tui/protocol.js';

// ── Types ──

export interface StreamState {
  segments: string[];
  mutable: Map<string, string>;
}

export interface RenderedMessage {
  messageId: string;
  text: string;
  richBlocks?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  queued: boolean;
  streams: Map<string, StreamState>;
}

interface TranscriptState {
  messages: Map<string, RenderedMessage>;
  ids: string[];
}

// ── Batch coalescing config ──

const BATCH_WINDOW_MS = 30;

// ── Hook ──

export function useTranscript(opts?: {
  onModalOpen?: (frame: ModalOpen) => void;
  onModalAck?: (frame: ModalAck) => void;
}) {
  const [state, setState] = useState<TranscriptState>(() => ({
    messages: new Map(),
    ids: [],
  }));

  // Modal callbacks stored in refs for stable dispatch identity
  const onModalOpenRef = useRef(opts?.onModalOpen);
  onModalOpenRef.current = opts?.onModalOpen;
  const onModalAckRef = useRef(opts?.onModalAck);
  onModalAckRef.current = opts?.onModalAck;

  // Batcher refs
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBatch = useRef<(() => void) | null>(null);

  // Flush batched updates
  const flushBatch = useCallback(() => {
    if (batchTimerRef.current !== null) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    if (pendingBatch.current) {
      pendingBatch.current();
      pendingBatch.current = null;
    }
  }, []);

  // Schedule a batched state update (for stream.text coalescing)
  const scheduleBatch = useCallback((fn: () => void) => {
    pendingBatch.current = fn;
    if (batchTimerRef.current === null) {
      batchTimerRef.current = setTimeout(() => {
        batchTimerRef.current = null;
        if (pendingBatch.current) {
          pendingBatch.current();
          pendingBatch.current = null;
        }
      }, BATCH_WINDOW_MS);
    }
  }, []);

  // ── Frame dispatch ──

  const dispatch = useCallback((frame: TuiFrame) => {
    if (isChatPost(frame)) {
      setState(prev => _handleChatPost(prev, frame));
      flushBatch(); // flush any pending stream batches on new message
      return;
    }

    if (isChatUpdate(frame)) {
      setState(prev => _handleChatUpdate(prev, frame));
      return;
    }

    if (isChatDelete(frame)) {
      setState(prev => _handleChatDelete(prev, frame));
      return;
    }

    if (isChatMarkQueued(frame)) {
      setState(prev => _handleChatMarkQueued(prev, frame));
      return;
    }

    if (isStreamText(frame)) {
      scheduleBatch(() => {
        setState(prev => _handleStreamText(prev, frame));
      });
      return;
    }

    if (isStreamMutableOpen(frame)) {
      flushBatch(); // render immediately
      setState(prev => _handleStreamMutableOpen(prev, frame));
      return;
    }

    if (isStreamMutableUpdate(frame)) {
      flushBatch(); // render immediately
      setState(prev => _handleStreamMutableUpdate(prev, frame));
      return;
    }

    if (isStreamFlush(frame)) {
      // no-op marker — ordering signal for tests
      return;
    }

    if (isTranscriptReplay(frame)) {
      flushBatch();
      setState(prev => {
        let next = prev;
        for (const item of frame.items) {
          next = _handleChatPost(next, item as ChatPost);
        }
        return next;
      });
      return;
    }

    // Phase 2 placeholders — render as text, never crash
    if (isInteractivePost(frame)) {
      setState(prev => _handlePhase2Placeholder(prev, frame.ref.messageId, '[interactive] Phase 2'));
      return;
    }

    if (isModalOpen(frame)) {
      onModalOpenRef.current?.(frame);
      return;
    }

    if (isModalAck(frame)) {
      onModalAckRef.current?.(frame);
      return;
    }
  }, [flushBatch, scheduleBatch]);

  // ── Clear ──

  const clear = useCallback(() => {
    flushBatch();
    setState({ messages: new Map(), ids: [] });
  }, [flushBatch]);

  // ── Message count (for status line) ──

  const messageCount = state.ids.length;

  return {
    messages: state.messages,
    ids: state.ids,
    messageCount,
    dispatch,
    clear,
    flushBatch,
  };
}

// ── Pure state helpers (exported for testing) ──

export function _handleChatPost(prev: TranscriptState, frame: ChatPost): TranscriptState {
  const messageId = frame.ref.messageId;
  if (prev.messages.has(messageId)) return prev; // dedup

  const msg: RenderedMessage = {
    messageId,
    text: frame.content.text,
    richBlocks: frame.content.richBlocks as Array<{ type: string; text?: string; [key: string]: unknown }> | undefined,
    queued: false,
    streams: new Map(),
  };

  const messages = new Map(prev.messages);
  messages.set(messageId, msg);
  const ids = [...prev.ids, messageId];
  return { messages, ids };
}

export function _handleChatUpdate(prev: TranscriptState, frame: ChatUpdate): TranscriptState {
  const messageId = frame.ref.messageId;
  const existing = prev.messages.get(messageId);
  if (!existing) return prev;

  const msg: RenderedMessage = {
    ...existing,
    text: frame.content.text,
    richBlocks: frame.content.richBlocks as Array<{ type: string; text?: string; [key: string]: unknown }> | undefined,
  };

  const messages = new Map(prev.messages);
  messages.set(messageId, msg);
  return { messages, ids: prev.ids };
}

export function _handleChatDelete(prev: TranscriptState, frame: ChatDelete): TranscriptState {
  const messageId = frame.ref.messageId;
  if (!prev.messages.has(messageId)) return prev;

  const messages = new Map(prev.messages);
  messages.delete(messageId);
  const ids = prev.ids.filter(id => id !== messageId);
  return { messages, ids };
}

export function _handleChatMarkQueued(prev: TranscriptState, frame: ChatMarkQueued): TranscriptState {
  const messageId = frame.ref.messageId;
  const existing = prev.messages.get(messageId);
  if (!existing) return prev;

  const msg = { ...existing, queued: true };
  const messages = new Map(prev.messages);
  messages.set(messageId, msg);
  return { messages, ids: prev.ids };
}

export function _handlePhase2Placeholder(prev: TranscriptState, messageId: string, text: string): TranscriptState {
  if (prev.messages.has(messageId)) return prev;
  const msg: RenderedMessage = {
    messageId,
    text,
    queued: false,
    streams: new Map(),
  };
  const messages = new Map(prev.messages);
  messages.set(messageId, msg);
  const ids = [...prev.ids, messageId];
  return { messages, ids };
}

export function _handleStreamText(prev: TranscriptState, frame: StreamText): TranscriptState {
  const streamId = frame.streamId;
  // Find the message that owns this stream (last message with this streamId)
  const messages = new Map(prev.messages);
  let found = false;

  for (const [mid, msg] of messages) {
    if (msg.streams.has(streamId)) {
      const stream = msg.streams.get(streamId)!;
      stream.segments = [...stream.segments, frame.text];
      messages.set(mid, { ...msg, streams: new Map(msg.streams) });
      found = true;
      break;
    }
  }

  if (!found) {
    // No existing stream — try to find the message that matches the text context
    // As a fallback, add stream to the last message
    const lastId = prev.ids[prev.ids.length - 1];
    if (lastId) {
      const lastMsg = messages.get(lastId)!;
      const streams = new Map(lastMsg.streams);
      streams.set(streamId, { segments: [frame.text], mutable: new Map() });
      messages.set(lastId, { ...lastMsg, streams });
    }
  }

  return { messages, ids: prev.ids };
}

export function _handleStreamMutableOpen(prev: TranscriptState, frame: StreamMutableOpen): TranscriptState {
  const streamId = frame.streamId;
  const messages = new Map(prev.messages);

  for (const [mid, msg] of messages) {
    const streams = new Map(msg.streams);
    const existing = streams.get(streamId);
    if (existing) {
      // Ensure region exists
      existing.mutable.set(frame.regionId, frame.text);
      streams.set(streamId, { ...existing });
      messages.set(mid, { ...msg, streams });
      return { messages, ids: prev.ids };
    }
  }

  // No existing stream — add to last message
  const lastId = prev.ids[prev.ids.length - 1];
  if (lastId) {
    const lastMsg = messages.get(lastId)!;
    const streams = new Map(lastMsg.streams);
    const mutable = new Map<string, string>();
    mutable.set(frame.regionId, frame.text);
    streams.set(streamId, { segments: [], mutable });
    messages.set(lastId, { ...lastMsg, streams });
  }

  return { messages, ids: prev.ids };
}

export function _handleStreamMutableUpdate(prev: TranscriptState, frame: StreamMutableUpdate): TranscriptState {
  const streamId = frame.streamId;
  const messages = new Map(prev.messages);

  for (const [mid, msg] of messages) {
    const stream = msg.streams.get(streamId);
    if (stream) {
      const newMutable = new Map(stream.mutable);
      newMutable.set(frame.regionId, frame.text);
      const newStreams = new Map(msg.streams);
      newStreams.set(streamId, { segments: stream.segments, mutable: newMutable });
      messages.set(mid, { ...msg, streams: newStreams });
      return { messages, ids: prev.ids };
    }
  }

  return prev;
}
