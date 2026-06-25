// input:  RenderedMessage from useTranscript
// output: Renders one message row: text + rich blocks + stream segments
// pos:    Individual message renderer for M5 transcript

import React from 'react';
import { Box, Text } from 'ink';
import { RichBlocks } from '../render/rich-blocks.js';
import { InlineMarkdown } from '../render/inline-markdown.js';
import { collectStreamText } from '../logic.js';
import type { RenderedMessage } from '../hooks/useTranscript.js';

interface MessageRowProps {
  message: RenderedMessage;
}

export function MessageRow({ message }: MessageRowProps): React.JSX.Element {
  // Concatenate all stream segments + mutable regions into a single flowing
  // string instead of one Text per chunk (chunks don't align to line breaks).
  const streamText = message.streams.size > 0 ? collectStreamText(message.streams) : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Main content */}
      <Box flexDirection="column">
        {message.text ? <InlineMarkdown text={message.text} /> : null}
        {message.richBlocks && message.richBlocks.length > 0 ? (
          <RichBlocks blocks={message.richBlocks} />
        ) : null}
      </Box>

      {/* Streaming text */}
      {streamText.length > 0 ? (
        <Text dimColor>{streamText}</Text>
      ) : null}

      {/* Queued indicator */}
      {message.queued ? (
        <Text dimColor> ⏳ queued</Text>
      ) : null}
    </Box>
  );
}
