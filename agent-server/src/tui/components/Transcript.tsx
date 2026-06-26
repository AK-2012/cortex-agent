// input:  useTranscript hook + logic line-flattening
// output: Scrollable transcript, anchored bottom, scroll-up freezes auto-scroll
// pos:    Main transcript view for M5 Ink client
//
// Windowing is measured in TERMINAL LINES, not whole messages: every message is flattened to
// wrapped display lines (logic.flattenTranscript) and the viewport slices exactly `lineBudget`
// lines. This means a single long message is shown in FULL across scroll steps (no per-message
// truncation) while the slice can never exceed the box height (so Ink never garbles). Scrolling
// (keyboard PgUp/PgDn + mouse wheel) moves the bottom anchor one line / one page at a time.

import React, { useRef, useCallback, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Box, Text, useStdout } from 'ink';
import { computeVisibleWindow, flattenTranscript, collectStreamText, detectUserMessage } from '../logic.js';
import type { FlattenableMessage } from '../logic.js';
import { InlineMarkdown } from '../render/inline-markdown.js';
import type { RenderedMessage } from '../hooks/useTranscript.js';

// Rows reserved for the bottom UI (input box marginTop + border(3) + optional turn-status +
// optional awaiting hint + StatusLine; the header was removed). Kept slightly generous so the
// sliced line window never overflows into the input — any small deficit shows as blank at the
// TOP (flex-end anchors content to the bottom), never as a gap above the input.
const RESERVED_ROWS = 8;

export interface TranscriptHandle {
  scrollUp: (page?: boolean) => void;
  scrollDown: (page?: boolean) => void;
  scrollToEnd: () => void;
}

interface TranscriptProps {
  messages: Map<string, RenderedMessage>;
  ids: string[];
}

/** Convert a rendered message into the structural shape the line-flattener consumes. */
function toFlattenable(m: RenderedMessage): FlattenableMessage {
  // A user message is the local echo (isUser flag) OR a replayed `**You:** …` line; either way
  // strip the prefix so it renders cleanly on the grey highlight (no "You:" text).
  const { text, user } = detectUserMessage(m.text, m.isUser);
  return {
    text,
    richBlocks: m.richBlocks,
    streamText: m.streams.size > 0 ? collectStreamText(m.streams) : undefined,
    queued: m.queued,
    user,
  };
}

export const Transcript = forwardRef<TranscriptHandle, TranscriptProps>(
  function Transcript({ messages, ids }: TranscriptProps, ref): React.JSX.Element {
    const { stdout } = useStdout();
    // scrollOffset counts LINES scrolled up from the bottom (0 = pinned to bottom).
    const [scrollOffset, setScrollOffset] = useState(0);
    const userScrolledUpRef = useRef(false);

    const rows = stdout?.rows ?? 24;
    const cols = stdout?.columns ?? 80;
    const lineBudget = Math.max(3, rows - RESERVED_ROWS);

    // Flatten the whole transcript to display lines (no truncation).
    const orderedMessages = ids
      .map(id => messages.get(id))
      .filter((m): m is RenderedMessage => !!m)
      .map(toFlattenable);
    const flatLines = flattenTranscript(orderedMessages, cols);
    const totalLines = flatLines.length;

    const scrollUp = useCallback((page = false) => {
      userScrolledUpRef.current = true;
      setScrollOffset(prev => prev + (page ? Math.max(1, lineBudget - 1) : 1));
    }, [lineBudget]);

    const scrollDown = useCallback((page = false) => {
      setScrollOffset(prev => {
        const next = prev - (page ? Math.max(1, lineBudget - 1) : 1);
        if (next <= 0) {
          userScrolledUpRef.current = false;
          return 0;
        }
        return next;
      });
    }, [lineBudget]);

    const scrollToEnd = useCallback(() => {
      userScrolledUpRef.current = false;
      setScrollOffset(0);
    }, []);

    useImperativeHandle(ref, () => ({ scrollUp, scrollDown, scrollToEnd }), [scrollUp, scrollDown, scrollToEnd]);

    // Auto-stick to bottom on new content unless the user has scrolled up.
    useEffect(() => {
      if (!userScrolledUpRef.current && scrollOffset !== 0) {
        setScrollOffset(0);
      }
    }, [totalLines]);

    // Clamp a stale offset (e.g. after a /clear shrinks the transcript) so the view never
    // strands above the top with nothing to show.
    const maxOffset = Math.max(0, totalLines - 1);
    const effectiveOffset = Math.min(scrollOffset, maxOffset);

    const { start, end } = computeVisibleWindow(totalLines, lineBudget, effectiveOffset);
    const visible = flatLines.slice(start, end);

    if (ids.length === 0) {
      // Empty transcript renders nothing; the flexGrow box still reserves the space so the
      // input stays anchored at the bottom.
      return <Box flexDirection="column" flexGrow={1} />;
    }

    // `justifyContent="flex-end"` anchors the lines to the BOTTOM of the grow box (just above
    // the input), so when the conversation is shorter than the viewport the empty space sits
    // at the top — not as a blank gap between the messages and the input.
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
        {visible.map((ln, i) => {
          const content = ln.text.length > 0 ? ln.text : ' ';
          if (ln.user) {
            // User input: the whole line is highlighted with a grey background (padded to the
            // full width so the highlight spans the row), no "You:" prefix.
            return <Text key={i} backgroundColor="gray">{content.padEnd(cols)}</Text>;
          }
          return ln.markdown
            ? <InlineMarkdown key={i} text={content} dimColor={ln.dim} />
            : <Text key={i} dimColor={ln.dim}>{content}</Text>;
        })}
      </Box>
    );
  },
);
