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
  const hasRichBlocks = !!(message.richBlocks && message.richBlocks.length > 0);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Main content. When richBlocks are present they ARE the content (Slack Block-Kit
          semantics — `text` is only the notification fallback); the sealed status message
          carries its text in both `text` and a section block, so rendering both here printed
          the status line twice. Render `text` only when there are no richBlocks. */}
      <Box flexDirection="column">
        {message.text && !hasRichBlocks ? <InlineMarkdown text={message.text} /> : null}
        {hasRichBlocks ? <RichBlocks blocks={message.richBlocks!} /> : null}
      </Box>

      {/* Streaming text — the agent's streamed reply lands here, so it must go through
          InlineMarkdown too (else **bold** / `code` render as literal markers). */}
      {streamText.length > 0 ? (
        <InlineMarkdown text={streamText} dimColor />
      ) : null}

      {/* Queued indicator */}
      {message.queued ? (
        <Text dimColor> ⏳ queued</Text>
      ) : null}
    </Box>
  );
}
