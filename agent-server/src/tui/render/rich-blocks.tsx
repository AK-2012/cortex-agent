// input:  platform/types.ts RichBlock[]
// output: RichBlock[] → React tree
// pos:    Structural formatting renderer — renders the RichBlock array from message content

import React from 'react';
import { Box, Text } from 'ink';
import type { RichBlock as RichBlockType } from '../../platform/tui/protocol.js';

interface RichBlocksProps {
  blocks: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/** Render a RichBlock[] array into Ink elements */
export function RichBlocks({ blocks }: RichBlocksProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => (
        <RichBlockItem key={i} block={block} />
      ))}
    </Box>
  );
}

function RichBlockItem({ block }: { block: Record<string, unknown> }): React.JSX.Element {
  switch (block.type) {
    case 'markdown':
      return <Text>{String(block.text ?? '')}</Text>;

    case 'section':
      return <Text>{String(block.text ?? '')}</Text>;

    case 'context':
      return <Text dimColor>{String(block.text ?? '')}</Text>;

    case 'divider':
      return <Text dimColor>{'─'.repeat(40)}</Text>;

    case 'actions': {
      const elements = (block.elements as Array<{ text: string }> | undefined) ?? [];
      return <Text dimColor>{elements.map(e => `[${e.text}]`).join(' ')}</Text>;
    }

    default:
      return <Text>{String((block as any).text ?? '')}</Text>;
  }
}
