// input:  RenderedMessage from useTranscript
// output: Renders one message row: text + rich blocks + stream segments
// pos:    Individual message renderer for M5 transcript

import React from 'react';
import { Box, Text } from 'ink';
import { RichBlocks } from '../render/rich-blocks.js';
import type { RenderedMessage } from '../hooks/useTranscript.js';

interface MessageRowProps {
  message: RenderedMessage;
}

export function MessageRow({ message }: MessageRowProps): React.JSX.Element {
  const hasStreams = message.streams.size > 0;
  const streamSegments: string[] = [];

  if (hasStreams) {
    for (const [, stream] of message.streams) {
      streamSegments.push(...stream.segments);
      for (const [, regionText] of stream.mutable) {
        streamSegments.push(regionText);
      }
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Main content */}
      <Box flexDirection="column">
        {message.text ? <Text>{message.text}</Text> : null}
        {message.richBlocks && message.richBlocks.length > 0 ? (
          <RichBlocks blocks={message.richBlocks} />
        ) : null}
      </Box>

      {/* Streaming segments */}
      {streamSegments.length > 0 ? (
        <Box flexDirection="column">
          {streamSegments.map((seg, i) => (
            <Text key={i} dimColor>{seg}</Text>
          ))}
        </Box>
      ) : null}

      {/* Queued indicator */}
      {message.queued ? (
        <Text dimColor> ⏳ queued</Text>
      ) : null}
    </Box>
  );
}
