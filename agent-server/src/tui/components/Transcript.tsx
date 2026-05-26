// input:  useTranscript hook + MessageRow
// output: Scrollable transcript, anchored bottom, scroll-up freezes auto-scroll
// pos:    Main transcript view for M5 Ink client

import React, { useRef, useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import { MessageRow } from './MessageRow.js';
import type { RenderedMessage } from '../hooks/useTranscript.js';

interface TranscriptProps {
  messages: Map<string, RenderedMessage>;
  ids: string[];
  onScrollStateChange?: (scrolledUp: boolean) => void;
}

export function Transcript({ messages, ids, onScrollStateChange }: TranscriptProps): React.JSX.Element {
  const [scrollOffset, setScrollOffset] = useState(0);
  const userScrolledUpRef = useRef(false);

  const scrollUp = useCallback((page = false) => {
    userScrolledUpRef.current = true;
    onScrollStateChange?.(true);
    setScrollOffset(prev => prev + (page ? 10 : 1));
  }, [onScrollStateChange]);

  const scrollDown = useCallback((page = false) => {
    setScrollOffset(prev => {
      const next = prev - (page ? 10 : 1);
      if (next <= 0) {
        userScrolledUpRef.current = false;
        onScrollStateChange?.(false);
        return 0;
      }
      return next;
    });
  }, [onScrollStateChange]);

  const scrollToEnd = useCallback(() => {
    userScrolledUpRef.current = false;
    onScrollStateChange?.(false);
    setScrollOffset(0);
  }, [onScrollStateChange]);

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
        <Text dimColor>↑ {scrollOffset} more — Press End to scroll down</Text>
      ) : null}
    </Box>
  );
}
