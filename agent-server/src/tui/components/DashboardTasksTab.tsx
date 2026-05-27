// input:  TabData for tasks tab
// output: Tasks list — status badge + priority + text + claimed indicator
// pos:    Dashboard tab: read-only task list with disabled mutation buttons

import React from 'react';
import { Box, Text } from 'ink';
import type { TabData } from '../hooks/useDashboardData.js';

interface DashboardTasksTabProps {
  data: TabData;
}

export function DashboardTasksTab({ data }: DashboardTasksTabProps): React.JSX.Element {
  if (data.loading && data.data.length === 0) {
    return <Text dimColor>Loading tasks...</Text>;
  }
  if (data.error) {
    return <Text color="red">Error: {data.error}</Text>;
  }
  if (data.data.length === 0) {
    return <Text dimColor>No tasks</Text>;
  }

  return (
    <Box flexDirection="column">
      {data.data.map((task: any, i: number) => (
        <Box key={task.id ?? i} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={task.status === 'done' ? 'green' : 'yellow'}>{task.status === 'done' ? '✓' : '○'}</Text>
            <Text> </Text>
            <PriorityBadge priority={task.priority} />
            <Text> </Text>
            <Text bold>{String(task.text ?? '').slice(0, 30)}{(task.text ?? '').length > 30 ? '…' : ''}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>
              {task.claimedBy ? `👤 ${task.claimedBy}` : 'unclaimed'}
              {task.blockedBy ? ` | blocked: ${task.blockedBy}` : ''}
            </Text>
          </Box>
          {/* Mutation buttons — disabled in Phase 2 */}
          <Box marginLeft={2}>
            <Text dimColor>[claim] Phase 3 | [complete] Phase 3</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function PriorityBadge({ priority }: { priority: string }): React.JSX.Element {
  switch (priority) {
    case 'high': return <Text color="red">high</Text>;
    case 'medium': return <Text color="yellow">med</Text>;
    case 'low': return <Text color="green">low</Text>;
    default: return <Text dimColor>{priority}</Text>;
  }
}
