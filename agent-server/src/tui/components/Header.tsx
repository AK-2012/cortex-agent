// input:  HandshakeAck + session state + notification count + cost summary
// output: Top bar: projectId + sessionName + cost summary + notification count + queued indicator
// pos:    Fixed header for M5 Ink client

import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  projectId: string | null;
  sessionName: string | null;
  queuedCount: number;
  connected: boolean;
  notificationCount?: number;
  costSummary?: string | null;
}

export function Header({
  projectId,
  sessionName,
  queuedCount,
  connected,
  notificationCount = 0,
  costSummary,
}: HeaderProps): React.JSX.Element {
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
      {costSummary ? (
        <Text dimColor> | {costSummary}</Text>
      ) : null}
      {queuedCount > 0 ? (
        <Text color="yellow"> | ⏳ {queuedCount}</Text>
      ) : null}
      {notificationCount > 0 ? (
        <Text color="yellow"> | 🔔 {notificationCount}</Text>
      ) : null}
    </Box>
  );
}
