// input:  active project + queued/notification counts
// output: Top bar: "cortex-tui | <project>" plus queued / notification badges
// pos:    Fixed header for M5 Ink client. Session name, cost and the connection dot were
//         removed — connection status lives in the bottom line (shown only when abnormal).

import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  projectId: string | null;
  queuedCount: number;
  notificationCount?: number;
}

export function Header({
  projectId,
  queuedCount,
  notificationCount = 0,
}: HeaderProps): React.JSX.Element {
  return (
    <Box borderStyle="single" borderDimColor paddingX={1} marginBottom={1}>
      <Text bold>cortex-tui</Text>
      {projectId ? (
        <Text dimColor> | {projectId}</Text>
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
