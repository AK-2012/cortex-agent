// input:  useTranscript hook + MessageRow
// output: Scrollable transcript, anchored bottom, scroll-up freezes auto-scroll
// pos:    Main transcript view for M5 Ink client

import React, { useRef, useCallback, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Box, Text, useStdout } from 'ink';
import { MessageRow } from './MessageRow.js';
import { computeLineWindow, estimateLines, collectStreamText } from '../logic.js';
import type { RenderedMessage } from '../hooks/useTranscript.js';

// Rows reserved for header + input + status + borders/margins.
const RESERVED_ROWS = 10;
// Cap any single message's contribution so one very long entry (e.g. a replayed
// multi-line history message) can't dominate or overflow the viewport.
const MAX_MSG_LINES = 14;

/** All renderable text of a message (for line estimation). */
function messageText(msg: RenderedMessage): string {
  const parts: string[] = [];
  if (msg.text) parts.push(msg.text);
  if (msg.richBlocks) for (const b of msg.richBlocks) if (b.text) parts.push(String(b.text));
  if (msg.streams && msg.streams.size > 0) parts.push(collectStreamText(msg.streams));
  return parts.join('\n');
}

export interface TranscriptHandle {
  scrollUp: (page?: boolean) => void;
  scrollDown: (page?: boolean) => void;
  scrollToEnd: () => void;
}

interface TranscriptProps {
  messages: Map<string, RenderedMessage>;
  ids: string[];
}

export const Transcript = forwardRef<TranscriptHandle, TranscriptProps>(
  function Transcript({ messages, ids }: TranscriptProps, ref): React.JSX.Element {
    const { stdout } = useStdout();
    const [scrollOffset, setScrollOffset] = useState(0);
    const userScrolledUpRef = useRef(false);

    // Line budget (not message count) the transcript can show without overflowing.
    const rows = stdout?.rows ?? 24;
    const cols = stdout?.columns ?? 80;
    const lineBudget = Math.max(3, rows - RESERVED_ROWS);
    const maxChars = MAX_MSG_LINES * cols;

    const scrollUp = useCallback((page = false) => {
      userScrolledUpRef.current = true;
      setScrollOffset(prev => prev + (page ? 10 : 1));
    }, []);

    const scrollDown = useCallback((page = false) => {
      setScrollOffset(prev => {
        const next = prev - (page ? 10 : 1);
        if (next <= 0) {
          userScrolledUpRef.current = false;
          return 0;
        }
        return next;
      });
    }, []);

    const scrollToEnd = useCallback(() => {
      userScrolledUpRef.current = false;
      setScrollOffset(0);
    }, []);

    useImperativeHandle(ref, () => ({ scrollUp, scrollDown, scrollToEnd }), [scrollUp, scrollDown, scrollToEnd]);

    // Auto-stick to bottom on new messages unless the user has scrolled up.
    useEffect(() => {
      if (!userScrolledUpRef.current && scrollOffset !== 0) {
        setScrollOffset(0);
      }
    }, [ids.length]);

    // Bottom-anchored, line-aware window: each message's estimated height (capped per
    // message) is summed from the bottom up until the line budget is exhausted.
    const lineCounts = ids.map((id) => {
      const m = messages.get(id);
      if (!m) return 1;
      return Math.min(MAX_MSG_LINES, estimateLines(messageText(m), cols)) + 1; // +1 marginBottom
    });
    const { start, end } = computeLineWindow(lineCounts, lineBudget, scrollOffset);
    const visibleIds = ids.slice(start, end);
    const hiddenAbove = start;

    if (ids.length === 0) {
      // Empty transcript renders nothing (no "— no messages —" placeholder); the
      // flexGrow box still reserves the space so the input stays anchored at the bottom.
      return <Box flexDirection="column" flexGrow={1} />;
    }

    return (
      <Box flexDirection="column" flexGrow={1}>
        {/* Scroll hint (messages hidden above the viewport) */}
        {hiddenAbove > 0 ? (
          <Text dimColor>↑ {hiddenAbove} more above</Text>
        ) : null}

        {visibleIds.map((id) => {
          const msg = messages.get(id);
          if (!msg) return null;
          return <MessageRow key={id} message={msg} maxChars={maxChars} />;
        })}
      </Box>
    );
  },
);
