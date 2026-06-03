// input:  useTranscript hook + MessageRow
// output: Scrollable transcript, anchored bottom, scroll-up freezes auto-scroll
// pos:    Main transcript view for M5 Ink client

import React, { useRef, useCallback, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Box, Text, useStdout } from 'ink';
import { MessageRow } from './MessageRow.js';
import { computeVisibleWindow } from '../logic.js';
import type { RenderedMessage } from '../hooks/useTranscript.js';

// Rows reserved for header + input + status + borders/margins.
const RESERVED_ROWS = 10;

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

    // Approximate how many message rows fit in the terminal.
    const rows = stdout?.rows ?? 24;
    const visibleCount = Math.max(3, rows - RESERVED_ROWS);

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

    // Bottom-anchored visible window.
    const { start, end } = computeVisibleWindow(ids.length, visibleCount, scrollOffset);
    const visibleIds = ids.slice(start, end);
    const hiddenAbove = start;

    if (ids.length === 0) {
      return (
        <Box flexDirection="column" flexGrow={1}>
          <Text dimColor>— no messages —</Text>
        </Box>
      );
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
          return <MessageRow key={id} message={msg} />;
        })}
      </Box>
    );
  },
);
