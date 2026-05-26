// input:  useTranscript hook + MessageRow
// output: Scrollable transcript, anchored bottom, scroll-up freezes auto-scroll
// pos:    Main transcript view for M5 Ink client

import React, { useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Box, Text } from 'ink';
import { MessageRow } from './MessageRow.js';
import type { RenderedMessage } from '../hooks/useTranscript.js';

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
    const [scrollOffset, setScrollOffset] = useState(0);
    const userScrolledUpRef = useRef(false);

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

    // Calculate visible window
    const visibleIds = scrollOffset > 0
      ? ids.slice(0, Math.max(0, ids.length - scrollOffset))
      : ids;

    if (ids.length === 0) {
      return (
        <Box flexDirection="column" flexGrow={1}>
          <Text dimColor>— no messages —</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" flexGrow={1}>
        {visibleIds.map((id) => {
          const msg = messages.get(id);
          if (!msg) return null;
          return <MessageRow key={id} message={msg} />;
        })}

        {/* Scroll hint */}
        {scrollOffset > 0 ? (
          <Text dimColor>↑ {scrollOffset} more</Text>
        ) : null}
      </Box>
    );
  },
);
