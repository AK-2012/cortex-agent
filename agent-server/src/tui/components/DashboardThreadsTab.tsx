// input:  TabData for threads tab
// output: Threads list — status icon + template name + step progress
// pos:    Dashboard tab: read-only thread list

import React from 'react';
import { Box, Text } from 'ink';
import type { TabData } from '../hooks/useDashboardData.js';

interface DashboardThreadsTabProps {
  data: TabData;
}

export function DashboardThreadsTab({ data }: DashboardThreadsTabProps): React.JSX.Element {
  if (data.loading && data.data.length === 0) {
    return <Text dimColor>Loading threads...</Text>;
  }
  if (data.error) {
    return <Text color="red">Error: {data.error}</Text>;
  }
  if (data.data.length === 0) {
    return <Text dimColor>No threads</Text>;
  }

  return (
    <Box flexDirection="column">
      {data.data.map((thread: any, i: number) => (
        <Box key={thread.id ?? i} flexDirection="column" marginBottom={1}>
          <Box>
            <StatusIcon status={thread.status} />
            <Text> </Text>
            <Text bold>{thread.templateName ?? 'unnamed'}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>
              {thread.status}
              {thread.currentStep ? ` — step ${thread.currentStep.index + 1}/${thread.totalSteps}` : ''}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function StatusIcon({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'running': return <Text color="green">▶</Text>;
    case 'waiting': return <Text color="yellow">⏳</Text>;
    case 'completed': return <Text color="blue">✓</Text>;
    case 'failed': return <Text color="red">✗</Text>;
    case 'cancelled': return <Text dimColor>⊘</Text>;
    case 'aborted': return <Text color="red">⛔</Text>;
    default: return <Text dimColor>?</Text>;
  }
}
