// input:  HandshakeAck + session state
// output: Top bar: projectId + sessionName + cost summary + queued indicator
// pos:    Fixed header for M5 Ink client

import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  projectId: string | null;
  sessionName: string | null;
  queuedCount: number;
  connected: boolean;
}

export function Header({ projectId, sessionName, queuedCount, connected }: HeaderProps): React.JSX.Element {
  return (
    <Box borderStyle="single" borderDimColor paddingX={1} marginBottom={1}>
      <Text bold>
        {connected ? '●' : '○'} {' '}
        cortex-tui
      </Text>
      <Text> </Text>
      {projectId ? (
        <Text dimColor> | {projectId}</Text>
      ) : null}
      {sessionName ? (
        <Text dimColor> | {sessionName}</Text>
      ) : null}
      {queuedCount > 0 ? (
        <Text color="yellow"> | ⏳ {queuedCount}</Text>
      ) : null}
    </Box>
  );
}
