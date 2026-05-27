// input:  TabData for schedules tab
// output: Schedules list — type badge + message + nextRun + paused indicator
// pos:    Dashboard tab: read-only schedule list with disabled mutation buttons

import React from 'react';
import { Box, Text } from 'ink';
import type { TabData } from '../hooks/useDashboardData.js';

interface DashboardSchedulesTabProps {
  data: TabData;
}

export function DashboardSchedulesTab({ data }: DashboardSchedulesTabProps): React.JSX.Element {
  if (data.loading && data.data.length === 0) {
    return <Text dimColor>Loading schedules...</Text>;
  }
  if (data.error) {
    return <Text color="red">Error: {data.error}</Text>;
  }
  if (data.data.length === 0) {
    return <Text dimColor>No schedules</Text>;
  }

  return (
    <Box flexDirection="column">
      {data.data.map((sched: any, i: number) => (
        <Box key={sched.id ?? i} flexDirection="column" marginBottom={1}>
          <Box>
            <ScheduleTypeBadge type={sched.type} paused={sched.paused} />
            <Text> </Text>
            <Text bold>{String(sched.message ?? '').slice(0, 25)}{(sched.message ?? '').length > 25 ? '…' : ''}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>
              {sched.paused ? `paused by ${sched.pausedBy ?? '?'}` : `next: ${sched.nextRun ? new Date(sched.nextRun).toLocaleString() : 'never'}`}
            </Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>[pause] Phase 3 | [remove] Phase 3</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function ScheduleTypeBadge({ type, paused }: { type: string; paused: boolean }): React.JSX.Element {
  const color = paused ? 'yellow' : 'green';
  const label = paused ? `⏸ ${type}` : `▶ ${type}`;
  return <Text color={color}>{label}</Text>;
}
